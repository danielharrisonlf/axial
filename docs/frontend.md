# Workspace React

## Estrutura e referência

`apps/web` é uma aplicação React 19 com Vite 8 e TypeScript estrito. `apps/api` mantém o serviço NestJS ms-projects; o nome do pacote continua @axial/ms-projects. Os dois pacotes participam dos comandos raiz de build, tipos e testes.

A referência visual é o protótipo `projectflow-ai-prototipo` na versão do design system novo: `DESIGN.md` (princípios, tokens, componentes com estados, padrões e acessibilidade), `styles.css` e a marcação de `js/views-*.js`. A composição é JSX e estado React; não há iframe, injeção de HTML nem o renderizador legado.

**Stylesheet.** `src/styles/prototype.css` foi **substituído** pelo `styles.css` atual do protótipo, sem reescrita: tokens com `light-dark()` no `:root` (tema por `color-scheme`; `data-theme` força claro ou escuro, "Sistema" remove o atributo), camadas tokens → base → shell → componentes → views → utilitários → responsivo, e uma seção final "8. Ajustes do Axial" com quatro regras que usam só tokens (ver design-qa.md). O nome do arquivo foi mantido porque o Biome já o ignora e assim o CSS continua comparável linha a linha com o do protótipo. O antigo `app.css` saiu. Os ícones (`public/icons.svg`) foram regenerados a partir do mapa de ícones do protótipo, com a marca Axial.

**Componentes compartilhados** (`src/components/ui.tsx`): pilha de camadas (modal, drawer, menu e navegação móvel; Esc fecha só a camada do topo, Tab preso nos diálogos, fundo inerte, foco volta ao gatilho, z-index lido de `--z-modal`), `Overlay`/`ConfirmDialog` (`alertdialog`), `MenuButton`/`Menu` (APG), `PropButton`/`PropValue` (inspector), `PageHead` com seletor ao lado do título, `TabNav` (abas que mudam a rota, `aria-current`), `FilterSelect` (`.fsel`), `Segmented`, `Switch`, `Field`/`FieldGroup` (rótulo ligado, `aria-describedby`, `aria-invalid`), `Stat` + `Sparkline`, `TaskRow`, `ActivityFeed`, glifos de status/prioridade/tipo com nome acessível, avatares e pontos com tokens categóricos (`--cat-N`), `Toasts` e a live region dedicada.

**Shell** (`App.tsx`): skip link, `aside` em moldura (`--chrome`), alternador Workspace/Insights, breadcrumb, busca com Ctrl/⌘+K e atalho visível, tema, sino, seletor de perfil com o **único** indicador de demonstração ("Demonstração"), `main#conteudo`, foco no título e anúncio a cada troca de rota, navegação off-canvas abaixo de 860px. No modo Insights a sidebar mostra Visão executiva, Análise de projetos e Central de auditoria, com a marca violeta.

Capturas da referência estão em docs/design-reference, as da implementação em docs/screenshots (mesmo nome de arquivo por par) e as evidências do e2e em output/validation/web.

## Telas

- Início com saudação, filtros rotulados, 5 KPIs com ícone (sparkline e delta em "Concluídas no período"), minhas tarefas, próximos prazos, atividades, sprints ativas, favoritos e resumo por equipe.
- Projetos com busca, filtro de status, favoritos, criação, edição e arquivamento.
- Detalhe do projeto com visão geral, épicos, marcos, atividade, tarefas, membros e configurações.
- Minhas tarefas com filtros e tabela compartilhada.
- Kanban com cinco colunas que cabem em 1440, barra de visão (busca, menu Filtro, chips removíveis, Ordenar), colunas vazias, criação rápida que continua aberta, arrastar e soltar e Alt+setas pelo teclado.
- Backlog, planejamento e ciclo de sprints.
- Cronograma com projetos e marcos.
- Notificações com histórico multicanal, preferências por evento e canal, catálogo de templates e estado dos provedores.
- Inspector de tarefa (drawer) como painel de propriedades com menus, faixa de bloqueio, critérios de aceite, subtarefas, comentários (Ctrl+Enter) e histórico com a origem de cada registro.
- Agentes MCP com o catálogo das 8 ferramentas do `apps/mcp-server` e um console de teste que executa sobre os dados da demonstração (escritas registradas com origem "Agente MCP").
- Configurações com Aparência e Dados da demonstração (restaurar e exportar). Sem a aba de arquitetura nem o cartão da organização.
- Tema, perfil de demonstração, busca global e navegação responsiva.

A navegação segue o escopo do PDF ProjectFlow: Workspace operacional, Agentes MCP, Notificações, Insights e Usuários e permissões. O assistente de IA interno não foi implementado — agentes externos usam o servidor MCP com as permissões do usuário. Webhooks não fazem parte da arquitetura do PDF e não são exibidos.

## Insights (Vue 3)

`apps/insights` é um microfrontend Vue 3 exposto por Module Federation e montado pelo Workspace em `/#/insights`, `/#/insights/analytics` e `/#/insights/audit`. O shell do Workspace faz a navegação; o host passa `view` e os dados escopados, e o remoto devolve `unmount` com `update(props)`, para trocar de página sem remontar. O remoto usa os mesmos tokens e componentes do Workspace, copiados em `src/styles/insights.css` dentro de `@scope (.ins-root)`: funciona sozinho (porta 5174) e não vaza estilos para o host. O tema vem do `color-scheme` herdado. Ele reproduz as três áreas do PDF:

