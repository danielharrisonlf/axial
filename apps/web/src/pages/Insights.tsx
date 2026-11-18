import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { useUI } from "../components/ui";
import { useWorkspace } from "../data/workspace";

type Mount = typeof import("insights/mount").mount;
type InsightsView = "executive" | "analytics" | "audit";
const AUDIT_ROLES = new Set(["admin", "pm", "lead"]);

/**
 * Host side of the Vue microfrontend. The remote is mounted once (per retry)
 * and receives new data and the current page through `update(props)`, so a
 * change in the Workspace does not rebuild the Vue app. The payload is memoized:
 * without a stable identity every render would push an update.
 */
export function Insights({ view }: { view: InsightsView }) {
  const { db, me, can, visibleTasks, accessibleProjects } = useWorkspace();
  const ui = useUI();
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  // the inspector callback changes identity with the open task; the remote keeps one stable function
  const openTaskRef = useRef(ui.openTask);
  useEffect(() => {
    openTaskRef.current = ui.openTask;
  }, [ui.openTask]);

  const data = useMemo(() => {
    const projectIds = new Set(accessibleProjects.map((project) => project.id));
    const orgIds = new Set([me.orgId, ...accessibleProjects.map((project) => project.orgId)]);
    const userOrg = new Map(db.users.map((user) => [user.id, user.orgId]));
    // project records follow project access; records without a project, the actor's organization
    const audit = db.audit.filter((entry) =>
      entry.projectId
        ? projectIds.has(entry.projectId)
        : me.roleId === "admin" || userOrg.get(entry.userId) === me.orgId,
    );
    const actorIds = new Set(audit.map((entry) => entry.userId));
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
        color: project.color,
      })),
      tasks: visibleTasks.map((task) => ({
        id: task.id,
        ref: task.ref,
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
        // real completion moment; "concluídas" never infers it from updatedAt
        doneAt: task.doneAt,
      })),
      users: db.users
        .filter((user) => orgIds.has(user.orgId) || actorIds.has(user.id))
        .map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          initials: user.initials,
          color: user.color,
          teamIds: user.teamIds,
          roleId: user.roleId,
          active: user.active,
          orgId: user.orgId,
        })),
      teams: db.teams
        .filter((team) => orgIds.has(team.orgId))
        .map((team) => ({ id: team.id, name: team.name, orgId: team.orgId })),
      sprints: db.sprints
        .filter((sprint) => projectIds.has(sprint.projectId))
        .map((sprint) => ({
          id: sprint.id,
          projectId: sprint.projectId,
          name: sprint.name,
          status: sprint.status,
          startDate: sprint.startDate,
          endDate: sprint.endDate,
        })),
      orgs: db.orgs.filter((org) => orgIds.has(org.id)).map((org) => ({ id: org.id, name: org.name })),
      roles: db.roles.map((role) => ({ id: role.id, name: role.name })),
      audit,
      meId: me.id,
      roleId: me.roleId,
      canAudit: AUDIT_ROLES.has(me.roleId) && can("audit.view"),
      openTask: (taskId: string) => openTaskRef.current(taskId),
    };
  }, [accessibleProjects, can, db, me, visibleTasks]);
  const payload = useMemo(() => ({ ...data, view }), [data, view]);

  const latest = useRef(payload);
  const handle = useRef<ReturnType<Mount> | null>(null);
  const mountFn = useRef<Mount | null>(null);

  // mount once per attempt; the element is always rendered, so a retry finds it
  useEffect(() => {
    void attempt;
    let cancelled = false;
    setState("loading");
    void import("insights/mount")
      .then(({ mount }) => {
        if (cancelled || !host.current) return;
        mountFn.current = mount;
        handle.current = mount(host.current, latest.current);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
      handle.current?.();
      handle.current = null;
    };
  }, [attempt]);

  // later data or page changes go to the mounted app
  useEffect(() => {
    latest.current = payload;
    const current = handle.current;
    if (!current || !host.current) return;
    if (canUpdate(current)) current.update(payload);
    else if (mountFn.current) {
      // remote without update(): remount with the new props
      current();
      handle.current = mountFn.current(host.current, payload);
    }
  }, [payload]);

  return (
    <>
      <div ref={host} hidden={state === "error"} aria-busy={state === "loading"} />
      {state === "loading" && (
        <div className="empty" role="status">
          <b>Carregando Insights…</b>
          <p>O microfrontend Vue está sendo carregado sob demanda.</p>
        </div>
      )}
      {state === "error" && (
        <div className="empty">
          <div className="e-ic">
            <Icon name="pulse" size={22} />
          </div>
          <b>Insights indisponível</b>
          <p>
            O microfrontend remoto não respondeu. Inicie-o com <code>pnpm dev:insights</code> e tente
            novamente.
          </p>
          <button type="button" className="btn btn-sm" onClick={() => setAttempt((value) => value + 1)}>
            <Icon name="refresh" size={13} />
            Tentar novamente
          </button>
        </div>
      )}
    </>
  );
}

interface UpdatableHandle {
  (): void;
  update: (props: object) => void;
}
/** The remote's unmount callback also carries `update(props)`; older remotes do not. */
function canUpdate(handle: () => void): handle is UpdatableHandle {
  return "update" in handle && typeof handle.update === "function";
}
