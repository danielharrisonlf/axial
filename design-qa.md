# Validação visual - Axial Workspace

final result: passed

Data: 18/11/2026. Referência: protótipo ProjectFlow em `projectflow-ai-prototipo` (branch `main`, design system dos commits `2c17385` a `cfa3559`, correções `aaf592e` a `43d5de4` e `6c51e3e`, limpeza de cenografia `1cf613f` a `4a078ac`). Implementação: Workspace React em `apps/web` e Insights Vue em `apps/insights`. O resultado vem de capturas reais no Chromium e de testes automatizados, não só do build.

## Referência e método

As referências são as capturas `output/auditoria/depois/` do protótipo, copiadas para [docs/design-reference](docs/design-reference). As capturas do Axial ficam em [docs/screenshots](docs/screenshots), com o **mesmo nome de arquivo** do par no protótipo (`<tela>-<largura>-<tema>.png`). As duas foram tiradas com viewport 1440×900 e 390×900 (a altura cresce até o fim do conteúdo), temas claro e escuro, perfil Helena Costa (Administrador) e os mesmos dados fictícios.

Cada par foi comparado lado a lado. Ficaram equivalentes, exceto pela marca e pelos dados que dependem do dia: as datas do cenário são relativas à data de restauração, então prazos, "há N h" e a saudação mudam entre as capturas.

## Capturas (92 pares)

Cada tela tem 4 arquivos (`-1440-light`, `-1440-dark`, `-390-light`, `-390-dark`); os estados marcados com * só existem em 1440 no protótipo.

| Tela ou estado | Protótipo | Axial |
| --- | --- | --- |
| Início | [depois](docs/design-reference/dashboard-1440-light.png) | [Axial](docs/screenshots/dashboard-1440-light.png) |
| Projetos | [depois](docs/design-reference/projects-1440-light.png) | [Axial](docs/screenshots/projects-1440-light.png) |
| Detalhe do projeto | [depois](docs/design-reference/projects-prj-pcl-1440-light.png) | [Axial](docs/screenshots/projects-prj-pcl-1440-light.png) |
| Minhas tarefas | [depois](docs/design-reference/my-tasks-1440-light.png) | [Axial](docs/screenshots/my-tasks-1440-light.png) |
| Kanban | [depois](docs/design-reference/board-1440-light.png) | [Axial](docs/screenshots/board-1440-light.png) |
| Kanban com inspector aberto | [depois](docs/design-reference/estado-drawer-tarefa-1440-light.png) | [Axial](docs/screenshots/estado-drawer-tarefa-1440-light.png) |
| Backlog | [depois](docs/design-reference/backlog-1440-light.png) | [Axial](docs/screenshots/backlog-1440-light.png) |
| Sprints | [depois](docs/design-reference/sprints-1440-light.png) | [Axial](docs/screenshots/sprints-1440-light.png) |
| Cronograma | [depois](docs/design-reference/timeline-1440-light.png) | [Axial](docs/screenshots/timeline-1440-light.png) |
| Notificações | [depois](docs/design-reference/notifications-1440-light.png) | [Axial](docs/screenshots/notifications-1440-light.png) |
| Usuários e permissões | [depois](docs/design-reference/access-1440-light.png) | [Axial](docs/screenshots/access-1440-light.png) |
| Agentes MCP (catálogo) | [depois](docs/design-reference/mcp-1440-light.png) | [Axial](docs/screenshots/mcp-1440-light.png) |
| Agentes MCP (console) | [depois](docs/design-reference/mcp-test-1440-light.png) | [Axial](docs/screenshots/mcp-test-1440-light.png) |
| Configurações | [depois](docs/design-reference/settings-1440-light.png) | [Axial](docs/screenshots/settings-1440-light.png) |
| Insights: visão executiva | [depois](docs/design-reference/insights-1440-light.png) | [Axial](docs/screenshots/insights-1440-light.png) |
| Insights: análise de projetos | [depois](docs/design-reference/insights-analytics-1440-light.png) | [Axial](docs/screenshots/insights-analytics-1440-light.png) |
| Insights: central de auditoria | [depois](docs/design-reference/insights-audit-1440-light.png) | [Axial](docs/screenshots/insights-audit-1440-light.png) |
| Modal "Nova tarefa" | [depois](docs/design-reference/estado-modal-nova-tarefa-1440-light.png) | [Axial](docs/screenshots/estado-modal-nova-tarefa-1440-light.png) |
| Modal com erro de validação | [depois](docs/design-reference/estado-modal-erro-1440-light.png) | [Axial](docs/screenshots/estado-modal-erro-1440-light.png) |
| Menu dentro do drawer | [depois](docs/design-reference/estado-menu-no-drawer-1440-light.png) | [Axial](docs/screenshots/estado-menu-no-drawer-1440-light.png) |
| Avisos (toasts) | [depois](docs/design-reference/estado-toasts-1440-light.png) | [Axial](docs/screenshots/estado-toasts-1440-light.png) |
| Filtro do Kanban: menu * | [depois](docs/design-reference/estado-filtro-kanban-menu-1440-light.png) | [Axial](docs/screenshots/estado-filtro-kanban-menu-1440-light.png) |
| Filtro do Kanban: chips * | [depois](docs/design-reference/estado-filtro-kanban-chips-1440-light.png) | [Axial](docs/screenshots/estado-filtro-kanban-chips-1440-light.png) |
| Propriedade do inspector * | [depois](docs/design-reference/estado-propriedade-inspector-1440-light.png) | [Axial](docs/screenshots/estado-propriedade-inspector-1440-light.png) |
| Tooltip do gráfico * | [depois](docs/design-reference/estado-tooltip-grafico-1440-light.png) | [Axial](docs/screenshots/estado-tooltip-grafico-1440-light.png) |

