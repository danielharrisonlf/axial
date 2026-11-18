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
  observability/            # métricas HTTP/runtime (/api/v1/metrics, Prometheus)
  demo-fixtures/            # cenário fictício Vetor Labs com ids determinísticos para os seeds
docs/                       # arquitetura, contratos e relatório
scripts/                    # emissor de identidade exclusivamente local
```

Convenções baseadas nos repositórios recentes `suporte-app`, `finflow` e `omni-crm-ai`: pnpm workspaces, Turborepo, ESM, TypeScript estrito, Prisma, Biome e Vitest.

## Executar localmente

Requisitos: Node.js 22.12 ou superior, pnpm 10.11.1 e Docker com contêineres Linux.

### Tudo com um comando (build local, como na apresentação)

```powershell
pnpm install --frozen-lockfile
pnpm start
```

`pnpm start` cria o `.env` e as chaves locais se faltarem, sobe PostgreSQL e Redis no Docker, aplica as migrations dos quatro schemas e o seed de demonstração, compila o monorepo e inicia os nove serviços a partir do build, sem hot reload. Ele espera todos ficarem saudáveis, mostra os endereços e fica no ar até `Ctrl+C`, que encerra tudo. Em outro terminal, `pnpm stop` faz o mesmo.

- Workspace: `http://localhost:4173` · Insights: `http://localhost:5174` · Gateway: `http://localhost:3000` · Swagger: `http://localhost:3001/docs` · MCP: `http://localhost:3006/mcp`.
- `AXIAL_SKIP_INFRA=1` reaproveita Docker e banco já prontos; `AXIAL_SKIP_BUILD=1` reaproveita o build anterior (partida em segundos).
- O comando para antes de começar se o Docker estiver fechado ou se as portas 3000–3006, 4173 e 5174 estiverem ocupadas por outro processo (por exemplo, um `pnpm dev` aberto), e diz qual é.
- Os serviços rodam com `NODE_ENV=development` de propósito: o Swagger e o seed de demonstração ficam disponíveis. Em `production`, o Swagger é desligado e o seed é recusado. Logs em `output/validation/performance/logs`.

### Passo a passo (desenvolvimento)

```powershell
Copy-Item .env.example .env
pnpm install --frozen-lockfile
pnpm infra:up
pnpm dev:keys
pnpm db:generate
pnpm db:migrate
pnpm db:audit:migrate
pnpm --filter "@axial/demo-fixtures..." build
pnpm db:seed:demo
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

O seed grava nos schemas de projects e audit o mesmo cenário fictício do Workspace (Vetor Labs e Atlas: 11 projetos, 109 tarefas, sprints, marcos, comentários e histórico de auditoria), com ids determinísticos de `packages/demo-fixtures`. Só insere o que falta e preserva registros existentes quando repetido. Só executa em banco terminado em `_dev` e rejeita `NODE_ENV=production`. Detalhes, ordem (identity → projects → audit) e mapeamentos em [docs/demo-seed.md](docs/demo-seed.md).

Para abrir somente a interface, sem dependência de Docker ou da API: `pnpm dev:web`. Para iniciar somente o backend: `pnpm dev:api`. O comando `pnpm dev` inicia Workspace e Insights. Serviços adicionais têm atalhos próprios: `pnpm dev:gateway`, `pnpm dev:mcp`, `pnpm dev:audit` e `pnpm dev:insights`.

Em um clone novo, `pnpm dev` e os atalhos `dev:*` compilam os pacotes internos (`packages/contracts` e `packages/observability`) antes de iniciar: eles são consumidos por `dist/index.js`, que ainda não existe logo após o `pnpm install`. Se você rodar o script `dev` de um app diretamente, sem passar pelo Turbo, e aparecer `ERR_MODULE_NOT_FOUND ... @axial/contracts/dist/index.js`, execute `pnpm --filter "./packages/*" build` uma vez. Durante o `pnpm dev`, o aviso `[Module Federation DTS] Failed to download types archive` pode aparecer enquanto o remote de Insights inicia; é apenas a geração de tipos do Module Federation e não impede a aplicação.

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

O token dura 15 minutos. Para criar tokens locais de outros papéis: `node scripts/dev-identity.mjs token VIEWER` (ou `PROJECT_MANAGER`, `TEAM_LEAD`, `CONTRIBUTOR`). Cada papel assina como uma pessoa semeada da Vetor Labs (ADMIN Helena Costa, PROJECT_MANAGER Ricardo Nogueira, TEAM_LEAD Ana Souza, CONTRIBUTOR Camila Freitas, VIEWER Sérgio Tavares), com equipes e projetos atribuídos do cenário; o comando lê o build de `packages/demo-fixtures`.

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

## Desempenho

A camada de análise de desempenho cobre Lighthouse, DevTools/Web Vitals, carga das APIs com autocannon e consolidação de evidências. Dependências fixadas na raiz: `autocannon@9.0.0` e `lighthouse@13.6.0`.

### Demonstração ao vivo

```powershell
pnpm perf:demo
```

Abre o **painel de desempenho** em `http://127.0.0.1:4900` (sobe a stack com `perf:stack` se ela não estiver no ar; requer `pnpm build` e banco migrado/populado). O painel é local, não depende de serviço externo e tem cinco abas:

