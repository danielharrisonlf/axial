# Identidade, API e eventos

## Identidade

Todas as rotas de negócio usam `Authorization: Bearer <JWT RS256>`. Rotas de saúde são públicas. Documentação Swagger só é exposta fora de produção.

Claims obrigatórias: sub (UUID do usuário), organizationId (UUID), role, iss, aud, iat e exp. Arrays opcionais com padrão vazio: teamIds, projectIds, assignableUserIds e assignableTeamIds. Source assinado: ui, api, mcp ou automation (padrão api). Referências atribuíveis representam entidades válidas da organização, segundo o emissor de identidade; o serviço não consulta outro schema.

| Papel | Leitura | Alterações |
| --- | --- | --- |
| ADMIN / PROJECT_MANAGER | Projetos da organização | Gestão de projetos e recursos, arquivo/restauração |
| TEAM_LEAD | Projetos explicitamente permitidos ou de suas equipes | Gestão quando o projeto possui equipe do ator; tarefas apenas de suas equipes; não muda membros do projeto |
| CONTRIBUTOR | Projetos explicitamente permitidos ou de suas equipes | Título, descrição, status e critérios de aceite das próprias tarefas atribuídas; comentários |
| VIEWER | Projetos explicitamente permitidos ou de suas equipes | Somente leitura |

Essas regras são funções puras exportadas por `@axial/contracts` (`policy.ts`: canManageProject, canCreateTask, editableTaskFields, canAssign, canComment, canModifyComment, canDeleteTask etc.) e usadas pelo ms-projects; clientes podem usá-las para adaptar a interface, mas a decisão continua no servidor. Comentários só são editados/excluídos pelo autor ou gestor autorizado. Papel e origem MCP não concedem privilégios adicionais. IDs inacessíveis retornam 404, operações sem permissão retornam 403 e credenciais inválidas retornam 401.

## HTTP

Prefixo `/api/v1`. Corpo JSON limitado a 256kb. UUIDs, enums, datas ISO8601, limites e campos desconhecidos são validados. Respostas de erro incluem statusCode, message e correlationId; detalhes de banco e credenciais não são expostos. `x-correlation-id` pode ser informado com caracteres seguros e até 128 posições, e é devolvido na resposta.

Atualizações recebem `version` no JSON; exclusões recebem `?version=N`. Use a versão retornada pela última leitura. Conflitos de versão e estado retornam 409. Campos omitidos em PATCH são preservados; para limpar referências/datas anuláveis envie null.

Listagens usam `page` (padrão 1) e `pageSize` (padrão 25, máximo 100), retornando `{items,total,page,pageSize}`. Kanban pagina cada coluna independentemente. Timeline pagina separadamente suas coleções tasks, sprints e milestones.

| Recurso | Rotas |
| --- | --- |
| Projetos | GET/POST projects; GET/PATCH projects/:id; POST projects/:id/archive e restore |
| Épicos | GET/POST projects/:projectId/epics; GET/PATCH/DELETE epics/:id |
| Tarefas | GET/POST projects/:projectId/tasks; GET/PATCH/DELETE tasks/:id; PATCH tasks/:id/status |
| Listas da organização | GET tasks, epics, sprints e milestones (somente projetos legíveis pelo ator, incluindo arquivados) |
| Projeções | GET projects/:projectId/board, backlog, timeline e summary |
| Sprints | GET/POST projects/:projectId/sprints; GET/PATCH/DELETE sprints/:id; POST sprints/:id/start e complete |
| Comentários | GET/POST tasks/:taskId/comments; PATCH/DELETE comments/:id |
| Marcos | GET/POST projects/:projectId/milestones; GET/PATCH/DELETE milestones/:id |
| Saúde | GET health/live e health/ready |

Projetos filtram por search, status e archived. Tarefas filtram por search, status, priority, assigneeId, teamId, epicId, sprintId, parentId e label. As listas da organização aplicam o mesmo escopo de leitura das rotas por projeto; `GET tasks` filtra por assigneeId, status, projectId, search (título ou ref) e dueBefore (ISO8601, prazo estritamente anterior) e ordena por criação decrescente; epics, sprints e milestones filtram por projectId. Um projectId inacessível retorna 404. Projetos aceitam `color` opcional no formato `#RRGGBB` (null limpa). Critérios de aceite são `[{"text": "...", "done": false}]`; a forma antiga de string ainda é aceita na entrada e convertida para `{text, done: false}`, e as respostas sempre usam objetos. O endpoint summary retorna total, done, byStatus, overdue, completionPercent, estimatedPoints e completedPoints, contando apenas tarefas de primeiro nível.

Exemplo de criação de tarefa:

```json
{
  "title": "Validar primeira entrega",
  "status": "todo",
  "priority": "high",
  "labels": ["backend"],
  "acceptanceCriteria": [{ "text": "Resposta HTTP e evento conferidos", "done": false }],
  "estimate": 3
}
```

Exemplo de movimentação:

```json
{ "version": 1, "status": "in_progress", "position": 10 }
```

O documento OpenAPI versionado contém rotas, autenticação, parâmetros e schemas de entrada derivados dos mesmos contratos Zod usados em execução. Os modelos de resposta seguem as entidades e projeções descritas aqui; não são contratos de cliente gerado nesta etapa.

## Eventos

Catálogo exportado por `@axial/contracts`: project.created/updated/archived/restored; epic.created/updated/deleted; task.created/updated/status_changed/completed/assigned/deleted; sprint.created/updated/started/completed/deleted; comment.created/updated/deleted; milestone.created/updated/deleted.

Nome sem sufixo e campo version=1, preservando o exemplo `task.completed` do PDF. Filas: axial-realtime, axial-notifications e axial-audit.

```json
{
  "id": "UUID do evento",
  "type": "task.completed",
  "version": 1,
  "occurredAt": "2026-11-05T12:00:00.000Z",
  "organizationId": "UUID da organizacao",
  "projectId": "UUID do projeto",
  "aggregate": { "type": "task", "id": "UUID da tarefa", "version": 2 },
  "actor": { "id": "UUID do usuario", "source": "api" },
  "correlationId": "identificador da requisicao",
  "data": { "before": {}, "after": {} }
}
```

before/after contém o estado relevante da entidade, incluindo referências de dependência nas tarefas. Uma transição para done emite task.completed; repetir done não emite outro completed. Reabrir e concluir novamente é uma nova transição. Alteração simultânea de status e responsável usa o evento de status com before/after completos.

Cada consumidor futuro deve persistir a deduplicação pelo id e não depender da retenção de job do BullMQ como garantia permanente. Não há endpoint público de auditoria ou de reprocessamento do outbox nesta entrega.
