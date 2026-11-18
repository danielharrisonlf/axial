# Workspace React

## Estrutura e referência

`apps/web` é uma aplicação React 19 com Vite 8 e TypeScript estrito. `apps/api` mantém o serviço NestJS ms-projects; o nome do pacote continua @axial/ms-projects. Os dois pacotes participam dos comandos raiz de build, tipos e testes.

A referência visual é o protótipo `projectflow-ai-prototipo` na versão do design system novo: `DESIGN.md` (princípios, tokens, componentes com estados, padrões e acessibilidade), `styles.css` e a marcação de `js/views-*.js`. A composição é JSX e estado React; não há iframe, injeção de HTML nem o renderizador legado.

**Stylesheet.** `src/styles/prototype.css` foi **substituído** pelo `styles.css` atual do protótipo, sem reescrita: tokens com `light-dark()` no `:root` (tema por `color-scheme`; `data-theme` força claro ou escuro, "Sistema" remove o atributo), camadas tokens → base → shell → componentes → views → utilitários → responsivo, e uma seção final "8. Ajustes do Axial" com quatro regras que usam só tokens (ver design-qa.md). O nome do arquivo foi mantido porque o Biome já o ignora e assim o CSS continua comparável linha a linha com o do protótipo. O antigo `app.css` saiu. Os ícones (`public/icons.svg`) foram regenerados a partir do mapa de ícones do protótipo, com a marca Axial.

**Componentes compartilhados** (`src/components/ui.tsx`): pilha de camadas (modal, drawer, menu e navegação móvel; Esc fecha só a camada do topo, Tab preso nos diálogos, fundo inerte, foco volta ao gatilho, z-index lido de `--z-modal`), `Overlay`/`ConfirmDialog` (`alertdialog`), `MenuButton`/`Menu` (APG), `PropButton`/`PropValue` (inspector), `PageHead` com seletor ao lado do título, `TabNav` (abas que mudam a rota, `aria-current`), `FilterSelect` (`.fsel`), `Segmented`, `Switch`, `Field`/`FieldGroup` (rótulo ligado, `aria-describedby`, `aria-invalid`), `Stat` + `Sparkline`, `TaskRow`, `ActivityFeed`, glifos de status/prioridade/tipo com nome acessível, avatares e pontos com tokens categóricos (`--cat-N`), `Toasts` e a live region dedicada.

**Shell** (`App.tsx`): skip link, `aside` em moldura (`--chrome`), alternador Workspace/Insights, breadcrumb, busca com Ctrl/⌘+K e atalho visível, tema, sino, perfil do usuário atual (na demonstração só exibição; no modo API um menu com a troca de empresa e “Sair”), `main#conteudo`, foco no título e anúncio a cada troca de rota, navegação off-canvas abaixo de 860px. No modo Insights a sidebar mostra Visão executiva, Análise de projetos e Central de auditoria, com a marca violeta.

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
- Agentes MCP com o catálogo das 8 ferramentas do `apps/mcp-server` e um console de teste que executa sobre os dados do Workspace (escritas registradas com origem "Agente MCP").
- Configurações só com Aparência. Sem opções de demonstração (restaurar, exportar ou trocar perfil), sem a aba de arquitetura nem o cartão da organização.
- Tema, busca global e navegação responsiva.

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

Dados locais inválidos são recuperados com aviso. Se o navegador impedir gravação, a aplicação informa que as alterações duram apenas a sessão.

A tela de Notificações reutiliza os 6 templates, as preferências evento × canal e os 3 provedores do protótipo. Atribuir uma tarefa, bloquear uma tarefa, iniciar ou encerrar uma sprint gera entregas locais; canal sem provedor configurado é registrado como falha e o reenvio só muda para entregue quando o provedor está configurado. Esses dados são fictícios e não representam chamadas ao ms-notifications. Dentro da interface, o único aviso de demonstração é o rótulo no seletor de perfil.

O modo demonstração não conecta suas mutações à API, não emite tokens nem inclui chaves privadas no bundle. Ele existe só para `pnpm dev:web` e para a suíte Playwright legada.

