import { useState } from "react";
import { Icon } from "../components/Icon";
import { Avatar, Field, Overlay, PageHead, Select } from "../components/ui";
import type { RoleId } from "../data/types";
import { CAPABILITY_MATRIX, roleHasCapability, useWorkspace } from "../data/workspace";
import { navigate } from "../lib/format";

const TABS = [
  { id: "users", label: "Usuários" },
  { id: "roles", label: "Papéis e permissões" },
];
const ROLE_IDS: RoleId[] = ["admin", "pm", "lead", "dev", "viewer"];

function InviteModal({ onClose }: { onClose: () => void }) {
  const { db, act } = useWorkspace();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [roleId, setRoleId] = useState<RoleId>("dev");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const created = act.inviteUser({ name, email, title, roleId, teamIds });
    if (created) onClose();
    else setError("Não foi possível registrar o convite. Confira nome, e-mail e permissão.");
  };

  return (
    <Overlay
      title="Convidar colaborador"
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            Registrar convite
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Nome completo" wide error={error ?? undefined}>
          <input
            className="input"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="E-mail">
          <input
            className="input"
            type="email"
            placeholder="nome@empresa.dev"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Cargo">
          <input
            className="input"
            maxLength={50}
            placeholder="ex.: Engenheira Backend"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Papel de acesso" wide>
          <Select
            label="Papel de acesso"
            value={roleId}
            onChange={(value) => setRoleId(value as RoleId)}
            options={db.roles.map((role) => ({ value: role.id, label: role.name }))}
          />
        </Field>
        <Field label="Equipes" wide>
          <div>
            {db.teams.map((team) => (
              <label className="check" key={team.id}>
                <input
                  type="checkbox"
                  checked={teamIds.includes(team.id)}
                  onChange={(event) =>
                    setTeamIds((current) =>
                      event.target.checked ? [...current, team.id] : current.filter((id) => id !== team.id),
                    )
                  }
                />
                <span>{team.name}</span>
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Overlay>
  );
}

export function Access({ tab = "users" }: { tab?: string }) {
  const { db, me, can, act } = useWorkspace();
  const active = TABS.some((item) => item.id === tab) ? tab : "users";
  const [invite, setInvite] = useState(false);
  return (
    <>
      <PageHead
        title="Usuários e permissões"
        sub="Organização → equipe → cargo → papel de acesso. O papel define capacidades; o cargo descreve a função; a participação em projeto vem das equipes."
      >
        {can("user.manage") && (
          <button type="button" className="btn btn-primary" onClick={() => setInvite(true)}>
            <Icon name="plus" size={14} />
            Convidar colaborador
          </button>
        )}
      </PageHead>
      <div className="tabs" role="tablist" aria-label="Seções de acesso">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active === item.id}
            className={`tab${active === item.id ? " active" : ""}`}
            onClick={() => navigate(`/access/${item.id}`)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {active === "users" ? (
        <div className="panel">
          <div className="panel-head">
            <h3>Colaboradores</h3>
            <span className="spacer" />
            <span className="chip">{db.users.length}</span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th>Cargo</th>
                  <th>Organização</th>
                  <th>Equipes</th>
                  <th>Papel de acesso</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {db.users.map((user) => {
                  const org = db.orgs.find((item) => item.id === user.orgId);
                  const editable = can("user.manage") && user.id !== me.id;
                  return (
                    <tr key={user.id}>
                      <td>
                        <span className="who-cell">
                          <Avatar user={user} size="sm" />
                          <span>
                            <b>{user.name}</b>
                            <div className="subtle" style={{ fontSize: 11 }}>
                              {user.email}
                            </div>
                          </span>
                        </span>
                      </td>
                      <td>{user.title || "—"}</td>
                      <td>{org?.name ?? "—"}</td>
                      <td>
                        {user.teamIds.map((teamId) => {
                          const team = db.teams.find((item) => item.id === teamId);
                          return team ? (
                            <span className="chip" style={{ marginRight: 4 }} key={teamId}>
                              {team.name}
                            </span>
                          ) : null;
                        })}
                      </td>
                      <td>
                        {editable ? (
                          <Select
                            label={`Papel de ${user.name}`}
                            value={user.roleId}
                            onChange={(value) => act.setUserRole(user.id, value as RoleId)}
                            options={db.roles.map((role) => ({ value: role.id, label: role.name }))}
                            style={{ minWidth: 200 }}
                          />
                        ) : (
                          <span className="chip">
                            {db.roles.find((role) => role.id === user.roleId)?.name}
                          </span>
                        )}
                      </td>
                      <td>
                        {user.invited ? (
                          <span className="chip warn">convite pendente</span>
                        ) : (
                          <span className="chip ok">ativo</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: 12 }}>
            As operações validam estas capacidades de fato — esconder o botão não é a única barreira.
            Tentativas sem permissão são registradas na auditoria.
          </p>
          {CAPABILITY_MATRIX.map((group) => (
            <div className="panel" style={{ marginBottom: 14 }} key={group.group}>
              <div className="panel-head">
                <h3>{group.group}</h3>
              </div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{group.group}</th>
                      {ROLE_IDS.map((roleId) => (
                        <th key={roleId} style={{ textAlign: "center" }}>
                          {db.roles.find((role) => role.id === roleId)?.name.split(" ")[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr key={item.cap}>
                        <td>{item.label}</td>
                        {ROLE_IDS.map((roleId) => (
                          <td key={roleId} style={{ textAlign: "center" }}>
                            {roleHasCapability(roleId, item.cap) ? (
                              <span style={{ color: "var(--ok)", display: "inline-flex" }}>
                                <Icon name="check" size={14} />
                              </span>
                            ) : (
                              <span className="subtle">—</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
      {invite && <InviteModal onClose={() => setInvite(false)} />}
    </>
  );
}
