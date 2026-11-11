# Axial

Plataforma interna de gestão de projetos, com API NestJS e Workspace React/Vite. O backend **ms-projects** usa PostgreSQL, contratos Zod e outbox transacional para Redis/BullMQ.

O fluxo definitivo é o da apresentação ProjectFlow fornecida em 05/11/2026: planejar, organizar acessos, executar, sincronizar, notificar e acompanhar. A interface de projetos reproduz o protótipo fornecido, com a marca **Axial**. O monorepo inclui ms-projects, ms-identity (BetterAuth), ms-realtime, ms-notifications, ms-audit, o gateway público, o servidor MCP e o microfrontend Vue de Insights.

## Estrutura

```text
apps/
  ms-identity/              # serviço NestJS de identidade, equipes e permissões
  ms-realtime/              # invalidações autenticadas por WebSocket
  ms-notifications/         # preferências e processamento de notificações
  api/                      # serviço NestJS @axial/ms-projects
    prisma/                 # schema projects, migration e seed local
    src/
      common/               # autenticação, configuração e validação
      infra/                # Prisma, saúde e relay BullMQ
      modules/              # controller, regras e transações de projetos
    test/                   # testes unitários, integração e HTTP
  gateway/                  # edge REST/WSS/MCP @axial/gateway
  mcp-server/               # resource server MCP @axial/mcp-server
  ms-audit/                 # trilha append-only @axial/ms-audit
  insights/                 # microfrontend Vue @axial/insights
  web/                      # Workspace React + Vite @axial/web
    src/components/         # shell, tabelas, formulários e drawer
    src/pages/              # projetos, dashboard, Kanban e planejamento
    src/data/               # demonstração local e persistência isolada
    src/styles/             # stylesheet original do protótipo
    tests/                  # aceitação no navegador com Playwright
packages/
  contracts/                # esquemas de entrada, tipos e eventos compartilhados
docs/                       # arquitetura, contratos e relatório
scripts/                    # emissor de identidade exclusivamente local
```

Convenções baseadas nos repositórios recentes `suporte-app`, `finflow` e `omni-crm-ai`: pnpm workspaces, Turborepo, ESM, TypeScript estrito, Prisma, Biome e Vitest.

## Executar localmente

Requisitos: Node.js 22.12 ou superior, pnpm 10.11.1 e Docker com contêineres Linux.

```powershell
Copy-Item .env.example .env
pnpm install --frozen-lockfile
pnpm infra:up
pnpm dev:keys
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- API: `http://localhost:3001/api/v1`
- Gateway: `http://localhost:3000`
- Workspace: `http://localhost:5173`
- Insights (remote): `http://localhost:5174`
- Swagger: `http://localhost:3001/docs`
- OpenAPI: `http://localhost:3001/docs/openapi.json`
- Liveness: `http://localhost:3001/api/v1/health/live`
- Readiness: `http://localhost:3001/api/v1/health/ready`

O seed cria dados fictícios em uma organização de demonstração e preserva registros existentes quando repetido. Só executa em banco terminado em `_dev` e rejeita `NODE_ENV=production`.

Para abrir somente a interface, sem dependência de Docker ou da API: `pnpm dev:web`. Para iniciar somente o backend: `pnpm dev:api`. O comando `pnpm dev` inicia Workspace e Insights. Serviços adicionais têm atalhos próprios: `pnpm dev:gateway`, `pnpm dev:mcp`, `pnpm dev:audit` e `pnpm dev:insights`.

O login do Workspace usa o endpoint de compatibilidade `POST /api/v1/auth/login`, que troca credenciais BetterAuth pelo JWT RS256 curto consumido por ms-projects, ms-notifications, ms-realtime, ms-audit e mcp-server.

### Workspace e fidelidade ao protótipo

A interface inicia na demonstração local, com os mesmos 11 projetos, 109 tarefas, pessoas, equipes, tipografia IBM Plex, cores, ícones, tabelas e painéis da referência. Projetos, detalhe com abas, tarefas, Kanban, backlog, sprints e cronograma são componentes React com interações reais e persistência no navegador.

