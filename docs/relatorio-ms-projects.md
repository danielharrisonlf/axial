# Relatório de implementação - Axial / ms-projects

Data: 05/11/2026. Escopo: monorepo Axial e serviço de projetos, conforme apresentação definitiva fornecida pelo usuário. Repositório: [danielharrisonlf/axial](https://github.com/danielharrisonlf/axial), privado.

Este relatório registra a entrega inicial do backend. Na etapa seguinte, a API foi movida para apps/api e a interface React/Vite foi criada em apps/web; veja o [relatório dessa etapa](relatorio-web.md). Os limites de frontend citados abaixo se referem ao escopo inicial.

## Resultado

Foi criado um monorepo independente do protótipo, com apenas um serviço executável: `apps/api`. Não houve alteração do código do protótipo, da landing page ou dos repositórios usados como referência.

A API possui **39 operações documentadas** (incluindo duas de saúde), persistência real no PostgreSQL e publicação BullMQ em três filas. A implementação cobre planejamento, execução e projeções dos dados de projetos; consumidores e aplicações futuras permanecem separados.

## O que foi entregue

| Área | Implementação |
| --- | --- |
| Monorepo | pnpm 10.11.1, Turborepo, apps/packages, catálogo e lockfile único |
| Serviço | NestJS 12 ESM, TypeScript estrito, injeção explícita, configuração validada |
| Contratos | Pacote @axial/contracts com Zod, tipos de identidade, eventos e entradas HTTP |
| Banco | Prisma 7, adapter PostgreSQL, schema projects e migration inicial versionada |
| Projetos | Criação/listagem/detalhe/edição, chave imutável, filtros, arquivo e restauração |
| Planejamento | Épicos, sprints, marcos e cronograma |
| Trabalho | Tarefas, bugs, subtarefas, prioridades, responsáveis, equipes, critérios, labels e estimativas |
| Kanban | Colunas por status, movimentação, posição, filtros e paginação |
| Dependências | Bloqueadores, validação de referências e ciclos explícitos/implícitos |
| Comentários | Autoria, leitura, criação e edição/exclusão com autorização |
| Indicadores | Progresso, atrasos e pontos estimados/concluídos sem dupla contagem de subtarefas |
| Acesso | JWT RS256, tenant, escopo de projetos/equipes e cinco papéis |
| Concorrência | Versão obrigatória, bloqueio por projeto, sequência atômica e sprint ativa única |
| Eventos | Outbox na mesma transação; relay com lease, retry e fanout nas três filas |
| Operação | Liveness/readiness, shutdown, logs estruturados, correlação e erros redigidos |
| Desenvolvimento | Compose PostgreSQL/Redis, seed idempotente e emissor de tokens exclusivamente local |
| Documentação | Requisitos, arquitetura, identidade/API/eventos, operação e OpenAPI versionado |
| Automação | Workflow GitHub Actions com lint, tipos, build, migrations e testes reais |
| Imagem | Build Linux validado e execução com usuário não root |

## Decisões relevantes

1. **O PDF final prevalece sobre o protótipo:** cinco microsserviços, PostgreSQL por schema e BullMQ/Redis. Não foi implementada a arquitetura anterior SNS/SQS nem um assistente interno de IA.
2. **Identidade fica fora de projects:** o serviço verifica tokens e referências assinadas. Não cria usuários, equipes ou tabelas em schemas de outros serviços.
3. **Auditoria é um consumidor futuro:** before/after, ator, origem e correlação ficam no envelope durável. Não foi criada uma central de auditoria dentro do serviço de projetos.
4. **Consistência antes de paralelismo dentro do agregado:** mutações de um mesmo projeto são serializadas por bloqueio transacional e verificam versões. Projetos diferentes não usam o mesmo bloqueio.
5. **Sprints encerradas preservam histórico:** tarefas concluídas ficam associadas; inacabadas voltam ao backlog. Regras adicionais não expressas no PDF estão descritas em requirements.md.
6. **Entrega pelo menos uma vez:** jobs têm ID estável e o outbox só confirma após as três filas. Consumidores ainda precisam de deduplicação durável e tratamento de reordenação.

## Validação executada

| Verificação | Resultado observado |
| --- | --- |
| Prisma validate e geração do cliente | Aprovados |
| Migrations em bancos vazios axial_dev e axial_test | Aplicadas com sucesso |
| pnpm lint | Aprovado, sem erros ou avisos |
| pnpm typecheck | Aprovado nos dois pacotes |
| pnpm build | Aprovado nos dois pacotes |
| Contratos unitários | 9 testes aprovados |
| Unidade do serviço/configuração | 3 testes aprovados |
| Integração PostgreSQL/Redis | 3 testes aprovados |
| E2E HTTP com PostgreSQL | 13 testes aprovados |
| Total automatizado | **28 testes aprovados, nenhum ignorado** |
| GitHub Actions em Ubuntu/Linux | **Aprovado** no commit de implementação 6d2ee6a; [execução CI 41969258030](https://github.com/danielharrisonlf/axial/actions/runs/41969258030) |
| Auditoria de dependências de produção | Nenhuma vulnerabilidade conhecida reportada pelo pnpm audit no momento da execução |
| Build Docker Linux do candidato final | Aprovado |
| Runtime em produção no contêiner | Liveness/readiness 200; sem token 401; leitura autenticada 200; Swagger 404 |
| Usuário do contêiner | UID 1000 |
| Relay real na demonstração | 6 de 6 eventos publicados; 6 jobs em cada uma das três filas |
| Verificação de padrões de credenciais nos fontes | Nenhuma chave privada/token encontrado |
| Validação da skill de orquestração atualizada | quick_validate: Skill is valid |

Os testes de banco usaram exclusivamente `axial_test`, e as filas de teste usaram o banco lógico Redis 15. O contêiner de aceitação foi parado e removido após o smoke test; dados e serviços de desenvolvimento foram preservados.

Imagem validada: `sha256:845885257c28c704d1cc2841d99dbfc21d8b289f2517bee3aa458ff1657517b9`.

A execução remota confirmou instalação por lockfile, geração Prisma, migration em banco vazio, lint, typecheck, build e todas as suítes. O código aceito está no commit `6d2ee6a00ca9be72d9e0499c54a1fd59178457f3`; a atualização posterior deste relatório altera apenas documentação e preserva esse candidato.

## Falhas encontradas e corrigidas

- **PATCH com defaults indevidos:** Zod aplicava padrões de criação em campos omitidos, podendo sobrescrever dados e impedir contributor de editar sua própria tarefa. Os schemas parciais removem os defaults; regressões de contrato e HTTP passaram.
- **Ciclo entre pai e subtarefa:** o grafo só de bloqueadores não representava a condição de concluir subtarefas antes do pai. A validação passou a considerar essas arestas implícitas, inclusive na criação de filhos e em cadeias indiretas.
- **Inicialização com dependência transitiva:** o bootstrap importava Express sem declará-lo diretamente. Foi substituído pelo método público useBodyParser do adapter NestJS.
- **Erros do parser:** JSON malformado e excesso de tamanho têm respostas 400/413 redigidas e cenários de regressão.
- **Qualidade e compatibilidade:** middleware usa wildcard compatível com a versão atual e a configuração Biome foi migrada para o preset vigente.

## Agentes, skills e modelo

Foram usadas as skills PDF, Vitest, skill-creator e orquestração. Após a orientação do usuário, implementação, validação e revisão passaram a usar exclusivamente **GPT-6.1 Sol com raciocínio high**. O agente de testes incompatível foi interrompido e substituído; seus arquivos foram preservados e revalidados pelo agente Sol.

A skill global `C:/Users/daniellima/.agents/skills/astra-orchestrator/SKILL.md` foi atualizada e validada. O identificador histórico foi preservado, e sua política agora exige Sol/high em todos os papéis, sem substituição automática. AGENTS.md do Axial registra o mesmo padrão. Isso não altera retroativamente o modelo usado no planejamento anterior nem troca o modelo de uma sessão raiz já iniciada.

## Limites e próximos componentes

- Não estão implementados ms-identity, ms-notifications, ms-audit, ms-realtime, gateway, mcp-server nem frontends React/Vue. (Situação desta entrega; o mcp-server foi entregue depois, com verificação própria em [relatorio-mcp-server.md](relatorio-mcp-server.md), incluindo E2E contra este serviço.)
- Jobs publicados não comprovam entrega de mensagens, sincronização WebSocket ou gravação no futuro serviço de auditoria.
- Referências de identidade são snapshots assinados; revogação imediata depende da futura integração com identidade.
- OpenAPI possui schemas de entrada e parâmetros; não oferece schemas completos de resposta para geração automática de clientes nesta etapa.
- A imagem de execução inclui ferramentas de build. Reduzir seu tamanho é uma otimização futura.
- A política de retenção/arquivo de eventos e jobs deve ser definida com os consumidores. Perda total de Redis após confirmação exige recuperação operacional a partir do outbox.
- Não houve deploy em ambiente de produção.
- Semantica não estava disponível; decisões e evidências ficaram registradas nos documentos versionados, sem alegação de persistência em memória durável externa.

## Referência verificável do escopo

SHA256 do PDF fornecido: `fb425e27798fe02228a327946943e56f36838260362eedb5475cc2a9b225fee5`. A correspondência de requisitos por página está em requirements.md; convenções e revisões dos repositórios recentes estão em architecture.md.

## Atualização 2026-11-18: OAuth 2.1 para clientes MCP

O ms-identity passou a ser servidor de autorização OAuth 2.1 (metadados RFC 8414, registro dinâmico RFC 7591, PKCE S256, `resource` RFC 8707, refresh token rotativo com detecção de reuso; migration `004_oauth`). O gateway roteia `/.well-known/oauth-protected-resource*` ao mcp-server e `/.well-known/oauth-authorization-server/identity`, `/.well-known/openid-configuration/identity` e `/identity/*` ao ms-identity. O mcp-server exige `projects:read` nas ferramentas de leitura e `projects:write` em `create-task`/`update-task-status` para tokens OAuth; tokens sem `scope` (Workspace e script de desenvolvimento) mantêm acesso completo.

Verificação local: `pnpm lint`, `pnpm typecheck`, `pnpm build` e `pnpm test` aprovados; `test:identity:integration` (suíte existente e nova suíte OAuth), `test:mcp:integration`, `test:gateway:integration`, `test:integration` e `test:e2e` aprovados contra PostgreSQL `axial_test` e Redis lógico 15. `test:identity:interop` só passa com `BETTER_AUTH_SECRET` no ambiente (o script não o define, falha anterior a esta mudança). Um teste descartável com o SDK oficial `@modelcontextprotocol/client` 2.4.0 conectou pelo gateway com ms-identity e mcp-server reais: descoberta, registro, login, troca de código com `iss`, chamada de ferramenta e refresh.

Limites: não houve teste com Claude, ChatGPT ou Cursor reais nem no domínio público; o limite de tentativas por IP vê o IP do gateway; access tokens OAuth valem até 1 hora após a revogação do membro; dois refresh concorrentes com o mesmo token revogam a família.

## Atualização de 18/11/2026: política compartilhada, listas da organização e correções de integração

- **Política compartilhada:** `packages/contracts/src/policy.ts` exporta as regras de autorização do ms-projects como funções puras; o serviço e o escopo do repositório passaram a usá-las. A matriz dos cinco papéis tem testes unitários.
- **Novos campos:** `Project.color` opcional (`#RRGGBB`, com CHECK no banco) e critérios de aceite como `[{text, done}]` em JSONB. A migration `202611180002_acceptance_criteria_objects` converte arrays de texto existentes em `{text, done: false}` preservando a ordem; a entrada ainda aceita strings.
- **Listas da organização:** `GET tasks`, `epics`, `sprints` e `milestones`, paginadas e limitadas aos projetos legíveis pelo ator (incluindo arquivados, como nas rotas por projeto). OpenAPI regenerado; os corpos de requisição passaram a ser documentados na forma de entrada, por isso campos com padrão deixaram de aparecer como obrigatórios.
- **ms-audit:** filtro `aggregateId` na listagem.
- **Correções:** o ms-realtime exige `PROJECTS_API_URL` com `/api/v1` (Compose e script de performance corrigidos); o catálogo do ms-notifications usa os nomes emitidos (`task.assigned` etc.), a migration 005 renomeia preferências `.v1` e remove `task.blocked.v1`, que nunca era emitido.

Validação local (Windows, PostgreSQL/Redis do Compose, banco isolado com sufixo `_test`): lint, typecheck, build e testes unitários aprovados; e2e do ms-projects (15), integração do ms-projects (3), integrações do ms-audit, ms-notifications, ms-realtime e mcp-server aprovadas; `prisma migrate status` e `prisma migrate diff` sem diferença; conversão de dados legados conferida em banco descartável. `test:web:e2e` não foi executado nesta etapa. Os dados fictícios do web ainda usam nomes `.v1` em `apps/web/src/data/demo-seed.json`.

## Atualização de 18/11/2026: seed de demonstração Vetor Labs

- **Cenário compartilhado:** `packages/demo-fixtures` traz o cenário fictício do Workspace (Vetor Labs e Atlas) com ids UUIDv5 determinísticos, o deslocamento de datas do web em `America/Sao_Paulo` e um validador contra os contratos e as invariantes do ms-projects. Detalhes em `docs/demo-seed.md`.
- **ms-projects:** `pnpm db:seed` grava 11 projetos, 14 épicos, 7 sprints, 10 marcos, 109 tarefas, 1 dependência e 33 comentários, uma transação por projeto, só inserindo. Refs, datas históricas e `taskSequence` preservados (a próxima tarefa de PCL é `PCL-120`). Nenhum evento de outbox é gravado. O projeto `AXL` do seed anterior não é mais criado nem removido.
- **ms-audit:** `pnpm db:audit:seed` grava 74 eventos com `ON CONFLICT (id) DO NOTHING`.
- **Tokens locais:** `scripts/dev-identity.mjs` assina como pessoas semeadas da Vetor Labs com as claims do cenário.
- **Fora do cenário:** o comentário `cm12` e a entrada de auditoria `au69` do protótipo cruzam organizações e não são semeados. O seed do ms-identity ainda não existe; até lá, login real não encontra as pessoas do cenário (os tokens locais funcionam).

Validação: seeds executados duas vezes em banco `_test` descartável (segunda execução sem inserções), além do teste de integração `apps/api/test/integration/demo-seed.test.ts` e do script `apps/ms-audit/test/seed.mjs`.

## Atualização de 18/11/2026: seed do ms-identity e política única de senha

- **ms-identity:** `pnpm db:identity:seed` (`apps/ms-identity/src/seed-demo.ts`) grava só no schema `identity` 2 organizações, 18 contas BetterAuth (e-mail verificado, credencial com hash do BetterAuth a partir de `AXIAL_DEMO_PASSWORD`), 19 vínculos com cargo, 7 equipes com descrição e líder, 20 membros de equipe e 32 atribuições a projetos, só inserindo e com ids determinísticos. Roda primeiro em `pnpm db:seed:demo`, em `deploy/setup.sh` (que para com erro se `AXIAL_SEED=true` e faltar `AXIAL_DEMO_PASSWORD`) e em `pnpm start`/`pnpm perf` (fixture só local).
- **Cenário:** como no protótipo o administrador enxerga todas as organizações, Helena Costa recebe também um vínculo `ADMIN` na Atlas; `claimsFor` aceita a organização.
- **Senha:** signup, convite, `POST auth/password`, `POST members`, reset administrativo, `bootstrap` e o próprio BetterAuth aceitam de 10 a 128 caracteres (`PASSWORD_MIN_LENGTH`/`PASSWORD_MAX_LENGTH` em `apps/ms-identity/src/common.ts`).

Validação: `apps/ms-identity/test/seed.mjs` (em `pnpm test:identity:integration`) semeia duas vezes um banco `_test` descartável (segunda sem inserções, sem novos hashes nem eventos de outbox), faz login real de Helena Costa (escolha entre as duas organizações) e de Ricardo Nogueira (tokens direto) e confere as claims com `claimsFor`. `pnpm db:seed:demo` rodou duas vezes num banco `_dev` descartável com as migrations de projects, identity e audit (segunda execução sem inserções nos três schemas), e o banco foi removido em seguida.

## Atualização de 18/11/2026: cadastro de empresas, convites e sessão do navegador (ms-identity)

- **Endereço do cliente:** o gateway confia em `GATEWAY_TRUST_PROXY` saltos (1 atrás do Traefik no Dokploy) e envia aos serviços só o endereço resolvido em `X-Forwarded-For`; o ms-identity confia em um salto (`IDENTITY_TRUST_PROXY=1`). Os limites de tentativa deixaram de ver o IP do gateway e passaram a contar por cliente.
- **Login sem organização:** com um vínculo ativo devolve tokens; com vários, `{requiresOrganization, organizations, sessionToken}` sem access token, e a escolha é feita em `POST auth/session` com `X-Organization-Id`; sem vínculo, 401 genérico.
- **Sessão do navegador:** cookie `kairos_session` (HttpOnly, Secure configurável, SameSite=Lax, `Path=/api/v1/auth`, host da API) aceito em `auth/session` e apagado em `auth/logout`; tokens dessas sessões têm `source=ui`.
- **Cadastro e convites:** `POST auth/signup` (desligado por padrão, `IDENTITY_SIGNUP_ENABLED`) cria conta, empresa e administrador numa transação; convites por link (`/api/v1/invitations`, roteado pelo gateway) com token guardado só como hash, 7 dias, uso único; conta existente aceita só com a própria senha.
- **Diretório:** `GET organization/members` e `GET organization/teams` para qualquer membro ativo; `GET me` com nome, e-mail, cargo e vínculos. Migration `005_profiles_invitations`.

Validação local (Windows, PostgreSQL de teste em 5550): lint, typecheck, build e testes unitários aprovados; `test:identity:integration` (três suítes, incluindo a nova `accounts-integration.mjs`), `test:identity:interop` (com `BETTER_AUTH_SECRET` e Redis lógico 12), `test:gateway:integration` e `test:mcp:integration` aprovados. Não verificado: comportamento real do Traefik do Dokploy com `X-Forwarded-For` e o cookie num navegador no domínio público; o Workspace ainda não usa o cookie nem as telas de cadastro e convite. Não há rota para editar `teams.description`, `teams.lead_user_id` nem o cargo de um membro já existente.

## Atualização de 18/11/2026: Workspace no backend real (modo API)

- **Fonte fixada no build:** `VITE_WORKSPACE_SOURCE=api` em todo build (Docker fixa `api`), `demo` só em `pnpm dev:web` e no e2e legado. No build API a demonstração (store, seed e `demo-seed.json`) não é emitida; conferido no `dist`. Nenhum dado de projeto/tarefa vem do localStorage: só tema, empresa escolhida, favoritos e projeto selecionado.
- **Sessão:** login, escolha de empresa, cadastro, convite por link e troca forçada de senha em português; access token só em memória, renovado 60 s antes do fim pelo cookie `kairos_session` (`auth/session` + `X-Organization-Id`), renovação única em 401 com uma nova tentativa, `BroadcastChannel` para saída e troca de empresa entre abas.
- **Leitura e escrita:** a empresa inteira é lida dos serviços (listas paginadas até o fim); escritas otimistas com `version`, em fila por recurso, revertidas em 409 (aviso “Alguém alterou este item; os dados foram recarregados” e releitura do projeto) e 403; falha de leitura mostra “Serviço indisponível”, mantém os últimos dados e desativa escritas. Realtime (`/ws`) relê o projeto invalidado.
- **Administração:** papéis, desativação e convites por link (lista e revogação) para ADMIN; equipes somente leitura.
- **MCP:** o console do Workspace chama `POST /mcp` com o token da pessoa (audiência `axial-projects`, sem `scope`, aceito pelo mcp-server com todos os escopos); a aba “Conectar um agente” mostra a URL do build (`VITE_API_BASE_URL` + `/mcp`) e os passos para Claude Code, Claude, ChatGPT e Cursor.

Validação local (Windows): lint, typecheck, build e testes unitários aprovados (web: 47 testes, incluindo mapeadores, renovação única, nova tentativa após 401, paginação e escritas com 409/403). E2E legado em modo demonstração. Teste de stack `apps/web/tests/stack` (7 cenários) contra a stack local em banco descartável `axial_webstack_test` com o cenário Vetor Labs: login do Ricardo e criação de tarefa no PCL, Camila vendo a tarefa, tarefa criada via MCP aparecendo no Kanban aberto do Ricardo sem recarregar e depois do reload, escolha e troca de empresa da Helena, cadastro de empresa nova com Workspace vazio, convite por link aceito, aba MCP com a URL configurada. Não verificado: deploy real (domínio público, cookie entre `kairos.noxlabs.tech` e `api.kairos.noxlabs.tech` atrás do Traefik). Sem serviço ainda: histórico de notificações, templates e provedores (ocultos), edição de equipes, criação de marcos (a interface do protótipo não tem a tela).

## Atualização de 18/11/2026: seed de demonstração só na primeira execução e sem bloquear o deploy

Incidente: o seed do identity abortou em produção ("Identity demo seed left 17 of 18 users") porque o e-mail de um usuário de demonstração tinha sido alterado; o `setup` falhou e nenhum serviço subiu. Além disso, cada deploy recriava tarefas, comentários, vínculos, membros de equipe e atribuições apagados pelos usuários.

- **Só na primeira execução:** identity pula tudo quando alguma organização do cenário existe (transação única sob advisory lock); ms-projects decide projeto a projeto pela linha `Project` (projetos não podem ser apagados, e um projeto ausente depois de uma execução interrompida é gravado completo); ms-audit pula quando algum evento do cenário existe (transação única sob advisory lock). Sem tabela de marcador nem migration: o próprio dado serve de marcador, inclusive em bancos semeados antes da mudança. Execuções seguintes respondem `"status": "already seeded"` e não escrevem nada.
- **Divergência não falha:** contagens por chave primária (usuários só pelo id); linhas faltando, e-mail ou nome alterado, e-mail do cenário já usado por outra conta (o usuário e o que depende dele ficam de fora) e chave de projeto tomada por outro projeto (o projeto fica de fora) viram `warnings` no relatório JSON, com código 0. Erros de banco continuam falhando.
- **`deploy/setup.sh`:** migration com falha ainda falha o setup; seed com falha imprime o erro e `[setup] AVISO: seed de demonstração falhou: <serviço> (código N): <erro>`, pula os passos seguintes e o setup termina com 0. Sem `AXIAL_DEMO_PASSWORD`, aviso e o seed inteiro é pulado. `deploy/setup.test.sh` testa esses caminhos com stubs.

Validação local (Windows, PostgreSQL de teste em 5550, Redis lógico 8): `sh -n deploy/setup.sh`, `sh deploy/setup.test.sh`, lint, typecheck, build e testes unitários aprovados; `test:identity:integration` (o seed é repetido depois de trocar um e-mail e apagar um vínculo; e-mail tomado por outra conta num segundo banco), `test:integration` (tarefa e comentário apagados não voltam, projeto ausente é completado, chave tomada pula o projeto), `test:e2e` e `test:audit:integration` (evento removido não volta) aprovados. A primeira execução de `test:audit:integration` falhou uma vez sem a saída completa capturada; quatro execuções seguintes passaram. Não verificado: deploy real no VPS.
