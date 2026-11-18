# @axial/mcp-server

Servidor [Model Context Protocol](https://modelcontextprotocol.io) do Axial, em NestJS 12 com o módulo oficial
`@nestjs/mcp` 0.0.4. Dá a agentes de IA (Claude Code, Claude Desktop, MCP Inspector, qualquer cliente MCP)
acesso às APIs reais do Axial — ms-projects, ms-audit, ms-notifications e ms-identity — **sempre como o usuário
do token**: organização, papel, equipes e projetos vêm do JWT RS256 verificado, e cada serviço volta a
verificar o mesmo token. O MCP é uma fronteira externa: não tem credencial própria nem acesso a banco.

- 52 ferramentas, 2 recursos, 4 templates de recurso e 4 prompts.
- Streamable HTTP (OAuth 2.1 resource server, RFC 9728) e stdio, com o mesmo modelo de identidade.
- Concorrência otimista (`version`) em toda escrita; 409 vira instrução clara para o modelo.
- Confirmação por elicitação nas operações destrutivas (era 2026-07-28), com `confirm: true` como alternativa.

## Arquitetura

```text
cliente MCP ──HTTP POST /mcp (Bearer JWT)──┐        ┌── stdio (MCP_ACCESS_TOKEN_FILE)
                                           ▼        ▼
            @nestjs/mcp: Host/Origin · OAuth (IdentityTokenVerifier) · scopes por primitiva
            StdioScopeGuard (mesmos scopes no stdio) → McpCallLogInterceptor → método → McpErrorFilter
                                           │
            CallerIdentity: token verificado do HTTP, ou token do arquivo re-verificado a cada chamada
                                           │
            AxialApi ── fetch com o token do chamador, ctx.signal e timeout ──► ms-projects  /api/v1
                                                                         ├─► ms-audit     /api/v1/audit
                                                                         ├─► ms-notifications
                                                                         └─► ms-identity
```

| Arquivo | Conteúdo |
| --- | --- |
| `src/verifier.ts` | Verificação RS256 (emissor, audiência, expiração, claims) e cálculo dos scopes |
| `src/scopes.ts` | Scopes, teto por papel e redução pela claim `scope` |
| `src/identity.ts` | Identidade do chamador por transporte; nenhum header ou argumento a substitui |
| `src/upstream.ts` | Cliente dos serviços e mapeamento de erros sem detalhes internos |
| `src/schemas.ts` | Entradas derivadas de `@axial/contracts` (com `.describe()`), saídas e annotations |
| `src/tools/*.ts` | Ferramentas de projetos, tarefas, sprints e organização (auditoria, notificações, equipes) |
| `src/resources.ts`, `src/prompts.ts` | Recursos `axial://` e prompts com dados reais |
| `src/mcp/*.ts` | Confirmação, guard de scopes no stdio, log por chamada e filtro de erros |
| `src/main.ts`, `src/stdio.ts` | Os dois transportes, sobre o mesmo `AppModule` |

## Identidade e scopes

Duas camadas, sempre as duas:

1. **Scope do token** — o que o agente pode tentar. O `@nestjs/mcp` confere antes do método e responde HTTP 403
   `insufficient_scope` com `WWW-Authenticate` (o cliente SDK lança `InsufficientScopeError`). No stdio, o
   `StdioScopeGuard` aplica a mesma regra e devolve `Forbidden [403]: Insufficient scope…`.
2. **Permissão do usuário** — o que o usuário pode fazer, decidido pelo serviço de destino com o mesmo token
   (papel, organização, equipes, projetos, autoria). 404 pode significar "fora da sua organização ou dos seus
   projetos"; 403 é negação de papel.

Os scopes vêm do papel verificado (teto) e, se o emissor colocar a claim `scope` (lista separada por espaços),
são **reduzidos** a ela — nunca ampliados. O ms-identity atual não emite `scope`, então vale o teto do papel.

| Scope | Libera | Papéis (teto) |
| --- | --- | --- |
| `projects:read` | leituras de ms-projects, `axial://projects…`, `axial://tasks…`, `axial://sprints…`, prompts | todos |
| `projects:write` | escritas em projetos, épicos, tarefas, comentários, sprints e marcos | todos menos VIEWER |
| `audit:read` | `search-audit`, `audit-summary` e a seção de auditoria do `resumo-semanal` | ADMIN, PROJECT_MANAGER, TEAM_LEAD |
| `notifications:read` | histórico e preferências do próprio usuário | todos |
| `notifications:write` | ligar/desligar evento por canal, reenviar entrega com falha | todos |
| `identity:read` | listar membros e equipes | ADMIN |
| `identity:write` | criar/editar equipe, membros de equipe, acesso a projeto | ADMIN |

`axial://me` não exige scope: mostra a identidade, os scopes concedidos e a expiração do token.
`scopesSupported` (metadata em `/.well-known/oauth-protected-resource/mcp`) lista todos os sete.

## Catálogo de primitivas

Anotações: **R** `readOnlyHint`; **W** escrita; **W·i** escrita idempotente (`idempotentHint`); **D** `destructiveHint`
(pede confirmação). **out** = tem `outputSchema` (resultado em `structuredContent`). Toda escrita em recurso
existente exige `version` da última leitura.

### Projetos e projeções (ms-projects)

| Ferramenta | | Scope | Rota |
| --- | --- | --- | --- |
| `list-projects` | R out | projects:read | GET /projects (search, status, archived, paginação) |
| `get-project` | R out | projects:read | GET /projects/:id |
| `project-summary` | R out | projects:read | GET /projects/:id/summary |
| `get-board` | R | projects:read | GET /projects/:id/board (filtros, paginação por coluna) |
| `list-backlog` | R | projects:read | GET /projects/:id/backlog |
| `get-timeline` | R | projects:read | GET /projects/:id/timeline |
| `create-project` | W | projects:write | POST /projects |
| `update-project` | W·i | projects:write | PATCH /projects/:id |
| `archive-project` | D | projects:write | POST /projects/:id/archive |
| `restore-project` | W | projects:write | POST /projects/:id/restore |
| `list-epics` / `get-epic` | R out | projects:read | GET /projects/:id/epics, /epics/:id |
| `create-epic` / `update-epic` | W / W·i | projects:write | POST /projects/:id/epics, PATCH /epics/:id |
| `delete-epic` | D | projects:write | DELETE /epics/:id?version= |
| `list-milestones` / `get-milestone` | R | projects:read | GET /projects/:id/milestones, /milestones/:id |
| `create-milestone` / `update-milestone` | W / W·i | projects:write | POST /projects/:id/milestones, PATCH /milestones/:id |
| `delete-milestone` | D | projects:write | DELETE /milestones/:id?version= |

### Tarefas e colaboração (ms-projects)

| Ferramenta | | Scope | Rota |
| --- | --- | --- | --- |
| `list-tasks` | R out | projects:read | GET /projects/:id/tasks (status, priority, assignee, team, epic, sprint, parent, label, texto) |
| `get-task` | R out | projects:read | GET /tasks/:id |
| `create-task` | W | projects:write | POST /projects/:id/tasks (task, bug ou subtarefa) |
| `update-task` | W·i | projects:write | PATCH /tasks/:id |
| `update-task-status` | W·i | projects:write | PATCH /tasks/:id/status (mover no Kanban, posição opcional) |
| `assign-task` | W·i | projects:write | PATCH /tasks/:id `{version, assigneeId}` |
| `update-task-dependencies` | W·i | projects:write | GET + PATCH /tasks/:id `blockedByIds` (add/remove) |
| `delete-task` | D | projects:write | DELETE /tasks/:id?version= |
| `list-comments` | R | projects:read | GET /tasks/:id/comments |
| `add-comment` / `update-comment` | W / W·i | projects:write | POST /tasks/:id/comments, PATCH /comments/:id |
| `delete-comment` | D | projects:write | DELETE /comments/:id?version= |

### Sprints (ms-projects)

| Ferramenta | | Scope | Rota |
| --- | --- | --- | --- |
| `list-sprints` / `get-sprint` | R out | projects:read | GET /projects/:id/sprints, /sprints/:id |
| `create-sprint` / `update-sprint` | W / W·i | projects:write | POST /projects/:id/sprints, PATCH /sprints/:id |
| `start-sprint` | W | projects:write | POST /sprints/:id/start |
| `complete-sprint` | D | projects:write | POST /sprints/:id/complete (devolve inacabadas ao backlog) |
| `delete-sprint` | D | projects:write | DELETE /sprints/:id?version= |
| `assign-tasks-to-sprint` | W·i | projects:write | até 50 × (GET + PATCH /tasks/:id `sprintId`), com `reportProgress` |

### Auditoria, notificações e organização

| Ferramenta | | Scope | Serviço e rota |
| --- | --- | --- | --- |
| `search-audit` | R out | audit:read | ms-audit GET /audit |
| `audit-summary` | R out | audit:read | ms-audit GET /audit/summary |
| `list-notifications` | R | notifications:read | ms-notifications GET /notifications (últimas 100 do usuário) |
| `get-notification-preferences` | R | notifications:read | GET /notification-preferences + /notification-event-preferences |
| `set-notification-event-preference` | W·i | notifications:write | PATCH /notification-event-preferences/:event/:channel |
| `retry-notification` | W | notifications:write | POST /notifications/:id/retry |
| `list-members` / `list-teams` | R | identity:read | ms-identity GET /members, /teams (ADMIN) |
| `create-team` / `update-team` | W / W·i | identity:write | POST /teams, PATCH /teams/:id |
| `set-team-member` | W·i | identity:write | POST /teams/:id/members/:userId `{enabled}` |
| `set-project-access` | W·i | identity:write | POST /members/:id/projects/:projectId `{enabled}` |

### Recursos

| URI | Tipo | Scope | Conteúdo |
| --- | --- | --- | --- |
| `axial://me` | JSON | — | usuário, organização, papel, equipes, projetos, scopes, expiração, transporte |
| `axial://projects` | JSON | projects:read | até 100 projetos ativos visíveis |
| `axial://projects/{projectId}` | JSON | projects:read | projeto, resumo, sprints e marcos |
| `axial://projects/{projectId}/board` | Markdown | projects:read | Kanban por coluna (até 100 por coluna) com atrasos e bloqueios |
| `axial://tasks/{taskId}` | JSON | projects:read | tarefa, subtarefas e até 100 comentários |
| `axial://sprints/{sprintId}` | JSON | projects:read | sprint, tarefas (até 500) e progresso |

### Prompts (com dados reais lidos com o token do usuário)

| Prompt | Argumentos | Contexto embutido |
| --- | --- | --- |
| `planejar-sprint` | `projectId`, `capacidade` (pontos, opcional) | indicadores, sprints abertas, backlog por prioridade/prazo, bloqueios |
| `relatorio-de-risco` | `projectId` | atrasadas, bloqueadas, urgentes paradas, sem responsável, sprint ativa, marcos em 14 dias |
| `refinar-tarefa` | `taskId` | descrição, critérios, bloqueadores, subtarefas, comentários e versão |
| `resumo-semanal` | `projectId`, `dias` (1–31, padrão 7) | concluídas/criadas/alteradas no período, sprint ativa e, com `audit:read`, o resumo da auditoria |

Os prompts nunca alteram dados; dizem ao modelo para aplicar mudanças só depois da aprovação do usuário.

## Qualidade MCP

- **Descrições** escritas para o modelo; `.describe()` em todo argumento (verificado em teste).
- **Annotations** coerentes: leituras `readOnlyHint`; exclusões, `archive-project` e `complete-sprint` `destructiveHint`.
- **outputSchema** nas leituras principais, com enums de `@axial/contracts`; objetos "loose" aceitam campos novos.
- **Cancelamento:** `ctx.signal` vai a cada `fetch`, somado a um timeout (`MCP_UPSTREAM_TIMEOUT_MS`, padrão 15 s).
- **Progresso:** `assign-tasks-to-sprint` envia `notifications/progress` por tarefa e devolve o resultado de cada uma.
- **Confirmação destrutiva:** cliente da era 2026-07-28 que declara `elicitation` recebe `inputRequired` com a
  pergunta (ex.: "Delete task CHK-7 — "…" permanently?"); recusa/cancelamento não muda nada. Cliente 2025 ou sem
  elicitação recebe erro de ferramenta pedindo `confirm: true` depois da confirmação explícita do usuário.
- **Erros:** `McpErrorFilter` devolve `isError: true` com `"<Título> [status]: <mensagem>"` e `_meta["axial/status"]`.
  409 orienta reler e repetir com a nova versão; 403 orienta não tentar outros ids; 5xx e corpos longos nunca são
  repassados; issues de validação (campo: mensagem) e correlation id são mantidos. Em recursos e prompts vira erro
  JSON-RPC (`ResourceNotFoundError` para 404).
- **Log:** uma linha JSON por chamada (`mcp_call`: primitiva, usuário, organização, transporte, era, duração,
  resultado), sem argumentos nem conteúdo. No stdio vai para o stderr.

## Como conectar

Pré-requisitos: `.env` a partir de `.env.example`, `pnpm dev:keys`, ms-projects no ar (`pnpm dev:api`) e, para as
ferramentas de outros serviços, ms-audit, ms-notifications e ms-identity.

```powershell
pnpm dev:mcp                                   # HTTP em http://localhost:3006/mcp
$token = node scripts/dev-identity.mjs token   # ADMIN do seed; ou ... token PROJECT_MANAGER | VIEWER …
```

**Claude Code via HTTP** (o token local vale 15 minutos; o do login real, 5):

```powershell
claude mcp add --transport http axial http://localhost:3006/mcp --header "Authorization: Bearer $token"
```

Quando o token expira, o servidor responde 401 com `WWW-Authenticate`; gere outro e refaça o `claude mcp add`
(ou use `claude mcp remove axial` antes). Também é possível usar o token do login do Workspace
(`POST /api/v1/auth/login`).

**Claude Code via stdio** (o token fica num arquivo relido a cada chamada, então basta renová-lo):

```powershell
pnpm --filter @axial/contracts build; pnpm --filter @axial/mcp-server build
New-Item -ItemType Directory -Force tmp | Out-Null
node scripts/dev-identity.mjs token > tmp/mcp-token
claude mcp add axial-stdio --env MCP_ACCESS_TOKEN_FILE=$PWD/tmp/mcp-token -- node $PWD/apps/mcp-server/dist/stdio.js
```

O processo stdio lê o `.env` da raiz (chave pública, emissor, audiência e URLs), verifica o token na partida
(recusa iniciar com token inválido) e de novo em cada chamada, aplicando os mesmos scopes do HTTP. Não há modo sem
token nem usuário padrão. `MCP_ACCESS_TOKEN` (valor direto) também é aceito, mas não pode ser renovado sem
reiniciar.

**MCP Inspector:** `npx @modelcontextprotocol/inspector`, transporte Streamable HTTP, URL
`http://localhost:3006/mcp`, header `Authorization: Bearer <token>`.

## Configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| `MCP_PORT` | 3006 | Porta HTTP |
| `MCP_RESOURCE` | http://localhost:3006/mcp | URL canônica do recurso (metadata RFC 9728) |
| `MCP_PUBLIC_KEY_PATH` / `MCP_JWKS_URL` | — | Chave pública SPKI ou JWKS HTTPS (um dos dois) |
| `MCP_JWT_ISSUER` / `MCP_JWT_AUDIENCE` | — | Emissor e audiência esperados (os mesmos do ms-projects) |
| `PROJECTS_API_URL` | http://localhost:3001 | ms-projects |
| `AUDIT_API_URL` | http://localhost:3005 | ms-audit |
| `NOTIFICATIONS_API_URL` | http://localhost:3003 | ms-notifications |
| `IDENTITY_API_URL` | http://localhost:3002 | ms-identity |
| `MCP_UPSTREAM_TIMEOUT_MS` | 15000 | Timeout por chamada a serviço |
| `MCP_ALLOWED_HOSTS` | localhost,127.0.0.1,[::1] | Hosts aceitos no header Host (inclua o host público atrás do gateway) |
| `MCP_ALLOWED_ORIGINS` | http://localhost:5173,http://localhost:4173 | Origens de navegador aceitas |
| `MCP_ACCESS_TOKEN_FILE` / `MCP_ACCESS_TOKEN` | — | Só stdio: token do usuário |

Em produção, todas as URLs exigem HTTPS. URLs base podem ter prefixo de caminho; `/api/v1` é acrescentado.

## Testes

```powershell
pnpm --filter @axial/mcp-server test:unit          # vitest: unitários + integração in-memory + stdio real
pnpm --filter @axial/mcp-server test:integration   # processo HTTP real com upstream simulado
$env:TEST_DATABASE_URL = 'postgresql://axial:axial_local_only@localhost:5550/axial_test?schema=projects'
$env:TEST_REDIS_URL = 'redis://localhost:6389/15'
pnpm --filter @axial/mcp-server test:e2e           # ms-projects real + MCP HTTP real (exige banco *_test)
```

- `test/mcp.integration.test.ts` usa `connectMcpClient` de `@nestjs/mcp/testing` sobre o `AppModule` real e um
  upstream simulado (`test/support/harness.ts`): catálogo, autenticação, scopes, organização, 409, confirmação nas
  duas eras, progresso, recursos e prompts.
- `test/stdio.test.ts` inicia `src/stdio.ts` como processo filho com `StdioClientTransport`.
- `test/e2e.mjs` sobe ms-projects e o MCP como processos, com chaves efêmeras e organizações aleatórias (não
  apaga dados), e exercita o fluxo completo pelo cliente MCP. Recusa banco cujo nome não termine em `_test`.

## Lacunas de API e limites

Ver [relatório do MCP](../../docs/relatorio-mcp-server.md#lacunas-de-api-e-limites).
