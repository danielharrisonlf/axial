# Relatório do servidor MCP

Entrega de 18/11/2026: o catálogo completo da branch `feat/mcp-server-complete` (commits a294057, b0b8bc7 e
49946a8, feitos sobre 5e8697a) portado para `dev` (a partir de e34cd72), sobre o suporte OAuth 2.1 que `dev` já
tinha. Nada foi enviado ao remoto nem implantado.

Escopo de edição: `apps/mcp-server`; a menor mudança no ms-identity para o diretório aceitar tokens delegados com
`projects:read`; variáveis do mcp-server em `deploy/compose.yaml`, `docker-compose.yaml`, `.env.example` e
`scripts/performance/run.mjs`; documentação; lockfile (`@axial/contracts` como dependência do MCP).

## O que mudou

Antes (`dev`): 8 ferramentas sobre o ms-projects, sem recursos nem prompts, com OAuth (`src/verifier.ts`,
`src/scopes.ts`, `MCP_ALLOWED_HOSTS`, metadata RFC 9728).

Agora (catálogo com scope e rota de cada primitiva em [apps/mcp-server/README.md](../apps/mcp-server/README.md#catálogo)):

| Primitiva | Quantidade | Destaques |
| --- | --- | --- |
| Ferramentas | 49 | 22 leituras (`projects:read`), 20 escritas e 7 destrutivas com confirmação (`projects:write`); 41 no ms-projects, 2 no ms-audit, 4 no ms-notifications e 2 no ms-identity |
| Recursos | 2 | `axial://me`, `axial://projects` |
| Templates | 4 | `axial://projects/{projectId}`, `…/board` (Markdown), `axial://tasks/{taskId}`, `axial://sprints/{sprintId}` |
| Prompts | 4 | `planejar-sprint`, `relatorio-de-risco`, `refinar-tarefa`, `resumo-semanal` |

As 8 ferramentas de `dev` mantêm nome e argumentos (há teste); ganharam argumentos opcionais, e `list-sprints`
passou a aceitar `projectId` opcional.

Decisões do port:

- **Scopes de `dev`, não os da branch.** A branch tinha sete scopes com teto por papel; `dev` emite e anuncia só
  `projects:read` e `projects:write`. Toda primitiva declara um dos dois: leitura de qualquer serviço (inclusive
  auditoria, notificações e diretório), os 6 recursos e os 4 prompts pedem `projects:read`; toda alteração pede
  `projects:write`. Tokens com `scope` (OAuth) precisam do MCP na audiência e recebem só o concedido; tokens sem
  `scope` (Workspace, script de desenvolvimento) mantêm acesso total, como em `dev`. O papel continua decidido pelo
  serviço de destino. No stdio, o `StdioScopeGuard` aplica a mesma regra.
- **`axial://me` também pede `projects:read`** (na branch não pedia), para que nenhuma leitura escape do scope;
  passou a mostrar o `clientId` OAuth.
- **Contratos novos de `dev`:** critérios de aceite como `{text, done}` (strings simples ainda aceitas, como no
  contrato), `color` em `create-project`/`update-project` e na saída, `aggregateId` em `search-audit`, eventos de
  notificação sem sufixo `.v1` (`task.assigned`, `task.updated`, `task.status_changed`, `task.completed`).
- **Listas da organização:** `list-sprints`, `list-epics` e `list-milestones` usam `GET /sprints|/epics|/milestones`
  com `projectId` opcional (sem ele, todos os projetos legíveis; com ele, 404 se o projeto não for legível); nova
  ferramenta `search-tasks` sobre `GET /tasks` (texto, status, responsável, projeto, `dueBefore`). Recursos e
  prompts leem sprints e marcos pelas mesmas rotas.
- **Diretório no lugar da administração:** `list-members` e `list-teams` usam `GET /organization/members|teams`
  (qualquer membro ativo), não as rotas de administrador. Para funcionar com token OAuth, o ms-identity passou a
  aceitar token delegado só nessas duas rotas e só com `projects:read` (403 sem ele; 401 nas demais rotas, como
  antes). `create-team`, `update-team`, `set-team-member` e `set-project-access` da branch foram retirados (ver
  lacunas).
- **`resumo-semanal`:** inclui a auditoria pelo papel (ADMIN, PROJECT_MANAGER, TEAM_LEAD, os mesmos que o ms-audit
  atende), não mais por um scope `audit:read` que deixou de existir.
- **Mantido da branch:** identidade só do token verificado (HTTP e stdio), entradas derivadas de `@axial/contracts`
  com `.describe()`, `outputSchema` nas leituras principais, `version` em toda escrita e `?version=` nas exclusões,
  409 com orientação, confirmação por elicitação ou `confirm: true` nas 7 destrutivas, `McpErrorFilter`, log por
  chamada, progresso em `assign-tasks-to-sprint`, timeout e cancelamento por chamada.
- **Nomes:** servidor `axial-projects` 2.0.0, título "Kairos Projects"; textos para o usuário dizem Kairos. O
  esquema `axial://` ficou (identificador interno).

## Verificação executada

Ambiente: Windows 11, Node 24, pnpm 10.11.1, Docker com PostgreSQL de teste em 5550 e Redis em 6389.
`pnpm db:generate`; `prisma migrate deploy` em `axial_test` (nenhuma migration pendente).

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | 244 arquivos, 0 erros |
| `pnpm typecheck` | 15/15 tarefas (o MCP checa também `test/` via `tsconfig.check.json`) |
| `pnpm build` | 12/12 tarefas |
| `pnpm test` | 14/14 tarefas; mcp-server 58 testes em 6 arquivos; ms-identity 20 |
| `pnpm test:mcp:integration` (`TEST_DATABASE_URL=…/axial_test?schema=projects`, `TEST_REDIS_URL=redis://localhost:6389/10`, `IDENTITY_TEST_DATABASE_URL=…/axial_test`) | `integration.mjs` (processo HTTP real, upstream simulado), `e2e.mjs` (ms-projects real + MCP HTTP real) e `oauth-e2e.mjs` (SDK oficial contra identity + gateway + MCP + ms-projects reais) passaram |
| `pnpm test:mcp:oauth:browser` (Chromium do Playwright 1.58.2 do apps/web) | passou |
| `pnpm test:gateway:integration` | passou |
| `pnpm test:identity:integration` (`IDENTITY_TEST_DATABASE_URL=…/axial_test`) | integration, oauth-integration (com as novas asserções do diretório), accounts e seed passaram |

`test:mcp:integration` agora roda `integration.mjs`, `e2e.mjs` e `oauth-e2e.mjs`; o CI já fornece os bancos
`_test` (`TEST_DATABASE_URL`, `IDENTITY_TEST_DATABASE_URL`), Redis e Prisma gerado antes desse passo. O teste de
navegador fica num script próprio porque o CI só instala o Chromium depois.

## OAuth de ponta a ponta

`test/oauth-e2e.mjs` e `test/oauth-browser.mjs` sobem ms-identity (banco descartável), ms-projects, mcp-server e
gateway reais (`test/support/oauth-stack.mjs`); o cliente usa só o gateway. Sequência com o SDK oficial
(`@modelcontextprotocol/client` 2.4.0, `StreamableHTTPClientTransport` com `authProvider`):

1. `POST /mcp` sem token → 401 com `resource_metadata`; metadata RFC 9728 (recurso, `authorization_servers`,
   scopes) e RFC 8414 (issuer, registro, PKCE S256) pelo gateway.
2. O SDK registra o cliente (RFC 7591), monta o authorize com PKCE e `resource`; o "navegador" do teste abre o
   consentimento, envia login e, para a conta em duas organizações, escolhe a segunda; `finishAuth` com `code` e
   `iss` (RFC 9207).
3. Token com `scope` `projects:read projects:write`, `aud` [`axial-projects`, recurso], `source: mcp` e a
   organização escolhida; `initialize` (servidor `axial-projects`), `tools/list` com as 49 ferramentas,
   `axial://me`, `create-project`, `list-projects` (ms-projects) e `list-members` (diretório do ms-identity com o
   token delegado).
4. `auth()` do SDK com o refresh token guardado → `AUTHORIZED`; access e refresh token trocados, organização
   mantida; nova conexão e `get-project` com o token novo.
5. Variante só leitura (`auth(..., { scope: "projects:read" })`, conta de uma organização: sem tela de escolha):
   leitura funciona; `create-project` é recusada com `insufficient_scope`, o SDK pede step-up com
   `projects:read projects:write` e nada chega ao ms-projects (conferido pela API).

### Pontos do login verificados

| Ponto | Verificação | Resultado |
| --- | --- | --- |
| Sessão | contagem de `identity.session` antes e depois de cada login OAuth; `Set-Cookie` da resposta do POST | nenhuma sessão BetterAuth fica no banco; o POST não grava cookie de sessão |
| Escolha de organização | SDK (conta em 2 organizações escolhe a 2ª; conta em 1 não vê a tela) e Chromium (popup, marca a 2ª) | token e `axial://me` com a organização escolhida; refresh a mantém |
| CSRF | POST sem cookie, com token errado, com `Sec-Fetch-Site: cross-site` e `same-site` | 403 "Formulário expirado" em todos; com cookie e `same-origin`, 303 |
| Cookie SameSite vindo de outro site | atributos (`HttpOnly`, `SameSite=Strict`, `Path=/identity/oauth`; `Secure` só com emissor HTTPS) e Chromium real: host em `localhost`, Kairos em `127.0.0.1` (sites diferentes), navegação na mesma aba e em popup (como o claude.ai) | o cookie é gravado na navegação de outro site e reenviado no POST do formulário (navegação de nível superior); login conclui |
| Redirect de volta | cliente registrado com `https://claude.ai/api/mcp/auth_callback`, `https://chatgpt.com/connector_platform_oauth_redirect`, `cursor://anysphere.cursor-mcp/oauth/callback` e `http://localhost:33418/callback`; CSP sem `form-action` | 303 para cada destino exato com `code`, `state` e `iss`; cada código foi trocado por token; no Chromium o navegador chegou ao callback do host; "Cancelar" → `access_denied` |

Não foi encontrado defeito no login OAuth; nada foi alterado no código de OAuth do ms-identity. Limites: o
`cursor://` foi verificado no cabeçalho `Location` (o Chromium headless não abre apps externos); o teste usa
HTTP, então o atributo `Secure` (ativo com emissor HTTPS) e o caminho por Traefik não foram exercidos; ChatGPT e
Claude reais não foram usados.

Testes do mcp-server:

- `mcp.integration.test.ts` (42, `connectMcpClient` sobre o `AppModule` real e upstream simulado): catálogo
  completo (49 ferramentas, recursos, prompts) para token OAuth `projects:read projects:write`; scope declarado em
  cada primitiva; as 8 ferramentas originais; token OAuth só de leitura recusado com `InsufficientScopeError`
  (`projects:write`) em `create-task`, `update-task-status`, `delete-task` e `set-notification-event-preference`, sem
  chamar serviço; o mesmo token lê ferramentas (ms-projects, ms-audit, ms-identity), recursos e `axial://me`; token
  só de escrita não lê ferramenta, recurso nem prompt; token OAuth de outro recurso recusado; token de primeira parte
  (VIEWER) com os dois scopes e 403 do serviço; autenticação (sem token, outra chave, outra audiência, expirado,
  claims inválidas); encaminhamento do token e filtros; 404, 403, 5xx e 400 do serviço; 409 com orientação;
  confirmação nas eras legacy e modern, com e sem elicitação; progresso do lote; listas da organização;
  `search-tasks`; critérios `{text, done}` com string legada; `color` validada; recursos e prompts com dados.
- `stdio.test.ts` (2): processo `src/stdio.ts` real; recusa partida com token de outra chave; age como o usuário,
  relê o arquivo, aplica scope OAuth (`projects:read` → `Forbidden [403]: Insufficient scope…` ao escrever) e recusa
  token inválido com 401.
- `verifier.test.ts` (3), `scopes.test.ts` (3, de `dev`), `upstream.test.ts` (5), `format.test.ts` (3).

E2E real (`test/e2e.mjs`, chaves efêmeras e organizações aleatórias, sem apagar dados): projeto com `color`,
tarefa com critérios `{text, done}` e string legada, bloqueador, movimento com versão, 409 com versão antiga,
atribuição, sprint, lote com progresso, `list-sprints` da organização, `search-tasks` por responsável, comentário,
recurso do quadro, prompt de risco, exclusão com `confirm`, isolamento entre organizações, token OAuth só de
leitura lê e recebe `InsufficientScopeError` ao escrever, VIEWER recebe 403 do ms-projects, CONTRIBUTOR recebe 403
ao editar o projeto.

Não executados por não haver mudança nesses serviços: `pnpm test:integration`/`test:e2e` do ms-projects,
`test:web:e2e` (apps/web é de outro agente), integrações de audit, notifications e realtime.

## Análise dos serviços para tokens OAuth

| Serviço | Token delegado (`aud` = [`axial-projects`, recurso MCP], `scope`, `source: mcp`) | Mudança |
| --- | --- | --- |
| ms-projects | aceito (verifica `aud` contendo `axial-projects`) | nenhuma |
| ms-audit | aceito; leitura limitada por papel (ADMIN/PM/TL) e projetos do token; não olha `scope` | nenhuma |
| ms-notifications | aceito; tudo é do próprio usuário; não olha `scope` | nenhuma |
| ms-identity | recusado em todas as rotas (401) | diretório (`/organization/members`, `/organization/teams`) aceita com `projects:read`; sem ele 403 |

Os eventos gravados por chamadas OAuth levam `source: mcp` (claim emitida pelo ms-identity). Tokens de primeira
parte usados no MCP continuam com o `source` da sessão (`ui`/`api`).

## Lacunas e limites

1. **Administração de identidade fora do MCP:** criar/editar equipe, membros de equipe, acesso a projeto, criar e
   editar membro, papéis, convites e senhas. Exigiria aceitar tokens delegados em rotas de administrador do
   ms-identity; ficou de fora em vez de abrir essa superfície. Também fora: trocar destino de canal de notificação
   e confirmar código (presença humana) e templates/provedores de notificação.
2. **ms-audit e ms-notifications não conferem `scope`.** O MCP exige `projects:read`/`projects:write`, mas um
   token delegado usado diretamente nesses serviços (fora do MCP) não é limitado pelo scope.
3. **Scopes grossos:** só leitura e escrita; não há scope separado para auditoria ou notificações.
4. **ms-audit, ms-notifications e ms-identity** foram verificados no MCP com upstream simulado; o E2E real cobre o
   ms-projects. O aceite do token delegado pelo diretório foi verificado na integração real do ms-identity.
5. **Sem lote atômico:** `assign-tasks-to-sprint` faz leitura + PATCH por tarefa (cada um com a versão lida);
   falhas parciais são reportadas, não desfeitas.
6. **Sem `GET /comments/:id`:** a confirmação de `delete-comment` não mostra o texto.
7. **Catálogo de notificações** repetido no enum de `set-notification-event-preference` (vive no ms-notifications,
   fora de `@axial/contracts`).
8. **Prompts** leem até 500 tarefas e filtram no MCP, avisando quando truncam; mostram `@<8 caracteres do id>` em
   vez de nomes (o modelo pode cruzar com `list-members`).
9. **Implantação:** `deploy/compose.yaml` passa `AUDIT_API_URL`, `NOTIFICATIONS_API_URL` e `IDENTITY_API_URL` ao
   mcp-server (URLs base; o MCP acrescenta `/api/v1`). O ms-identity precisa ser implantado junto para
   `list-members`/`list-teams` funcionarem com tokens OAuth; sem ele, essas duas ferramentas devolvem
   `Unauthenticated [401]` claro. O caminho real por gateway e Traefik não foi verificado aqui.