## Diferenças deliberadas

- **Marca.** ProjectFlow AI/"P" virou Axial/"A" (marca SVG de traço, como a do protótipo).
- **Navegação.** O Axial não tem Assistente de IA nem Webhooks, que ficam fora do escopo do PDF. "Agentes MCP" mostra o catálogo das **8** ferramentas reais de `apps/mcp-server` (ids em vez de chave/ref, como no schema do servidor) e um console que executa sobre os dados da demonstração, com as permissões do perfil e origem "Agente MCP" na auditoria. O protótipo tem 11 ferramentas fictícias.
- **Insights.** É um microfrontend Vue. A navegação (Visão executiva, Análise de projetos, Central de auditoria) é do shell do Workspace, como no protótipo. O remoto traz uma cópia dos tokens e componentes em `@scope (.ins-root)` para funcionar sozinho; o drawer de auditoria prende o foco e fecha com Esc, mas não deixa o shell do host inerte. Não exibe "Evento emitido", que não chega no payload.
- **Projetos.** A lista ganhou ordenação por coluna (`aria-sort`). Não há "Excluir projeto" (não existe essa ação no Axial). Um projeto arquivado aberto pelo endereço mostra o estado "Projeto arquivado" com Restaurar, como no protótipo.
- **Kanban.** O card é `div role=button` arrastável; o nome acessível é "REF Título" e status, subtarefas e o atalho Alt+setas vão por `aria-describedby`.
- **Tipografia.** IBM Plex vem de `@fontsource` (latin, `font-display: optional`), e não do Google Fonts. A largura de `ch` muda alguns pixels, então subtítulos limitados a 72ch podem quebrar uma linha antes (ex.: detalhe do projeto).
- **Avisos.** Iguais ao protótipo (fechar, pausa no hover/foco, erro persiste, máximo 3, repetidos agrupados com "(N×)"). Sem "Desfazer", pendência que o protótipo também registra (UI-19).
- **Prazo no inspector.** Continua `input type=date` nativo, como no protótipo (pendência UI-47).
- **Ajustes de CSS.** O stylesheet é o do protótipo, mais uma seção "8. Ajustes do Axial", só com tokens: o chevron de ordenação ocupa espaço apenas na coluna ordenada (evitava 13px de rolagem em 1440), o título somente leitura do inspector mantém o recuo, a legenda de `fieldset.field` tem a mesma folga do rótulo e o asterisco de obrigatório sai do nome acessível (`content: " *" / ""`).

