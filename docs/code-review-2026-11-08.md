# Code review — 08/11/2026

Revisão estática do commit `f03f163f4f245766451fdac111fc421af294b9ed`: API de projetos, frontend de demonstração, contratos, infraestrutura e segurança do novo ms-identity. Os cenários abaixo derivam da leitura do código; não foram reproduzidos individualmente em testes, salvo quando indicado. Prioridades expressam impacto e urgência, não provam exploração em produção.

## Achados

1. **P1 — Encerramento de sprint altera tarefas de outras equipes.** `apps/api/src/modules/projects.service.ts:718` autoriza TEAM_LEAD pela presença em qualquer equipe do projeto e move todas as tarefas pendentes da sprint, sem conferir a equipe de cada tarefa. A matriz de autorização restringe alterações de tarefas à equipe do líder. Um líder pode assim mudar status e sprint de tarefas de outra equipe.
2. **P2 — TEAM_LEAD pode retirar a equipe de uma tarefa.** `apps/api/src/modules/projects.service.ts:349` testa a permissão do novo `teamId` apenas quando ele é truthy. Como o contrato aceita `null`, o líder pode retirar a equipe de uma tarefa e deixá-la fora do alcance de edição dos demais líderes.
3. **P2 — A demonstração permite estados inconsistentes de dependências.** `apps/web/src/data/workspace.ts:459` aceita mudança de status sem aplicar as regras de dependências e subtarefas do backend; o Kanban chama a mutação diretamente. É possível concluir uma tarefa bloqueada ou um pai com filho aberto, e reabrir um bloqueador de tarefa já concluída.
4. **P2 — Criação rápida pode descartar o texto.** `apps/web/src/pages/Work.tsx:120` preserva o filtro de sprint ao trocar de projeto; na criação rápida (`Work.tsx:279`) envia a sprint antiga e limpa o texto mesmo que a mutação seja recusada por pertencer a outro projeto.
5. **P2 — O quadro pode abrir outro projeto.** `apps/web/src/pages/Work.tsx:35` exclui projetos concluídos e escolhe o primeiro disponível como fallback. Ao selecionar Kanban no detalhe de um projeto concluído, outro projeto aparece sem aviso ou é exibido um estado vazio.
6. **P2 — Indicador de bloqueio permanece após conclusão do bloqueador.** `apps/web/src/components/Tasks.tsx:488` e `apps/web/src/pages/Work.tsx:92` consideram a existência de IDs em `blockedBy`, sem verificar o status atual dessas tarefas. A conclusão do bloqueador não remove a indicação.
7. **P2 — Encerramento de sprint pode exceder o prazo da transação.** `apps/api/src/modules/projects.service.ts:725` faz operações sequenciais por tarefa sob bloqueio do projeto; a transação tem prazo de 20 segundos em `projects.repository.ts:45`. Em carga ou banco lento, o encerramento pode sofrer rollback repetidamente. O limiar não foi medido.

## Limites de identidade

O token já emitido pode continuar válido no ms-projects por até cinco minutos após alteração de acesso; o tamanho do JWT pode impedir login quando há muitas referências. A senha inicial é conhecida pelo administrador que provisiona a conta, que pode ativá-la antes do titular: um convite por canal independente ainda é necessário. Limites por processo também requerem proteção compartilhada no ingresso quando houver réplicas. A prontidão sobre banco sem a migration 002 foi identificada durante esta revisão e corrigida: readiness agora exige as duas migrations e o teste verifica a ausência de cada uma.

A interface é demonstração local e ainda não está conectada à API. Resultados de CI e testes de interoperabilidade não substituem testes individuais de cada achado.
