import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { useWorkspace } from "../data/workspace";

type Mount = typeof import("insights/mount").mount;
const AUDIT_ROLES = new Set(["admin", "pm", "lead"]);

/**
 * Host side of the Vue microfrontend. The payload is memoized so the remote is
 * mounted once per data change; without a stable identity the effect restarts
 * on every render and cancels the first mount.
 */
export function Insights() {
  const { db, me, can, visibleTasks, accessibleProjects } = useWorkspace();
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  const payload = useMemo(() => {
    const projectIds = new Set(accessibleProjects.map((project) => project.id));
    return {
      projects: accessibleProjects.map((project) => ({
        id: project.id,
        orgId: project.orgId,
        name: project.name,
        key: project.key,
        status: project.status,
        targetDate: project.targetDate,
        leadId: project.leadId,
        teamIds: project.teamIds,
        archived: project.archived,
      })),
      tasks: visibleTasks.map((task) => ({
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        status: task.status,
        priority: task.priority,
        assigneeId: task.assigneeId,
        teamId: task.teamId,
        sprintId: task.sprintId,
        parentId: task.parentId,
        blockedBy: task.blockedBy,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        dueDate: task.dueDate,
      })),
      users: db.users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        initials: user.initials,
        color: user.color,
        teamIds: user.teamIds,
        roleId: user.roleId,
        active: user.active,
      })),
      teams: db.teams.map((team) => ({ id: team.id, name: team.name, orgId: team.orgId })),
      sprints: db.sprints.map((sprint) => ({
        id: sprint.id,
        projectId: sprint.projectId,
        name: sprint.name,
        status: sprint.status,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
      })),
      orgs: db.orgs.map((org) => ({ id: org.id, name: org.name })),
      audit: db.audit.filter((entry) => !entry.projectId || projectIds.has(entry.projectId)),
      roleId: me.roleId,
      canAudit: AUDIT_ROLES.has(me.roleId) && can("audit.view"),
      theme: db.settings.theme === "dark" ? ("dark" as const) : ("light" as const),
    };
  }, [accessibleProjects, can, db, me, visibleTasks]);

  useEffect(() => {
    void attempt;
    let unmount: (() => void) | undefined;
    let cancelled = false;
    setState("loading");
    void import("insights/mount")
      .then(({ mount }) => {
        if (cancelled || !host.current) return;
        unmount = (mount as Mount)(host.current, payload);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
      unmount?.();
    };
  }, [attempt, payload]);

  if (state === "error")
    return (
      <div className="empty">
        <div className="e-ic">
          <Icon name="pulse" size={22} />
        </div>
        <b>Insights indisponível</b>
        <p>
          O microfrontend remoto não respondeu. Inicie-o com <code>pnpm dev:insights</code> e tente novamente.
        </p>
        <button type="button" className="btn btn-sm" onClick={() => setAttempt((value) => value + 1)}>
          <Icon name="refresh" size={13} />
          Tentar novamente
        </button>
      </div>
    );

  return (
    <>
      <div ref={host} data-state={state} aria-busy={state === "loading"} />
      {state === "loading" && (
        <div className="empty" role="status">
          <b>Carregando Insights…</b>
          <p>O microfrontend Vue está sendo carregado sob demanda.</p>
        </div>
      )}
    </>
  );
}
