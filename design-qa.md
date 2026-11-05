# Validação visual - Axial Workspace

final result: passed

Data: 05/11/2026. Referência: protótipo ProjectFlow fornecido pelo usuário. Implementação: componentes React/Vite em apps/web. Resultado baseado em capturas reais e testes no Chromium; não inferido apenas do build.

## Comparação

Referência e implementação foram inspecionadas com viewport 1440x1000, tema claro, perfil Helena Costa e os mesmos dados fictícios. Também foram inspecionados tema escuro, modal/drawer e viewport móvel 390x844.

| Estado | Referência | Implementação verificada |
| --- | --- | --- |
| Lista de projetos | [Fonte](docs/design-reference/projects.png) | [React](docs/screenshots/projects.png) |
| Detalhe do projeto | [Fonte](docs/design-reference/project-detail.png) | [React](docs/screenshots/project-detail.png) |
| Dashboard | [Fonte](docs/design-reference/dashboard.png) | [React](docs/screenshots/dashboard.png) |
| Kanban | [Fonte](docs/design-reference/board.png) | [React](docs/screenshots/board.png) |
| Modal escuro | Tokens e composição do protótipo | [React](docs/screenshots/dark-modal.png) |
| Modal móvel | Breakpoints e controles do protótipo | [React](docs/screenshots/mobile-task-modal.png) |

Confirmados: IBM Plex, sidebar 240px, topbar 50px, página e filtros, colunas da tabela, densidade de linhas, chips, avatares, barras de progresso, ícones autorais, cartões Kanban, abas e painéis. O CSS original foi preservado após normalização de fins de linha. Filtros e cabeçalho do Kanban foram alinhados à ordem exata da referência.

## Diferenças deliberadas

- Marca ProjectFlow AI/P substituída por Axial/A, conforme nome escolhido pelo usuário.
- Links de microsserviços ainda não implementados preservam a composição visual e são inativos, com semântica acessível.
- O Workspace usa somente demonstração local nesta etapa. Isso é identificado no seletor de perfis e documentado; não alega integração ativa com a API.
- Foram corrigidas inconsistências de acesso, referências, histórico e teclado; não foram reproduzidos bugs do protótipo.
- Datas relativas e textos de tempo decorrido avançam com o relógio, podendo variar entre capturas.

## Aceitação funcional

Oito cenários reais no Chromium, sem retries, skips ou erros de página:

1. Rotas, 11 projetos iniciais, filtros e composição das telas principais.
2. Projeto -> épico -> tarefa -> drawer -> comentário realmente persistido -> critério -> subtarefa -> drag-and-drop -> recarga.
3. Planejamento, início e encerramento de sprint com retorno das pendências ao backlog.
4. Busca global, tema escuro real, perfis, navegação por teclado, foco e fechamento de overlays.
5. Menu móvel, rolagem interna e controles do modal acessíveis sem overflow horizontal da página.
6. Perfil de desenvolvedor limitado aos projetos de suas equipes.
7. Recuperação de armazenamento local inválido com aviso e preservação da chave original do protótipo.
8. Projetos arquivados respeitam o escopo da organização em lista, URL direta e breadcrumb.

O teste de Escape confirma duas etapas: primeiro fecha somente o menu e restaura seu foco; depois fecha o drawer e restaura o item que o abriu. Controles de comentário/critério/subtarefa foram verificados pelo estado persistido, não apenas pelo texto digitado.

## Falhas resolvidas durante aceitação

- Botões de formulários que não submetiam comentários, critérios ou subtarefas.
- Tema persistido que inicialmente não aplicava o token visual ao documento.
- Escape de menu propagado para o drawer.
- Referências entre organizações/projetos e validação do time padrão.
- Snapshots de histórico que compartilhavam objetos mutáveis.
- Filtro/detalhe/breadcrumb de arquivados que ignoravam o escopo de organização.
- Alinhamento de filtros, rótulos e ações dos modais em relação à fonte.

Sem falhas materiais de aceitação pendentes. Evidência detalhada local: output/validation/web/report/index.html, traces e screenshots em output/validation/web. A suíte pode ser repetida com pnpm test:web:e2e.
