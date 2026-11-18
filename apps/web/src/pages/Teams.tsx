import { useState } from "react";
import { Icon } from "../components/Icon";
import { Avatar, Overlay, PageHead } from "../components/ui";
import { useWorkspace } from "../data/workspace";
import { isOverdue, plural } from "../lib/format";

/** Equipes: cartão por equipe com integrantes, abertas e atrasadas; integrantes num drawer. */
export function Teams() {
  const { db, me, visibleTasks } = useWorkspace();
  const [open, setOpen] = useState<string | null>(null);
  const teams = db.teams.filter(
    (t) => me.roleId === "admin" || me.roleId === "viewer" || t.orgId === me.orgId,
  );
  const team = teams.find((t) => t.id === open);
  return (
    <>
      <PageHead
        title="Equipes"
        sub="Organização, liderança e integrantes. Uma pessoa pode estar em várias equipes."
      />
      <div className="grid c3">
        {teams.map((tm) => {
          const openTasks = visibleTasks.filter(
            (t) => t.teamId === tm.id && t.status !== "done" && !t.parentId,
          );
          const late = openTasks.filter(isOverdue).length;
          const lead = db.users.find((u) => u.id === tm.leadId);
          return (
            <div className="panel" key={tm.id}>
              <div className="panel-head">
                <h2>{tm.name}</h2>
                <span className="spacer" />
                <span className="chip">{db.orgs.find((o) => o.id === tm.orgId)?.name}</span>
              </div>
              <div className="panel-body team-card">
                <p className="muted">{tm.desc}</p>
                <div className="team-people">
                  <span className="avatar-stack">
                    {tm.memberIds.slice(0, 6).map((id) => (
                      <Avatar key={id} user={db.users.find((u) => u.id === id)} size="sm" />
                    ))}
                  </span>
                  <span className="subtle">
                    {plural(tm.memberIds.length, "integrante", "integrantes")}
                    {lead ? ` · líder ${lead.name.split(" ")[0]}` : ""}
                  </span>
                </div>
                <div className="team-stats">
                  <div>
                    <span className="ts-v num">{openTasks.length}</span>
                    <span className="ts-k">abertas</span>
                  </div>
                  <div>
                    <span className={`ts-v num${late ? " text-danger" : ""}`}>{late}</span>
                    <span className="ts-k">atrasadas</span>
                  </div>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => setOpen(tm.id)}>
                  <Icon name="users" size={12} />
                  Ver integrantes
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {team && (
        <Overlay drawer title={team.name} onClose={() => setOpen(null)}>
          <p className="muted">{team.desc}</p>
          <h3 className="section-h">
            Integrantes <span className="count">{team.memberIds.length}</span>
          </h3>
          <div className="list sub-list">
            {team.memberIds.map((id) => {
              const u = db.users.find((x) => x.id === id);
              if (!u) return null;
              return (
                <div className="list-item member-row" key={id}>
                  <span className="li-lead">
                    <Avatar user={u} size="sm" decorative />
                  </span>
                  <span className="li-main">
                    <span className="li-title">{u.name}</span>
                    <span className="li-meta">{u.title}</span>
                  </span>
                  <span className="li-trail">
                    {team.leadId === id && <span className="chip accent">Líder</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </Overlay>
      )}
    </>
  );
}