## Resultados

| Verificação | Resultado |
| --- | --- |
| `pnpm lint` | 188 arquivos, 0 erros |
| `pnpm typecheck` | 13/13 tarefas |
| `pnpm build` | 11/11 tarefas (o aviso `Module Federation DTS TYPE-001` do Insights já existia em `dev` e não falha o build) |
| `pnpm test` | 12/12 tarefas; `@axial/web` 29 testes (inclui seed 9, migração 8→9, prazo local, favoritos por perfil, `doneAt`, origem MCP e avisos agrupados) |
| `pnpm test:web:e2e` | 16/16 cenários no Chromium, sem retries e com zero erros de console ou de página por cenário |
| Rolagem horizontal a 390 px | 0 px na página e no conteúdo em 18 rotas × 2 temas (e2e) e nas 38 capturas de 390 |
| Contraste AA (`getComputedStyle`) | 6.226 textos medidos em 25 telas e estados × 2 temas, 0 abaixo de 4,5:1 (3:1 para texto grande); contornos de controle ≥ 3:1. O e2e repete a medição em 18 rotas × 2 temas |
| Erros de console | 0 nas 92 capturas e nos 15 cenários |

### Acessibilidade e teclado verificados no e2e

- Skip link "Pular para o conteúdo" no primeiro Tab, sem mudar a rota; landmarks `header`, `nav`, `main`, `aside` e `search`.
- Ctrl/⌘+K foca a busca de qualquer tela (não sobre um diálogo); digitar nas buscas mantém foco e cursor.
- Modal: foco no primeiro campo, Tab preso, Esc fecha e devolve o foco ao gatilho; erro de validação com `aria-invalid`, `aria-describedby` e foco no primeiro inválido.
- Drawer: Esc num menu de propriedade fecha só o menu e devolve o foco ao botão; o segundo Esc fecha o drawer e devolve o foco ao card ou à linha.
- Menus no padrão APG (setas, Home/End, busca por letra, Tab fecha, `menuitemradio`/`menuitemcheckbox`).
- Kanban: Enter abre o inspector; Alt+→/← move o card de coluna, mantém o foco nele e anuncia a mudança na live region dedicada.
- Navegação móvel: backdrop, conteúdo inerte, Esc fecha e devolve o foco ao botão de menu.

## Auditoria ponta a ponta (18/11/2026)

Depois da porta, duas auditorias exploratórias percorreram os fluxos da apresentação (planejar, organizar, executar, notificar, acompanhar e MCP) com os cinco perfis, a 1440 e 390 px, nos dois temas, sem erros de console. As suítes de backend rodaram contra `axial_test`. Achados corrigidos:

