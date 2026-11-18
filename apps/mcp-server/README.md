# @axial/mcp-server

Servidor [Model Context Protocol](https://modelcontextprotocol.io) do Kairos ("Kairos Projects"), em NestJS 12 com
o módulo oficial `@nestjs/mcp` 0.0.4. Dá a agentes de IA (Claude, Claude Code, ChatGPT, Cursor, MCP Inspector,
qualquer cliente MCP) acesso às APIs reais do Kairos — ms-projects, ms-audit, ms-notifications e ms-identity —
**sempre como o usuário do token**: organização, papel, equipes e projetos vêm do JWT RS256 verificado, e cada
serviço volta a verificar o mesmo token. O MCP é uma fronteira externa: não tem credencial própria nem acesso a
banco.

- 49 ferramentas, 2 recursos, 4 templates de recurso e 4 prompts.
- Streamable HTTP como resource server OAuth 2.1 (RFC 9728; o ms-identity é o servidor de autorização) e stdio,
  com o mesmo modelo de identidade e de scopes.
- Dois scopes: `projects:read` para toda leitura (ferramentas, recursos e prompts) e `projects:write` para toda
  alteração.
- Concorrência otimista (`version`) em toda escrita; 409 vira instrução clara para o modelo.
- Confirmação por elicitação nas operações destrutivas (era 2026-07-28), com `confirm: true` como alternativa.

## Como conectar

### Produção (OAuth)

URL do MCP: **`https://api.kairos.noxlabs.tech/mcp`**. O usuário cola só essa URL no cliente e entra com o e-mail
e a senha do Kairos; o cliente descobre o servidor de autorização pela metadata
`/.well-known/oauth-protected-resource/mcp`, registra-se sozinho (RFC 7591) e renova o acesso por até 30 dias.

| Cliente | Como conectar |
| --- | --- |
| Claude (web e Desktop) | Configurações → Conectores → Adicionar conector personalizado → URL acima → Conectar. |
| Claude Code | `claude mcp add --transport http kairos https://api.kairos.noxlabs.tech/mcp` e, no Claude Code, `/mcp` → `kairos` → Authenticate. |
| ChatGPT | Configurações → Apps e conectores → Configurações avançadas → modo desenvolvedor; conector com a URL e autenticação OAuth. |
| Cursor | `~/.cursor/mcp.json`: `{"mcpServers":{"kairos":{"url":"https://api.kairos.noxlabs.tech/mcp"}}}` e Login em Settings → MCP. |

A página de consentimento concede `projects:read` e `projects:write` (o cliente pode pedir só leitura). Detalhes
do fluxo em [ms-identity](../ms-identity/README.md#oauth-21-para-clientes-mcp) e [deploy](../../deploy/README.md).

### Desenvolvimento local

Pré-requisitos: `.env` a partir de `.env.example`, `pnpm dev:keys`, ms-projects no ar (`pnpm dev:api`) e, para as
ferramentas de outros serviços, ms-audit, ms-notifications e ms-identity.

```powershell
pnpm dev:mcp                                   # HTTP em http://localhost:3006/mcp
$token = node scripts/dev-identity.mjs token   # ADMIN do seed; ou ... token PROJECT_MANAGER | VIEWER …
claude mcp add --transport http kairos-local http://localhost:3006/mcp --header "Authorization: Bearer $token"
```

O token do script não tem claim `scope`: é um token de primeira parte e recebe os dois scopes (como os tokens do
Workspace). Quando expira, o servidor responde 401 com `WWW-Authenticate`; gere outro e refaça o `claude mcp add`.

**stdio** (o token fica num arquivo relido e reverificado a cada chamada, então basta renová-lo):

```powershell
pnpm --filter @axial/contracts build; pnpm --filter @axial/mcp-server build
New-Item -ItemType Directory -Force tmp | Out-Null
node scripts/dev-identity.mjs token > tmp/mcp-token
claude mcp add kairos-stdio --env MCP_ACCESS_TOKEN_FILE=$PWD/tmp/mcp-token -- node $PWD/apps/mcp-server/dist/stdio.js
```

O processo stdio lê o `.env` da raiz, recusa iniciar com token inválido e aplica os mesmos scopes do HTTP (um
token OAuth com `scope` também serve, desde que tenha o MCP como audiência). Não há modo sem token nem usuário
padrão. `MCP_ACCESS_TOKEN` (valor direto) também é aceito, mas não pode ser renovado sem reiniciar.

**MCP Inspector:** `npx @modelcontextprotocol/inspector`, transporte Streamable HTTP, URL
`http://localhost:3006/mcp`, header `Authorization: Bearer <token>`.

## Identidade e scopes

Duas camadas, sempre as duas:

1. **Scope do token** — o que o agente pode tentar. Cada primitiva declara o seu (`scopes` do `@nestjs/mcp`), que
   é conferido antes do método: sem ele, HTTP 403 `insufficient_scope` com `WWW-Authenticate` (o SDK cliente lança
   `InsufficientScopeError` e pode pedir o scope). No stdio, o `StdioScopeGuard` aplica a mesma regra e devolve
   `Forbidden [403]: Insufficient scope…`.
2. **Permissão do usuário** — o que o usuário pode fazer, decidido pelo serviço de destino com o mesmo token
   (papel, organização, equipes, projetos, autoria). 404 pode significar "fora da sua organização ou dos seus
   projetos"; 403 é negação de papel.

Regras de `src/scopes.ts` e `src/verifier.ts`:

- Token com claim `scope` (emitido pelo OAuth do ms-identity a um cliente MCP) precisa ter `MCP_RESOURCE` na
  audiência (RFC 8707) e recebe só os scopes concedidos; token OAuth emitido para outro recurso é recusado (401).
- Token sem `scope` (Workspace, script de desenvolvimento) mantém acesso total: `projects:read` e `projects:write`.
- Tokens de troca de senha (`purpose`) nunca são aceitos.

| Scope | Libera |
| --- | --- |
| `projects:read` | as 22 ferramentas de leitura, os 6 recursos (inclusive `axial://me`) e os 4 prompts |
| `projects:write` | as 27 ferramentas que alteram dados (20 escritas + 7 destrutivas) |

`scopesSupported` em `/.well-known/oauth-protected-resource/mcp` lista os dois.

## Catálogo

Anotações: **R** `readOnlyHint`; **W** escrita; **W·i** escrita idempotente (`idempotentHint`); **D**
`destructiveHint` (pede confirmação). **out** = tem `outputSchema` (resultado em `structuredContent`). Toda escrita
em recurso existente exige `version` da última leitura. Rotas relativas a `/api/v1` do serviço indicado.

### Projetos, épicos e marcos (ms-projects)

| Ferramenta | | Scope | Rota |
| --- | --- | --- | --- |
| `list-projects` | R out | projects:read | GET /projects (search, status, archived, paginação) |
| `get-project` | R out | projects:read | GET /projects/:id |
| `project-summary` | R out | projects:read | GET /projects/:id/summary |
| `get-board` | R | projects:read | GET /projects/:id/board (filtros, paginação por coluna) |
| `list-backlog` | R | projects:read | GET /projects/:id/backlog |
| `get-timeline` | R | projects:read | GET /projects/:id/timeline |
| `create-project` | W | projects:write | POST /projects (inclui `color` `#rrggbb`) |
| `update-project` | W·i | projects:write | PATCH /projects/:id (inclui `color`, null limpa) |
| `archive-project` | D | projects:write | POST /projects/:id/archive |
| `restore-project` | W | projects:write | POST /projects/:id/restore |
| `list-epics` | R out | projects:read | GET /epics?projectId= (projeto opcional: sem ele, todos os projetos legíveis) |
| `get-epic` | R out | projects:read | GET /epics/:id |
| `create-epic` | W | projects:write | POST /projects/:id/epics |
| `update-epic` | W·i | projects:write | PATCH /epics/:id |
| `delete-epic` | D | projects:write | DELETE /epics/:id?version= |
| `list-milestones` | R | projects:read | GET /milestones?projectId= (projeto opcional) |
| `get-milestone` | R | projects:read | GET /milestones/:id |
| `create-milestone` | W | projects:write | POST /projects/:id/milestones |
| `update-milestone` | W·i | projects:write | PATCH /milestones/:id |
| `delete-milestone` | D | projects:write | DELETE /milestones/:id?version= |

### Tarefas e comentários (ms-projects)

| Ferramenta | | Scope | Rota |
| --- | --- | --- | --- |
| `list-tasks` | R out | projects:read | GET /projects/:id/tasks (status, priority, assignee, team, epic, sprint, parent, label, texto) |
| `search-tasks` | R out | projects:read | GET /tasks (entre projetos: texto, status, assignee, projectId, dueBefore) |
| `get-task` | R out | projects:read | GET /tasks/:id |
| `create-task` | W | projects:write | POST /projects/:id/tasks (task, bug ou subtarefa) |
| `update-task` | W·i | projects:write | PATCH /tasks/:id |
| `update-task-status` | W·i | projects:write | PATCH /tasks/:id/status (mover no Kanban, posição opcional) |
| `assign-task` | W·i | projects:write | PATCH /tasks/:id `{version, assigneeId}` |
| `update-task-dependencies` | W·i | projects:write | GET + PATCH /tasks/:id `blockedByIds` (add/remove) |
| `delete-task` | D | projects:write | DELETE /tasks/:id?version= |
| `list-comments` | R | projects:read | GET /tasks/:id/comments |
| `add-comment` | W | projects:write | POST /tasks/:id/comments |
| `update-comment` | W·i | projects:write | PATCH /comments/:id |
| `delete-comment` | D | projects:write | DELETE /comments/:id?version= |

Critérios de aceite (`create-task`, `update-task`) são objetos `{text, done}`; uma string simples também é aceita e
vira `{text, done: false}`, como no contrato do ms-projects. A lista enviada substitui a atual.

### Sprints (ms-projects)

| Ferramenta | | Scope | Rota |
| --- | --- | --- | --- |
| `list-sprints` | R out | projects:read | GET /sprints?projectId= (projeto opcional) |
| `get-sprint` | R out | projects:read | GET /sprints/:id |
| `create-sprint` | W | projects:write | POST /projects/:id/sprints |
| `update-sprint` | W·i | projects:write | PATCH /sprints/:id |
| `start-sprint` | W | projects:write | POST /sprints/:id/start |
| `complete-sprint` | D | projects:write | POST /sprints/:id/complete (devolve inacabadas ao backlog) |
| `delete-sprint` | D | projects:write | DELETE /sprints/:id?version= |
| `assign-tasks-to-sprint` | W·i | projects:write | até 50 × (GET + PATCH /tasks/:id `{version, sprintId}`), com `reportProgress` |

### Auditoria, notificações e diretório

| Ferramenta | | Scope | Serviço e rota |
| --- | --- | --- | --- |
| `search-audit` | R out | projects:read | ms-audit GET /audit (inclui `aggregateId`) |
| `audit-summary` | R out | projects:read | ms-audit GET /audit/summary |
| `list-notifications` | R | projects:read | ms-notifications GET /notifications (últimas 100 do usuário) |
| `get-notification-preferences` | R | projects:read | ms-notifications GET /notification-preferences + /notification-event-preferences |
| `set-notification-event-preference` | W·i | projects:write | ms-notifications PATCH /notification-event-preferences/:event/:channel |
| `retry-notification` | W | projects:write | ms-notifications POST /notifications/:id/retry |
| `list-members` | R | projects:read | ms-identity GET /organization/members |
| `list-teams` | R | projects:read | ms-identity GET /organization/teams |

A auditoria continua limitada pelo ms-audit a ADMIN, PROJECT_MANAGER e TEAM_LEAD (os dois últimos, aos projetos
do token). O diretório do ms-identity aceita token OAuth delegado só nessas duas rotas de leitura e só com
`projects:read`; as demais rotas do ms-identity continuam recusando tokens delegados.

### Recursos

| URI | Tipo | Scope | Conteúdo / rotas |
| --- | --- | --- | --- |
| `axial://me` | JSON | projects:read | usuário, organização, papel, equipes, projetos, cliente OAuth, scopes, expiração, transporte (do token, sem chamada) |
| `axial://projects` | JSON | projects:read | GET /projects?pageSize=100 |
| `axial://projects/{projectId}` | JSON | projects:read | GET /projects/:id, /summary, /sprints?projectId=, /milestones?projectId= |
| `axial://projects/{projectId}/board` | Markdown | projects:read | GET /projects/:id + /board (até 100 por coluna, atrasos e bloqueios) |
| `axial://tasks/{taskId}` | JSON | projects:read | GET /tasks/:id, subtarefas e até 100 comentários |
| `axial://sprints/{sprintId}` | JSON | projects:read | GET /sprints/:id e tarefas da sprint (até 500) com progresso |

### Prompts (dados reais lidos com o token do usuário; nunca alteram nada)

| Prompt | Scope | Argumentos | Contexto embutido |
| --- | --- | --- | --- |
| `planejar-sprint` | projects:read | `projectId`, `capacidade` (pontos, opcional) | indicadores, sprints abertas, backlog por prioridade/prazo, bloqueios |
| `relatorio-de-risco` | projects:read | `projectId` | atrasadas, bloqueadas, urgentes paradas, sem responsável, sprint ativa, marcos em 14 dias |
| `refinar-tarefa` | projects:read | `taskId` | descrição, critérios (`[x]`/`[ ]`), bloqueadores, subtarefas, comentários e versão |
| `resumo-semanal` | projects:read | `projectId`, `dias` (1–31, padrão 7) | concluídas/criadas/alteradas, sprint ativa e, para ADMIN/PROJECT_MANAGER/TEAM_LEAD, o resumo da auditoria |

## Fora do MCP (de propósito)

Administração de identidade — criar/editar equipe, membros de equipe, acesso a projeto, membros, convites e
papéis — não é exposta. Exigiria que o ms-identity aceitasse tokens delegados em rotas de administrador, o que hoje
é recusado de propósito; continua no Workspace. Também ficam de fora a troca de destino de notificação (exige
código de verificação digitado pelo usuário) e a leitura de templates/provedores de notificação.

## Arquitetura

```text
cliente MCP ──HTTP POST /mcp (Bearer JWT)──┐        ┌── stdio (MCP_ACCESS_TOKEN_FILE)
                                           ▼        ▼
            @nestjs/mcp: Host/Origin · OAuth (IdentityTokenVerifier) · scopes por primitiva
            StdioScopeGuard (mesmos scopes no stdio) → McpCallLogInterceptor → método → McpErrorFilter
                                           │
            CallerIdentity: token verificado do HTTP, ou token do arquivo reverificado a cada chamada
                                           │
            AxialApi ── fetch com o token do chamador, ctx.signal e timeout ──► ms-projects       /api/v1
                                                                         ├─► ms-audit         /api/v1/audit
                                                                         ├─► ms-notifications /api/v1
                                                                         └─► ms-identity      /api/v1/organization
```

| Arquivo | Conteúdo |
| --- | --- |
| `src/verifier.ts` | Verificação RS256 (emissor, audiência, expiração, claims) e scopes do token |
| `src/scopes.ts` | `projects:read`/`projects:write` e a regra token OAuth × token de primeira parte |
| `src/identity.ts` | Identidade do chamador por transporte; nenhum header ou argumento a substitui |
| `src/upstream.ts` | Cliente dos serviços e mapeamento de erros sem detalhes internos |
| `src/schemas.ts` | Entradas derivadas de `@axial/contracts` (com `.describe()`), saídas e annotations |
| `src/tools/*.ts` | Ferramentas de projetos, tarefas, sprints e organização (auditoria, notificações, diretório) |
| `src/resources.ts`, `src/prompts.ts` | Recursos `axial://` e prompts com dados reais |
| `src/mcp/*.ts` | Confirmação, guard de scopes no stdio, log por chamada e filtro de erros |
| `src/main.ts`, `src/stdio.ts` | Os dois transportes, sobre o mesmo `AppModule` |

O esquema de URI `axial://` e o nome técnico `axial-projects` são identificadores internos e foram mantidos; o
título mostrado aos usuários é "Kairos Projects".

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

## Configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| `MCP_PORT` | 3006 | Porta HTTP |
| `MCP_RESOURCE` | http://localhost:3006/mcp | URL canônica do recurso (RFC 9728); igual a `IDENTITY_OAUTH_RESOURCE` |
| `MCP_PUBLIC_KEY_PATH` / `MCP_JWKS_URL` | — | Chave pública SPKI ou JWKS HTTPS (um dos dois) |
| `MCP_JWT_ISSUER` / `MCP_JWT_AUDIENCE` | — | Emissor e audiência esperados (os mesmos do ms-projects) |
| `PROJECTS_API_URL` | http://localhost:3001 | ms-projects |
| `AUDIT_API_URL` | http://localhost:3005 | ms-audit |
| `NOTIFICATIONS_API_URL` | http://localhost:3003 | ms-notifications |
| `IDENTITY_API_URL` | http://localhost:3002 | ms-identity |
| `MCP_UPSTREAM_TIMEOUT_MS` | 15000 | Timeout por chamada a serviço |
| `MCP_ALLOWED_HOSTS` | localhost,127.0.0.1,[::1] | Hosts aceitos no header Host (atrás do gateway, inclua `mcp-server`) |
| `MCP_ALLOWED_ORIGINS` | http://localhost:5173,http://localhost:4173 | Origens de navegador aceitas |
| `MCP_ACCESS_TOKEN_FILE` / `MCP_ACCESS_TOKEN` | — | Só stdio: token do usuário |

As URLs dos serviços são base, sem `/api/v1` (acrescentado a cada chamada) e podem ter prefixo de caminho. Em
produção (`NODE_ENV=production`) todas exigem HTTPS. No `deploy/compose.yaml` apontam para `http://api:3001`,
`http://ms-audit:3005`, `http://ms-notifications:3003` e `http://ms-identity:3002`.

## Testes

```powershell
pnpm --filter @axial/mcp-server test:unit          # vitest: unitários + integração in-memory + stdio real
$env:TEST_DATABASE_URL = 'postgresql://axial:axial_local_only@localhost:5550/axial_test?schema=projects'
$env:TEST_REDIS_URL = 'redis://localhost:6389/10'
pnpm test:mcp:integration                          # processo HTTP real (upstream simulado) + E2E com ms-projects real
```

- `test/mcp.integration.test.ts` usa `connectMcpClient` de `@nestjs/mcp/testing` sobre o `AppModule` real e um
  upstream simulado (`test/support/harness.ts`): catálogo completo para token OAuth de leitura+escrita, scope
  declarado por primitiva, escrita recusada e leitura aceita com token só de leitura, token sem leitura, token de
  outro recurso, tokens de primeira parte inalterados, as 8 ferramentas originais, organização, 409, confirmação
  nas duas eras, progresso, listas da organização, critérios `{text, done}`, cor, recursos e prompts.
- `test/stdio.test.ts` inicia `src/stdio.ts` como processo filho: identidade do arquivo, troca de token sem
  reiniciar, scope OAuth aplicado no stdio e token inválido.
- `test/verifier.test.ts`, `test/scopes.test.ts`, `test/upstream.test.ts`, `test/format.test.ts`: unidades.
- `test/integration.mjs` sobe `src/main.ts` e confere 401 + metadata RFC 9728, scopes OAuth e `insufficient_scope`.
- `test/e2e.mjs` sobe ms-projects e o MCP como processos, com chaves efêmeras e organizações aleatórias (não
  apaga dados), e exercita o fluxo completo pelo cliente MCP. Recusa banco cujo nome não termine em `_test`.

Relatório da verificação: [docs/relatorio-mcp-server.md](../../docs/relatorio-mcp-server.md).
