import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/ui";
import { useWorkspace } from "../data/workspace";

type Mount = typeof import("insights/mount").mount;

/**
 * Host side of the Vue microfrontend. The remote is fetched only when the
 * Insights app opens, so the delivery bundle stays unaffected.
 */
export function Insights() {
  const { db, visibleProjects, visibleTasks } = useWorkspace();
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    void attempt;
    let unmount: (() => void) | undefined;
    let cancelled = false;
    setState("loading");
    void import("insights/mount")
      .then(({ mount }) => {
        if (cancelled || !host.current) return;
        const mounted = (mount as Mount)(host.current, {
          projects: visibleProjects.map((project) => ({
            id: project.id,
            name: project.name,
            key: project.key,
            status: project.status,
            targetDate: project.targetDate,
          })),
          tasks: visibleTasks.map((task) => ({
            id: task.id,
            projectId: task.projectId,
            title: task.title,
            status: task.status,
            priority: task.priority,
            assigneeId: task.assigneeId,
            teamId: task.teamId,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            dueDate: task.dueDate,
          })),
          users: db.users.map((user) => ({
            id: user.id,
            name: user.name,
            teamIds: user.teamIds,
            active: user.active,
          })),
          sprints: db.sprints.map((sprint) => ({
            id: sprint.id,
            projectId: sprint.projectId,
            name: sprint.name,
            status: sprint.status,
            startDate: sprint.startDate,
            endDate: sprint.endDate,
          })),
          theme: db.settings.theme === "dark" ? "dark" : "light",
        });
        unmount = mounted;
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
      unmount?.();
    };
  }, [attempt, db.users, db.sprints, db.settings.theme, visibleProjects, visibleTasks]);

  return (
    <>
      <PageHead title="Insights" sub="Analytics de entrega em um microfrontend Vue carregado sob demanda." />
      {state === "error" ? (
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
      ) : (
        <div ref={host} data-state={state} aria-busy={state === "loading"} />
      )}
    </>
  );
}
