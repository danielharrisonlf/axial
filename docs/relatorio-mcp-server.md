# Relatório do servidor MCP

Entrega em 17/11/2026, branch `feat/mcp-server-complete` (a partir de `dev`). Escopo de edição: `apps/mcp-server`,
documentação e o lockfile (nova dependência `@axial/contracts` do MCP). Nenhum outro serviço foi alterado.

## O que mudou

Antes: 8 ferramentas sobre o ms-projects, sem recursos nem prompts, todo token com `projects:read`/`projects:write`.

Agora (catálogo completo em [apps/mcp-server/README.md](../apps/mcp-server/README.md)):

| Primitiva | Quantidade | Destaques |
| --- | --- | --- |
| Ferramentas | 52 | 21 leituras, 24 escritas e 7 destrutivas com confirmação; 40 no ms-projects, 2 no ms-audit, 4 no ms-notifications e 6 no ms-identity |
| Recursos | 2 | `axial://me`, `axial://projects` |
| Templates | 4 | `axial://projects/{projectId}`, `…/board` (Markdown), `axial://tasks/{taskId}`, `axial://sprints/{sprintId}` |
| Prompts | 4 | `planejar-sprint`, `relatorio-de-risco`, `refinar-tarefa`, `resumo-semanal` |

O teste de catálogo compara a lista exata dos 52 nomes e as annotations de cada um.

Decisões principais:

- **Identidade só do token verificado.** HTTP: `AuthInfo` do módulo. stdio: token de `MCP_ACCESS_TOKEN_FILE`
  (ou `MCP_ACCESS_TOKEN`) verificado na partida e a cada chamada pelo mesmo verificador; sem token válido o processo
  não inicia e as chamadas falham com 401. Nenhum argumento ou header escolhe organização, usuário ou papel.
- **Scopes** `projects:read|write`, `audit:read`, `notifications:read|write`, `identity:read|write`: teto pelo papel
  (espelha a matriz de `api-contracts.md` e as regras de ms-audit/ms-identity) reduzido pela claim `scope`, se o
  emissor a enviar. HTTP: `insufficient_scope` 403 do módulo; stdio: `StdioScopeGuard` com a mesma regra.
- **Entradas derivadas de `@axial/contracts`** (enums e validadores de título, chave, labels, critérios etc.) com
  `.describe()`; **saídas** (`outputSchema`) em 10 leituras principais, com os enums dos contratos.
- **Concorrência:** toda escrita envia `version`; exclusões usam `?version=`. 409 → "Conflict [409]: … Read the
  resource again to get its current version …". `update-task-dependencies` lê os bloqueadores atuais e grava com a
  versão informada pelo agente (não com a lida), para não mascarar alterações concorrentes.
- **Destrutivas** (`delete-*`, `archive-project`, `complete-sprint`): elicitação `inputRequired`/`acceptedContent`
  na era 2026-07-28 quando o cliente declara `elicitation`; senão exige `confirm: true`. A pergunta mostra o que será
  afetado (ex.: quantas tarefas voltam ao backlog ao encerrar a sprint).
- **Erros** mapeados por `McpErrorFilter`, sem repassar corpos 5xx, textos longos ou ids de correlação inseguros.
- **Lote:** `assign-tasks-to-sprint` reporta progresso por tarefa, respeita `ctx.signal` e devolve o resultado
  individual; não é atômico (ver lacunas).
- **`MCP_ALLOWED_HOSTS`** passou a ser configurável (antes fixo em localhost), para publicar atrás do gateway.
- Removido `src/tools.ts`; o servidor passou a se chamar `axial` (versão 2.0.0) e a descrição cobre os quatro serviços.

## Verificação executada

Ambiente: Windows 11, Node 24, pnpm 10.11.1, Docker 29.9.1 (contêineres Linux). `pnpm infra:up` subiu PostgreSQL
(5549 e 5550) e Redis (6389); `pnpm db:generate` e migrations aplicadas em `axial_test`.

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | 197 arquivos, 0 erros |
| `pnpm typecheck` | 13/13 tarefas Turbo; o MCP agora também checa `test/` (`tsconfig.check.json`) |
| `pnpm build` | 11/11 tarefas |
| `pnpm test` | 12/12 tarefas; mcp-server 49 testes em 6 arquivos, todos passando |
| `pnpm --filter @axial/mcp-server test:integration` | processo HTTP real + upstream simulado: auth 401, metadata com os 7 scopes, encaminhamento do token, 403 `insufficient_scope` com `WWW-Authenticate` — passou |
| `pnpm --filter @axial/mcp-server test:e2e` (`TEST_DATABASE_URL=…/axial_test`) | ms-projects real + MCP HTTP real — passou |
| `pnpm test:integration` (ms-projects) | 3/3 |
| `pnpm test:e2e` (ms-projects) | 13/13 |
| `pnpm test:web:e2e` | 11/11 (Playwright/Chromium) |

Testes do mcp-server (vitest):