## Fonte de dados: API (produção) ou demonstração

A fonte é fixada no build por `VITE_WORKSPACE_SOURCE` (vite.config.ts): `api` em todo `vite build` (produção, Docker, `pnpm build`), `demo` no servidor de desenvolvimento. A variável sobrepõe os dois (`VITE_WORKSPACE_SOURCE=api pnpm dev:web` contra uma stack local). `main.tsx` compara a constante já substituída: no build `api` o ramo da demonstração é eliminado e `demo-store.ts`, `seed.ts` e `demo-seed.json` não são emitidos (conferido no `dist`). Os componentes de página são os mesmos nos dois modos; ambos implementam a interface `WorkspaceStore` de `src/data/workspace.ts` e o formato `WorkspaceData`.

**No modo API nenhum dado de projeto, tarefa, sprint, pessoa ou equipe vem do localStorage.** Tudo é lido dos serviços a cada carga; o navegador guarda apenas preferências: `kairos.theme`, `kairos.organization` (id da empresa escolhida, não é segredo), `kairos.favorites.<empresa>.<pessoa>` e `kairos.project.<empresa>.<pessoa>` (projeto selecionado no Kanban). Assim, o que um membro cria (no Workspace, por MCP ou pela API) aparece para os outros membros do projeto ao recarregar e, com o realtime ligado, sem recarregar.

Camadas em `src/data/api/`:

- `http.ts`: cliente do gateway (`VITE_API_BASE_URL` + `/api/v1`; vazio = mesma origem pelo proxy do Vite). Token só em memória; 401 → uma renovação (single flight) → uma nova tentativa; segundo 401 encerra a sessão. Falha de rede vira `ApiError` com status 0.
- `auth.ts`: login, escolha de empresa (`requiresOrganization`), cadastro, convite, troca forçada de senha, troca de empresa e saída. O access token (300 s) é renovado 60 s antes do fim por `POST auth/session` com o cookie HttpOnly `kairos_session` (`credentials: "include"`) e `X-Organization-Id`. Um `BroadcastChannel("kairos-auth")` replica saída e troca de empresa entre abas.
- `mappers.ts`: validação (zod) e conversão dos formatos dos serviços para o modelo do protótipo (description → desc, endDate → targetDate, archivedAt → archived, title → name do épico, dependencies → blockedBy, completedAt → doneAt/status do marco, acceptanceCriteria → acceptance, papéis ADMIN/… → admin/…). Datas sem hora da interface viajam como instantes: início do dia local para inícios; fim do dia local para prazos, fins de sprint e de projeto e marcos. Eventos do ms-audit são traduzidos para o vocabulário da auditoria do protótipo.
- `loader.ts`: carga da empresa (`me`, `organization/members`, `organization/teams`, projetos ativos e arquivados, e as listas da organização de tarefas, épicos, sprints e marcos, todas lidas até a última página de 100; nunca truncadas em silêncio) e as 300 entradas mais recentes da auditoria para ADMIN, PROJECT_MANAGER e TEAM_LEAD. Comentários e histórico de uma tarefa são lidos ao abrir o inspector.
- `commands.ts`: escritas com os schemas de `@axial/contracts` e a `version` do recurso.
- `store.ts`: a store do modo API. Escritas otimistas, em fila por recurso (cada uma usa a versão devolvida pela anterior) e com reversão: 409 de versão → “Alguém alterou este item; os dados foram recarregados” e releitura do projeto; 403 → “Sem permissão”; 404 → releitura do projeto. Botões seguem `packages/contracts/src/policy.ts` (`can(cap, projectId)`, `canTouchTask`); o serviço continua sendo a autoridade.
- `realtime.ts`: WebSocket `/ws` (ms-realtime): `authenticate`, depois um `subscribe` por projeto aberto, um de cada vez; cada invalidação relê o projeto afetado. O servidor fecha o socket quando o token expira; o cliente reconecta com o token renovado e, após reconectar, relê a empresa.

