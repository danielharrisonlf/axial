# Workspace React

## Estrutura e referência

`apps/web` é uma aplicação React 19 com Vite 8 e TypeScript estrito. `apps/api` mantém o serviço NestJS ms-projects; o nome do pacote continua @axial/ms-projects. Os dois pacotes participam dos comandos raiz de build, tipos e testes.

A referência visual é o protótipo fornecido em `projectflow-ai-prototipo`: styles.css, views-core.js e views-work.js. O stylesheet original é preservado em src/styles/prototype.css; os paths SVG autorais foram extraídos para public/icons.svg. A composição foi reescrita em JSX e estado React. Não há iframe, injeção de páginas HTML nem execução do renderizador PF legado.

Tipografia, tokens de claro/escuro, sidebar de 240px, topbar de 50px, tabelas, filtros, chips, cartões, modais e drawer seguem a referência. A marca foi alterada para Axial. Capturas da referência estão em docs/design-reference e evidências da implementação são produzidas em output/validation/web.

## Telas

- Início com filtros, indicadores, tarefas, próximas entregas, sprints e favoritos.
- Projetos com busca, filtro de status, favoritos, criação, edição e arquivamento.
- Detalhe do projeto com visão geral, épicos, marcos, atividade, tarefas, membros e configurações.
- Minhas tarefas com filtros e tabela compartilhada.
- Kanban com cinco colunas, filtros combinados, criação rápida e movimentação por arrastar ou seletor.
- Backlog, planejamento e ciclo de sprints.
- Cronograma com projetos e marcos.
- Notificações com histórico multicanal, preferências por evento e canal, catálogo de templates e estado dos provedores.
- Drawer de tarefa com propriedades, critérios de aceite, dependências, subtarefas, comentários e histórico local.
- Tema, perfil de demonstração, busca global e navegação responsiva.

A navegação segue o escopo do PDF ProjectFlow: Workspace operacional, Notificações, Insights e Usuários e permissões. O assistente de IA interno não foi implementado — agentes externos usam o servidor MCP com as permissões do usuário. Webhooks não fazem parte da arquitetura do PDF e não são exibidos.

## Insights (Vue 3)

`apps/insights` é um microfrontend Vue 3 exposto por Module Federation e montado pelo Workspace em `/#/insights`. Ele reproduz as três áreas do PDF:

- **Dashboard executivo**: filtros por organização, projeto, equipe e período; indicadores de projetos ativos, concluídos e em risco, tarefas concluídas e atrasadas, cumprimento de prazos, evolução semanal das entregas, distribuição por status, situação dos projetos, prazos por equipe, resumo por equipe e atividades recentes.
- **Análises de desempenho**: comparação de projetos com progresso, atrasos, bloqueios e prazo; indicadores por sprint; progresso por equipe; gargalos e carga; dependências críticas.
- **Central de auditoria**: filtros por usuário, projeto, ação, origem, entidade e período, paginação e detalhe do registro com diff de valores anteriores → novos. Visível apenas para ADMIN, PROJECT_MANAGER e TEAM_LEAD, alinhado ao ms-audit.

O remote recebe os projetos, tarefas, pessoas, equipes, sprints e a trilha de auditoria já escopados pelo Workspace; não faz chamadas HTTP próprias nesta etapa.

## Usuários e permissões

A página `/#/access` lista colaboradores com cargo, organização, equipes, papel e situação, permite trocar o papel (somente ADMIN) e convidar colaboradores, além de exibir a matriz de capacidades por papel. As ações reais são validadas no estado local e registradas na auditoria.

## Dados e persistência

O cenário inicial usa os mesmos 11 projetos e 109 tarefas fictícias do protótipo. Datas são relativas ao dia de restauração. O estado é atualizado imutavelmente e compartilha a mesma fonte entre lista, detalhes, Kanban e contadores. O navegador persiste somente sob a chave axial.workspace.demo.v1; a chave do protótipo original permanece intacta.

Dados locais inválidos são recuperados com aviso. Se o navegador impedir gravação, a aplicação informa que as alterações duram apenas a sessão. Restaurar demonstração repõe o cenário inicial.

A tela de Notificações reutiliza os 6 templates, as preferências evento × canal e os 3 provedores do protótipo. Atribuir uma tarefa, bloquear uma tarefa, iniciar ou encerrar uma sprint gera entregas simuladas; canal sem provedor configurado é registrado como falha e o reenvio só muda para entregue quando o provedor está configurado. Esses dados são fictícios e não representam chamadas ao ms-notifications.

Esta entrega é a interface fiel e interativa da demonstração; **não conecta suas mutações à API**. Não emite tokens de identidade nem inclui chaves privadas no bundle. O comportamento de perfis fictícios reproduz o protótipo e não substitui a autorização de produção do ms-projects.

## Fronteira para integração real

O backend exige UUIDs e campos versionados. O protótipo usa IDs como prj-pcl/u1 e modelos de apresentação com nome, cor, avatar e favorito. Mapeamentos necessários incluem desc -> description, targetDate -> endDate, archived -> archivedAt, epic.name -> title e blockedBy -> blockedByIds. Critérios com checkbox e nomes de usuários/equipes também exigem contratos próprios.

A próxima integração deve usar uma sessão autenticada de identidade, manter favoritos como preferências de usuário, carregar dados reais e tratar conflitos/erros de HTTP. Uma falha de API não pode trocar o usuário para demonstração silenciosamente. O proxy /api do Vite aponta para localhost:3001 para essa etapa futura.

## Executar e validar

```powershell
pnpm install --frozen-lockfile
pnpm dev:web
```

Workspace em http://localhost:5173. Para build: `pnpm --filter @axial/web build`. Para unidade: `pnpm --filter @axial/web test:unit`. Para navegador: `pnpm --filter @axial/web exec playwright install chromium` e `pnpm test:web:e2e`.

A aceitação compara referência e implementação com o mesmo viewport/perfil/tema e testa o fluxo operacional. Resultado visual, desvios deliberados e verificações executadas ficam em design-qa.md na raiz.
