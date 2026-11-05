# Axial

Plataforma interna de gestão de projetos. Este monorepo começa pelo **ms-projects**, uma API NestJS com PostgreSQL, contratos Zod e outbox transacional para Redis/BullMQ.

O fluxo definitivo é o da apresentação ProjectFlow fornecida em 05/11/2026: planejar, organizar acessos, executar, sincronizar, notificar e acompanhar. O nome do produto passa a ser **Axial**. Nesta entrega, apenas o serviço de projetos está implementado.

## Estrutura

```text
apps/
  ms-projects/
    prisma/                 # schema projects, migration e seed local
    src/
      common/               # autenticação, configuração e validação
      infra/                # Prisma, saúde e relay BullMQ
      modules/              # controller, regras e transações de projetos
    test/                   # testes unitários, integração e HTTP
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
- Swagger: `http://localhost:3001/docs`
- OpenAPI: `http://localhost:3001/docs/openapi.json`
- Liveness: `http://localhost:3001/api/v1/health/live`
- Readiness: `http://localhost:3001/api/v1/health/ready`

O seed cria dados fictícios em uma organização de demonstração e preserva registros existentes quando repetido. Só executa em banco terminado em `_dev` e rejeita `NODE_ENV=production`.

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
```

Os testes de integração/HTTP recusam bancos cujo nome não termine em `_test`. Executam contra PostgreSQL e Redis reais, sem depender dos serviços futuros. O workflow CI repete os checks com serviços isolados.

## Documentação

- [Arquitetura e decisões](docs/architecture.md)
- [Requisitos e correspondência com o PDF](docs/requirements.md)
- [Identidade, API e eventos](docs/api-contracts.md)
- [Operação e variáveis de ambiente](docs/operations.md)
- [OpenAPI versionado](docs/api/openapi.json)
- [Relatório de implementação e validação](docs/relatorio-ms-projects.md)

Identidade, gateway, MCP, frontends React/Vue e consumidores de auditoria, notificações e tempo real são as próximas integrações. Publicar jobs nessas filas não significa que mensagens, auditoria ou WebSocket já tenham sido entregues.
