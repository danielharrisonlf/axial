# Requisitos e fonte de escopo

Fonte primária: apresentação `ProjectFlow (2).pdf`, 11 páginas, fornecida pelo usuário em 05/11/2026. O produto foi renomeado para Axial antes desta implementação. O PDF foi extraído e as páginas de arquitetura/eventos foram inspecionadas visualmente; o arquivo original não é copiado para o repositório.

| Fonte | Requisito definitivo | Entrega em ms-projects |
| --- | --- | --- |
| Páginas 5-6 | Projetos, épicos, tarefas, subtarefas e planejamento | CRUD, chaves e referências estáveis, validação e eventos |
| Páginas 5-6 | Kanban e colaboração em tarefas/comentários | Projeção de quadro, movimentação de status, comentários e autoria |
| Páginas 5-6 | Sprints e cronogramas | Planejamento/início/encerramento, marcos e timeline |
| Página 6 | Equipes, papéis e permissões em ms-identity | Apenas referências e autorização das claims assinadas; sem banco de identidade |
| Páginas 5-6 | Indicadores e acompanhamento | Endpoint de resumo dos dados de projetos; sem Insights ou central de auditoria |
| Página 7 | Workspace React e Insights Vue/microfrontend | Fronteira futura; nenhum frontend nesta entrega |
| Página 8 | Cinco serviços com dados próprios | Apenas schema projects; não lê identity/audit/notifications |
| Páginas 8-10 | NestJS, TypeScript, PostgreSQL, Redis e BullMQ | Stack implementada e verificável localmente |
| Página 9 | Alteração e outbox na mesma transação | Mutação e eventos atômicos no PostgreSQL |
| Página 9 | Relay publica para tempo real, notificações e auditoria | Três filas BullMQ com retry, lease e identificador estável |
| Páginas 5 e 8 | Agentes externos usam as mesmas APIs via MCP | API com as mesmas permissões; sem mcp-server nesta entrega |

O PDF substitui a arquitetura anterior do protótipo. SNS/SQS, webhooks de saída e assistente interno de IA não são requisitos desta etapa.

## Regras adotadas para detalhes não especificados no PDF

- Organização é a fronteira de isolamento; toda referência de entidade é validada na organização e no projeto.
- Papéis iniciais: ADMIN, PROJECT_MANAGER, TEAM_LEAD, CONTRIBUTOR e VIEWER. A matriz está em api-contracts.md.
- Chave do projeto é imutável; referências de tarefa são `CHAVE-sequencia`, sem reutilização de números excluídos.
- Um nível de subtarefas. Planejamento de pai e filho é independente, sem herança automática de épico, sprint ou responsável.
- Pai só é concluído depois das subtarefas; bloqueadores precisam estar concluídos. Ciclos consideram também a dependência implícita do pai em suas subtarefas.
- Reabrir um bloqueador de tarefa concluída exige reabrir antes suas dependentes. Reabrir uma subtarefa de pai concluído exige reabrir o pai.
- Sprint: planned -> active -> done. Intervalo deve ser estritamente positivo e apenas uma sprint fica ativa por projeto.
- Encerrar sprint devolve tarefas inacabadas ao backlog: sprintId nulo e status backlog. Tarefas concluídas preservam a sprint. Conteúdo de tarefas em sprint encerrada fica imutável; comentários continuam disponíveis.
- Backlog significa tarefa sem sprint e não concluída; não é sinônimo do status backlog.
- Projeto arquivado aceita leitura e restauração, e rejeita alterações comuns.
- Exclusões são protegidas por referências: tarefa com comentários/subtarefas/dependentes não é removida; épico com tarefas e sprint não vazia também não.
- Atualizações e exclusões exigem a versão observada. Mutação concorrente com versão antiga recebe 409.
- Um PATCH preserva todos os campos omitidos. Valores padrão existem apenas na criação.
- Indicadores contam apenas tarefas de primeiro nível para evitar dupla contagem.
- Entrega assíncrona é pelo menos uma vez. Consumidores futuros devem deduplicar por event ID, verificar versões e lidar com reordenação entre eventos.