O seletor de perfis é identificado como demonstração. Os dados ficam em `axial.workspace.demo.v1`; a aplicação não lê nem altera `projectflow.db.v1`, usado pelo protótipo original. Formulários e movimentações desta interface ainda não fazem chamadas ao backend. Não há fallback silencioso de API para dados fictícios. A integração HTTP e a identidade real são etapas futuras.

Veja [documentação do frontend](docs/frontend.md) e [validação visual](design-qa.md).

O emissor local substitui apenas a emissão do token para desenvolvimento. **Não há bypass de autenticação:** a API sempre verifica assinatura RS256, emissor, audiência, expiração e identidade. Chaves privadas ficam em `keys/`, fora do Git. O futuro ms-identity deverá emitir as mesmas claims ou fornecer JWKS HTTPS.

```powershell
$token = node scripts/dev-identity.mjs token
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod http://localhost:3001/api/v1/projects -Headers $headers
```

O token dura 15 minutos. Para criar tokens locais de outros papéis: `node scripts/dev-identity.mjs token VIEWER` (ou `PROJECT_MANAGER`, `TEAM_LEAD`, `CONTRIBUTOR`). Esses tokens usam os IDs fictícios do seed.

## Capacidades

- Projetos com chave estável, filtros, arquivamento e restauração.
- Épicos, tarefas, bugs e um nível de subtarefas; prioridades, responsáveis, equipes, labels, critérios de aceite e estimativas.
- Kanban com posição por tarefa, backlog, filtros e paginação.
- Dependências sem ciclos, incluindo bloqueios implícitos entre pais e subtarefas.
- Sprints planejadas, início e encerramento; apenas uma ativa por projeto.
- Comentários com autoria e permissão de edição/exclusão.
- Marcos, cronograma e indicadores sem dupla contagem de subtarefas.
- Controle de acesso por organização, projeto, equipe e papel; concorrência por versão.
- Eventos persistidos na mesma transação da alteração e publicação nas três filas previstas no PDF.
- Notificações com preferências por canal e por evento, catálogo de templates, estado dos provedores e histórico de entregas próprio.

## Verificação

```powershell
pnpm lint
pnpm typecheck
pnpm build
pnpm test
$env:DATABASE_URL = 'postgresql://axial:axial_local_only@localhost:5550/axial_test?schema=projects'
pnpm db:migrate
Remove-Item Env:DATABASE_URL
$env:TEST_DATABASE_URL = 'postgresql://axial:axial_local_only@localhost:5550/axial_test?schema=projects'
$env:TEST_REDIS_URL = 'redis://localhost:6389/15'
pnpm test:integration
pnpm test:e2e
pnpm --filter @axial/web exec playwright install chromium
pnpm test:web:e2e
```

Os testes de integração/HTTP recusam bancos cujo nome não termine em `_test`. Executam contra PostgreSQL e Redis reais, sem depender dos serviços futuros. O workflow CI repete os checks com serviços isolados.

## Documentação

- [Arquitetura e decisões](docs/architecture.md)
- [Requisitos e correspondência com o PDF](docs/requirements.md)
- [Identidade, API e eventos](docs/api-contracts.md)
- [Operação e variáveis de ambiente](docs/operations.md)
- [OpenAPI versionado](docs/api/openapi.json)
- [Relatório de implementação e validação](docs/relatorio-ms-projects.md)
- [Frontend React e referência visual](docs/frontend.md)
- [Relatório da entrega React e api/web](docs/relatorio-web.md)
- [Configuração, segurança e limites do ms-identity](apps/ms-identity/README.md)
- [Relatório do ms-identity](docs/relatorio-ms-identity.md)
- [Configuração e protocolo do ms-realtime](apps/ms-realtime/README.md)
- [Configuração e limites do ms-notifications](apps/ms-notifications/README.md)
- [Relatório de realtime e notificações](docs/relatorio-realtime-notifications.md)
- [Relatório da interface de notificações](docs/relatorio-notificacoes-workspace.md)
- [Provedores de notificações e limites](docs/relatorio-provedores-notificacoes.md)

MCP, Insights Vue e o consumidor de auditoria estão implementados; o frontend continua usando dados de demonstração local. Notificações suportam Resend, SMSGo e WhatsApp Cloud API, com confirmação de posse por código; credenciais e templates devem ser configurados. Aceite do provedor não comprova entrega. O WebSocket envia invalidações e exige nova leitura pela API após reconexão.
