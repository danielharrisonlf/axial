/** Sent to clients at connection time; written for the model that will drive the tools. */
export const SERVER_INSTRUCTIONS = [
  "Axial project delivery: projects, epics, tasks, Kanban, sprints, milestones and comments (ms-projects), plus the audit trail, the user's own notifications and, for administrators, teams and project access.",
  "Every call acts as the signed-in user: organization, role and project access come from their verified token and are enforced by the Axial services. Read axial://me to see who you are and which scopes you have. A 404 can mean 'outside your organization or projects'; a 403 means the role does not allow it — do not retry with other ids.",
  "Workflow: list-projects to find a project id; then list-tasks, get-board (or axial://projects/{projectId}/board), list-backlog, project-summary or list-sprints. Read an item (get-task, get-project, get-sprint…) before changing it.",
  "Writes use optimistic concurrency: pass the `version` from your latest read. A conflict (409) means it changed meanwhile or its state forbids the change: read it again, check the change still makes sense, and retry with the new version. Omitted fields are kept; null clears a nullable field.",
  "Confirm intent with the user before any write. Deletions, archive-project and complete-sprint ask the user through elicitation when the client supports it; otherwise they require confirm: true, which you may only send after the user explicitly agreed.",
  "Prompts planejar-sprint, relatorio-de-risco, refinar-tarefa and resumo-semanal embed live data; they never change anything by themselves.",
].join("\n");