| Achado | Correção |
| --- | --- |
| Esc no inspector descartava título/descrição em edição | O drawer grava o rascunho ao fechar por qualquer caminho |
| Desenvolvedor abria o Insights (sem `insights.view`) | Página "Acesso restrito"; a matriz e a regra agora concordam |
| Desenvolvedor atribuía tarefas a outras pessoas (pelo console MCP) | `task.assign` exigido no store, como no protótipo (assumir a própria tarefa continua permitido) |
| Visualizador via a outra organização | Escopo da própria organização, como no protótipo |
| Líder via entregas de projetos fora do seu escopo; sino e página com regras diferentes | Uma regra única: próprias entregas; Administrador e Gestor veem as da organização |
| "Tentativas sem permissão são registradas" não era verdade | Toda negação vira registro `denied` na auditoria, e o aviso diz o que o perfil não pode fazer |
| Detalhe de auditoria listava a tarefa inteira (21 campos, `[object Object]`) | Só os campos alterados; critérios, booleanos, pessoas e status legíveis |
| Atribuição e bloqueio registrados como "atualizou" | Ações próprias (Atribuição, Bloqueio, Desbloqueio, Prioridade) com resumo legível |
| A ação recém-feita aparecia em 6º (registros do seed no futuro, "agora") | Instantes do seed sempre no passado, ordem preservada |
| Achar a tarefa movida exigia 4 filtros | Busca por referência ou texto; coluna Entidade mostra "Tarefa · PCL-110"; filtros só com opções existentes |
| Risco diferente entre Workspace e Insights após concluir um bloqueador | Mesma regra: só bloqueador aberto conta; KPI de risco do Início conta projetos ativos |
| `update-task-status` ignorava a versão | Versão derivada e exigida; versão antiga devolve `version_conflict` |
| Restaurar focava o botão destrutivo e trocava o tema | Foco em "Cancelar"; o tema é mantido |
| Projeto salvo sem data de início sumia do Cronograma | Início obrigatório na edição |
| Subtarefa de tarefa em sprint encerrada falhava | A subtarefa não herda sprint encerrada |
| Convite não entrava nas equipes, sem foco no erro nem Enter | Entra nas equipes; foco no primeiro inválido; Enter envia |
| Sem retorno visual em editar/arquivar/restaurar projeto, excluir tarefa e sprints | Avisos de sucesso |
| Textos: ids crus na auditoria, "dia(s)", "1 tarefas", crase em "acesso à", "Desenvolvedor / Colaborador", "Visualizador / Auditor", "Vence em 1d", vazios que sugeriam ações proibidas | Corrigidos; o seed migra os nomes de papéis e templates |
| Sino abria só a lista; reenvio fechava o drawer mesmo com falha | O item do sino abre a entrega; o drawer fica aberto e mostra o resultado |
| Busca a 390 px com 166 px de largura; aba ativa cortada | Resultados na largura da tela; a aba ativa rola para a vista |
| Teste de integração do relay dependia de outbox vazio | O evento do teste é o mais antigo da fila; não depende de resíduos de outras suítes |

Regras confirmadas e mantidas: a Central de auditoria segue o ms-audit (ADMIN, PROJECT_MANAGER e TEAM_LEAD). Por isso o papel se chama apenas "Visualizador" e Sérgio passou a "Gerente de Operações". A sincronização entre telas é do backend (ms-realtime); a interface de demonstração não abre conexão.

Pendências de baixa severidade: o foco volta ao título (e não à linha da auditoria) ao fechar uma tarefa aberta pelo Insights; o filtro Equipe do Insights não recalcula o progresso; o losango de marco pode cobrir o rótulo da barra no Cronograma (igual ao protótipo); tabelas a 390 px rolam dentro do painel; não há tela para gerenciar integrantes de equipe.

Verificação após as correções: `pnpm lint` (188 arquivos), `pnpm typecheck` 13/13, `pnpm build` 11/11, `pnpm test` 12/12 (web 29 testes), `pnpm test:integration` 3/3, `pnpm test:e2e` 13/13, `pnpm test:web:e2e` 16/16, as suítes de integração de identity, realtime, notifications, gateway, mcp e audit, 92 capturas sem rolagem horizontal nem erro de console e 6.226 textos com contraste AA.

## Limitações conhecidas

- Os servidores de desenvolvimento do checkout principal ocupavam 5173/5174 durante a validação. O e2e aceita `WEB_E2E_PORT` e `INSIGHTS_E2E_PORT` para que outra cópia do repositório não seja testada por engano (`reuseExistingServer`).
- O e2e mede contraste na largura de 1440; a 390 verifica a rolagem. A medição ampla (estados com menu, modal, drawer, toasts e tooltip) foi feita com o mesmo algoritmo por script durante a validação.
- Pendências herdadas do protótipo: "Desfazer" no aviso, seletor de data próprio no inspector e skeleton (as operações são síncronas).