- `mcp.integration.test.ts` (34 testes, `connectMcpClient` sobre o `AppModule` real e upstream simulado): catálogo
  exato com descrições, `.describe()` em todo argumento, annotations e `outputSchema`; recursos, templates e prompts;
  token ausente, de outra chave, de outra audiência, expirado e com claims inválidas; `insufficient_scope` para
  VIEWER, para claim `scope` reduzida, para CONTRIBUTOR em auditoria/identidade e em recurso e prompt; encaminhamento
  do token e filtros; projeto de outra organização → `Not found [404]` claro; 403 do serviço; 5xx sem vazamento;
  issues de validação; 409 com orientação; confirmação destrutiva em legacy (`confirm`), modern sem elicitação,
  modern com elicitação aceita e recusada; progresso do lote com sucesso e 409 parcial; Kanban em Markdown; recursos
  de tarefa e sprint, UUID inválido, 404 como erro de recurso; os quatro prompts com dados reais; ms-audit,
  ms-notifications e ms-identity com o token do chamador.
- `stdio.test.ts` (2): processo `src/stdio.ts` real com `StdioClientTransport`; recusa partida com token de outra
  chave; age como o usuário do token, relê o arquivo (troca para VIEWER → `Forbidden [403]: Insufficient scope…`
  sem chamada ao serviço; troca para token inválido → `Unauthenticated [401]`).
- `verifier.test.ts` (2), `scopes.test.ts` (3), `upstream.test.ts` (5), `format.test.ts` (3).

E2E real (`test/e2e.mjs`), com chaves efêmeras e organizações aleatórias (não apaga dados): `create-project`,
`create-task` (com bloqueador), `update-task-status` com versão, o mesmo movimento com versão antiga → 409,
`assign-task`, `create-sprint`, `assign-tasks-to-sprint` com progresso 1→2, `list-tasks` por sprint, comentário,
recurso do quadro com "bloqueada por", prompt de risco, exclusão recusada sem `confirm` e aceita com `confirm: true`
(cliente legacy), token de outra organização → 404, VIEWER lê mas recebe `InsufficientScopeError` ao escrever,
CONTRIBUTOR recebe 403 do ms-projects ao editar o projeto.

### Observações

- `pnpm test:web:e2e` foi executado porque o lockfile mudou; a mudança não toca o Workspace (11/11).
- O build do Insights registra `[Module Federation DTS] … TYPE-001` sem falhar a tarefa; já ocorria antes e não
  envolve o MCP. Não houve migrations novas (o MCP não tem banco); as existentes foram aplicadas em `axial_test`.
- Após a última alteração (`MCP_ALLOWED_HOSTS`), lint, typecheck, build, `pnpm test`, a integração HTTP e o E2E real
  do MCP foram executados de novo, com os mesmos resultados.

## Lacunas de API e limites

Nada foi implementado fora do MCP; as lacunas abaixo dependem dos serviços donos.

1. **Sem servidor de autorização OAuth.** O metadata aponta o emissor como `authorization_servers`, mas o
   ms-identity não publica `/.well-known/oauth-authorization-server`, `authorize`, `token` nem registro dinâmico.
   Clientes MCP não obtêm token pelo fluxo OAuth: o token é colado no header (HTTP) ou num arquivo (stdio).
2. **Tokens curtos sem renovação para agentes** (5 min do login, 15 min do emissor local). No HTTP é preciso
   reconfigurar o header; no stdio basta regravar o arquivo. Não há token de longa duração nem refresh para agentes.
3. **Origem `mcp` na auditoria.** O `source` dos eventos vem da claim do token; o login emite `ui`/`api`. Chamadas
   pelo MCP só aparecem como `mcp` se o emissor criar tokens com `source: "mcp"` (o MCP não reemite tokens).
4. **Claim `scope` não emitida** pelo ms-identity: os scopes são o teto do papel. Para dar a um agente menos que o
   papel do usuário, o emissor precisa assinar `scope`.
5. **Sem diretório de pessoas para não administradores.** `GET /members` é só ADMIN; prompts e quadro mostram
   `@<8 primeiros caracteres do id>` em vez de nomes.
6. **Filtros ausentes em tarefas** (atrasadas, bloqueadas, alteradas desde): os prompts leem até 500 tarefas e
   filtram no MCP, avisando quando truncam.
7. **Sem planejamento em lote atômico.** `assign-tasks-to-sprint` faz leitura + PATCH por tarefa; falhas parciais
   são reportadas, não desfeitas.
8. **Sem `GET /comments/:id`**: a confirmação de `delete-comment` não mostra o texto do comentário.
9. **Catálogo de notificações** (`task.assigned.v1`…) fica em ms-notifications, fora de `@axial/contracts`; o MCP
   repete a lista no enum de `set-notification-event-preference` (risco de divergência).
10. **Deliberadamente não expostos:** criar membro (senha), trocar papel/ativar membro, redefinir senha, trocar
    destino de canal de notificação e confirmar código de verificação — exigem segredo ou presença humana.
11. **ms-audit, ms-notifications e ms-identity** foram verificados com upstream simulado; o E2E real cobre só o
    ms-projects (o real de auditoria exigiria relay e consumidor ativos).
12. **Gateway:** em produção, `MCP_RESOURCE` deve ser a URL pública e `MCP_ALLOWED_HOSTS` deve incluir o host
    público; o roteamento `/.well-known/oauth-protected-resource/mcp` pelo gateway não foi verificado.
    `MCP_ALLOWED_HOSTS` não está em `turbo.json` (o MCP lê o `.env` diretamente; só importa em execução via Turbo).

## Commits

Ver `git log dev..feat/mcp-server-complete`. Não houve push.