- **Dashboard executivo**: filtros por organização, projeto, equipe e período; indicadores de projetos ativos, concluídos e em risco, tarefas concluídas e atrasadas, cumprimento de prazos, evolução semanal das entregas, distribuição por status, situação dos projetos, prazos por equipe, resumo por equipe e atividades recentes.
- **Análises de desempenho**: comparação de projetos com progresso, atrasos, bloqueios e prazo; indicadores por sprint; progresso por equipe; gargalos e carga; dependências críticas.
- **Central de auditoria**: filtros por usuário, projeto, ação, origem, entidade e período, paginação e detalhe do registro com diff de valores anteriores → novos. Visível apenas para ADMIN, PROJECT_MANAGER e TEAM_LEAD, alinhado ao ms-audit.

O remote recebe os projetos, tarefas, pessoas, equipes, sprints e a trilha de auditoria já escopados pelo Workspace; não faz chamadas HTTP próprias nesta etapa.

## Usuários e permissões

A página `/#/access` lista colaboradores com cargo, organização, equipes, papel e situação, permite trocar o papel (somente ADMIN) e convidar colaboradores, além de exibir a matriz de capacidades por papel. As ações reais são validadas no estado local e registradas na auditoria.

## Dados e persistência

O cenário inicial usa os mesmos 11 projetos e 109 tarefas fictícias do protótipo. Datas são relativas ao momento da restauração: dias do calendário são deslocados em dias inteiros e instantes mantêm a distância até agora. Datas `AAAA-MM-DD` são dias locais (nunca UTC); um prazo de ontem conta como atraso.

O seed está na **versão 9**, equivalente ao seed 8 do protótipo: histórico de notificações enxuto (8 envios, um por evento, três canais, duas falhas com motivo e reenvio), `doneAt` real nas tarefas (Insights e KPIs não inferem conclusão de `updatedAt`), favoritos por pessoa e assuntos dos templates de sprint sem repetição. Um estado salvo na versão 8 é migrado sem perder as alterações da pessoa (os envios gerados no navegador são mantidos); a chave continua `axial.workspace.demo.v1`. O estado é atualizado imutavelmente e compartilha a mesma fonte entre lista, detalhes, Kanban e contadores. O navegador persiste somente sob a chave axial.workspace.demo.v1; a chave do protótipo original permanece intacta.

Dados locais inválidos são recuperados com aviso. Se o navegador impedir gravação, a aplicação informa que as alterações duram apenas a sessão. Restaurar demonstração repõe o cenário inicial.

A tela de Notificações reutiliza os 6 templates, as preferências evento × canal e os 3 provedores do protótipo. Atribuir uma tarefa, bloquear uma tarefa, iniciar ou encerrar uma sprint gera entregas locais; canal sem provedor configurado é registrado como falha e o reenvio só muda para entregue quando o provedor está configurado. Esses dados são fictícios e não representam chamadas ao ms-notifications. Dentro da interface, o único aviso de demonstração é o rótulo no seletor de perfil.

Esta entrega é a interface fiel e interativa da demonstração; **não conecta suas mutações à API**. Não emite tokens de identidade nem inclui chaves privadas no bundle. O comportamento de perfis fictícios reproduz o protótipo e não substitui a autorização de produção do ms-projects.

## Fronteira para integração real

O backend exige UUIDs e campos versionados. O protótipo usa IDs como prj-pcl/u1 e modelos de apresentação com nome, cor, avatar e favorito. Mapeamentos necessários incluem desc -> description, targetDate -> endDate, archived -> archivedAt, epic.name -> title e blockedBy -> blockedByIds. Critérios com checkbox e nomes de usuários/equipes também exigem contratos próprios.

A próxima integração deve usar uma sessão autenticada de identidade, manter favoritos como preferências de usuário, carregar dados reais e tratar conflitos/erros de HTTP. Uma falha de API não pode trocar o usuário para demonstração silenciosamente. O proxy /api do Vite aponta para localhost:3001 para essa etapa futura.

## Executar e validar

```powershell
pnpm install --frozen-lockfile
pnpm dev:web
```

Workspace em http://localhost:5173. Para build: `pnpm --filter @axial/web build`. Para unidade: `pnpm --filter @axial/web test:unit`. Para navegador: `pnpm --filter @axial/web exec playwright install chromium` e `pnpm test:web:e2e`. Se outra cópia do repositório já estiver servindo 5173/5174, use outras portas para não testar a cópia errada: `WEB_E2E_PORT=5373 INSIGHTS_E2E_PORT=5374 pnpm test:web:e2e`.

A aceitação compara referência e implementação com o mesmo viewport/perfil/tema e testa o fluxo operacional, o teclado (skip link, Ctrl+K, Esc em camadas, Alt+setas no Kanban), a ausência de rolagem horizontal a 390 px e o contraste AA medido com `getComputedStyle` nos dois temas. Resultado visual, desvios deliberados e verificações executadas ficam em design-qa.md na raiz.