- **Teste de carga**: escolhe o endpoint, os usuários simultâneos e a duração; o autocannon roda no servidor do painel e os gráficos de pedidos por segundo e de tempo de resposta (p50/p99) se atualizam a cada segundo. Abaixo, uma tabela mostra o que o gateway e o ms-projects registram nas próprias métricas (pedidos/s, p95, CPU, event loop e memória);
- **Gateway: antes × depois**: sobe um segundo gateway na porta 3100 com `GATEWAY_UPSTREAM_KEEPALIVE=false` e roda a mesma carga nas duas versões, reproduzindo ao vivo o gargalo corrigido (uma conexão TCP por pedido);
- **Resultados registrados**: a comparação de `docs/performance/resultados.json`;
- **Front-end**: notas do Lighthouse e tamanho da página, com botão para rodar o Lighthouse na hora;
- **Métricas dos serviços**: rotas mais acessadas, saída Prometheus e estado do NestJS Observe.

`PERF_DEMO_PORT` troca a porta, e `PERF_DEMO_NO_OPEN=1` não abre o navegador. `Ctrl+C` fecha o painel; a stack continua no ar até `pnpm perf:stop`.

### Observabilidade

- **Métricas nativas** (`packages/observability`): gateway e ms-projects expõem `GET /api/v1/metrics` (JSON com p50/p95/p99, vazão, taxa de erro, rotas, CPU, heap e event loop) e `GET /api/v1/metrics/prometheus`. Com `NODE_ENV=production`, os endpoints só respondem se `METRICS_TOKEN` estiver definido, e exigem `Authorization: Bearer <token>`.
- **Logs estruturados**: um log JSON por requisição no ms-projects, com `durationMs` e `x-correlation-id`.
- **NestJS Observe** (`@nestjs/observe`, SDK oficial do NestJS 12): integrado ao ms-projects e **desligado por padrão**. Liga quando `OBSERVE_APP_KEY` e `OBSERVE_APP_SECRET` estão no `.env` (conta gratuita em observe.nestjs.com, até 300 mil eventos por mês). Os traces vão para o painel hospedado deles; não há painel local.

### Um comando

```powershell
pnpm perf
```

O comando executa, em sequência:

1. `docker compose up -d --wait` (PostgreSQL e Redis);
2. `db:generate`, migrations de projects/identity/notifications/audit e seed de demonstração (projects e audit);
3. build do monorepo;
4. start de API, identidade, notificações, realtime, audit, MCP, gateway, Workspace e Insights;
5. geração de token ADMIN e cenários de carga (health, projetos, tarefas, auditoria, notificações);
6. Web Vitals via Playwright/Chromium;
7. Lighthouse desktop e mobile;
8. consolidação em `docs/performance/resultados.json` e cópia das evidências;
9. encerramento da stack.