Estados: carga inicial com aviso de carregamento; falha na carga inicial → tela “Serviço indisponível” com “Tentar novamente” (nunca dados de demonstração). Falha de leitura depois de carregado → faixa “Serviço indisponível” acima da página, dados marcados como desatualizados e escritas desativadas até a releitura. 401 → renovação → login. 403 → aviso. Projeto inexistente ou sem acesso → a tela de acesso indisponível que já existia.

Telas de entrada (`src/auth/AuthScreens.tsx`, estilos em `src/styles/auth.css` só com tokens e componentes do protótipo): Entrar, Escolha a empresa, Criar conta (nome, e-mail, senha, empresa), Convite (`#/convite/<token>`: empresa e papel; nome e senha para conta nova, a própria senha para conta existente) e Defina sua senha (senha provisória). No cabeçalho, o perfil vira menu com as empresas da conta (troca) e “Sair”.

O que o modo API mostra e o que fica de fora:

| Área | Modo API |
| --- | --- |
| Projetos, épicos, tarefas, sprints, marcos, comentários, Kanban, backlog, cronograma, Insights | dados dos serviços; criação/edição/arquivamento de projeto, épicos, tarefas (campos, status por arraste ou Alt+setas, atribuição, critérios, dependências, subtarefas, exclusão), comentários, início/encerramento de sprint |
| Marcos | lidos da API; a interface do protótipo não tem tela de criação de marco, então nada foi acrescentado (as ações existem na store) |
| Usuários e permissões | `organization/members`; ADMIN troca papel, desativa/reativa, convida por link (o link aparece uma vez, com botão Copiar) e revoga convites pendentes (aba Convites) |
| Equipes | somente leitura de `organization/teams` |
| Favoritos | preferência local por pessoa e empresa |
| Notificações | só os canais da própria pessoa (`GET notification-preferences`), somente leitura; histórico, templates e provedores não têm rota no gateway e não aparecem (sem dados fictícios); o sino do cabeçalho sai |
| Agentes MCP | catálogo igual; o console chama `POST /mcp` real (JSON-RPC `tools/call`) com o access token da pessoa: o token do Workspace tem audiência `axial-projects` e nenhum `scope`, que o `apps/mcp-server` aceita como token próprio com todos os escopos (`scopes.ts`); o ms-projects autoriza cada chamada com o papel da pessoa |

## Executar e validar

```powershell
pnpm install --frozen-lockfile
pnpm dev:web
```

Workspace (demonstração) em http://localhost:5173. Contra os serviços locais: `VITE_WORKSPACE_SOURCE=api pnpm dev:web` (o proxy leva `/api`, `/mcp` e `/ws` ao gateway em `VITE_API_PROXY_TARGET`, padrão http://localhost:3000; a origem precisa estar em `IDENTITY_TRUSTED_ORIGINS`).

Teste de stack (modo API, `tests/stack/`): `node tests/stack/stack.mjs up` (dentro de `apps/web`; recria o banco descartável `axial_webstack_test` no postgres de teste, aplica migrations, semeia o cenário Vetor Labs com os seeds `:test`, gera o build API e sobe os sete serviços nas portas 3100–3106 e o Workspace em http://localhost:4273), depois `pnpm --filter @axial/web test:stack` e `node tests/stack/stack.mjs down`. Exige o monorepo compilado (`pnpm db:generate && pnpm build`) e o `docker compose` local.

Para build: `pnpm --filter @axial/web build`. Para unidade: `pnpm --filter @axial/web test:unit`. Para navegador: `pnpm --filter @axial/web exec playwright install chromium` e `pnpm test:web:e2e`. Se outra cópia do repositório já estiver servindo 5173/5174, use outras portas para não testar a cópia errada: `WEB_E2E_PORT=5373 INSIGHTS_E2E_PORT=5374 pnpm test:web:e2e`.

A aceitação compara referência e implementação com o mesmo viewport/perfil/tema e testa o fluxo operacional, o teclado (skip link, Ctrl+K, Esc em camadas, Alt+setas no Kanban), a ausência de rolagem horizontal a 390 px e o contraste AA medido com `getComputedStyle` nos dois temas. Resultado visual, desvios deliberados e verificações executadas ficam em design-qa.md na raiz.