Variáveis úteis:

- `PERF_KEEP_STACK=1` mantém os serviços no ar ao final;
- `PERF_SKIP_INFRA=1` reaproveita Docker/migrations já prontos;
- `PERF_LOGIN_EMAIL`, `PERF_LOGIN_PASSWORD` e `PERF_LOGIN_ORG` habilitam a medição do login (sem elas o cenário é omitido);
- `CHROME_PATH` aponta um Chromium específico; por padrão o script localiza o do Playwright em `%LOCALAPPDATA%\ms-playwright`.

### Comandos parciais

| Comando | O que faz |
|---|---|
| `pnpm perf:stack` | Inicia os nove processos e espera a saúde de todos |
| `pnpm perf:load` | Gera o token e roda os cenários de autocannon |
| `pnpm perf:web` | Coleta LCP, CLS, long tasks e métricas CDP |
| `pnpm perf:lighthouse` | Roda Lighthouse desktop/mobile e copia as evidências |
| `pnpm perf:report` | Consolida `docs/performance/resultados.json` |
| `pnpm perf:stop` | Encerra os processos iniciados (e libera as portas) |
| `pnpm perf:demo` | Painel local de desempenho ao vivo (porta 4900) |

### Saídas

- `docs/performance/relatorio-desempenho.md` — método, resultados antes/depois, gargalos e próximos passos;
- `docs/performance/resultados.json` — números consolidados (carga, Lighthouse, Web Vitals, payloads, login);
- `docs/performance/evidencias/` — relatórios Lighthouse HTML/JSON, gráficos, Web Vitals e JSONs brutos do autocannon;
- `output/validation/performance/` — logs, relatórios e artefatos da última execução.

### Pré-requisitos

- Node.js 22.12+ e pnpm 10.11.1;
- Docker com contêineres Linux para PostgreSQL/Redis;
- portas 3000–3006, 4173 e 5174 livres;
- Chromium do Playwright (`pnpm --filter @axial/web exec playwright install chromium`) ou `CHROME_PATH`.

Resultados e comparação completa em [relatório de desempenho](docs/performance/relatorio-desempenho.md).

## Documentação

- [Arquitetura e decisões](docs/architecture.md)
- [Requisitos e correspondência com o PDF](docs/requirements.md)
- [Identidade, API e eventos](docs/api-contracts.md)
- [Operação e variáveis de ambiente](docs/operations.md)
- [OpenAPI versionado](docs/api/openapi.json)
- [Relatório de implementação e validação](docs/relatorio-ms-projects.md)
- [Frontend React e referência visual](docs/frontend.md)
- [Análise de desempenho e evidências](docs/performance/relatorio-desempenho.md)
- [Relatório da entrega React e api/web](docs/relatorio-web.md)
- [Configuração, segurança e limites do ms-identity](apps/ms-identity/README.md)
- [Relatório do ms-identity](docs/relatorio-ms-identity.md)
- [Configuração e protocolo do ms-realtime](apps/ms-realtime/README.md)
- [Configuração e limites do ms-notifications](apps/ms-notifications/README.md)
- [Relatório de realtime e notificações](docs/relatorio-realtime-notifications.md)
- [Relatório da interface de notificações](docs/relatorio-notificacoes-workspace.md)
- [Provedores de notificações e limites](docs/relatorio-provedores-notificacoes.md)

MCP, Insights Vue e o consumidor de auditoria estão implementados; o frontend continua usando dados de demonstração local. Notificações suportam Resend, SMSGo e WhatsApp Cloud API, com confirmação de posse por código; credenciais e templates devem ser configurados. Aceite do provedor não comprova entrega. O WebSocket envia invalidações e exige nova leitura pela API após reconexão.
