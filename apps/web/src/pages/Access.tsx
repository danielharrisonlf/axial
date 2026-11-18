import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Avatar, Field, FieldGroup, Overlay, PageHead, Select, TabNav } from "../components/ui";
import type { RoleId } from "../data/types";
import { CAPABILITY_MATRIX, roleHasCapability, useWorkspace } from "../data/workspace";

const TABS = ["users", "roles"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function InviteModal({ onClose }: { onClose: () => void }) {
  const { db, me, act } = useWorkspace();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [roleId, setRoleId] = useState<RoleId>("dev");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const teams = db.teams.filter((team) => team.orgId === me.orgId);
  // after a failed attempt, focus goes to the first invalid field (as in the other forms)
  const form = useRef<HTMLFormElement>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (attempt) form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [attempt]);

  const submit = () => {
    const next: { name?: string; email?: string } = {};
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (cleanName.split(" ").filter(Boolean).length < 2) next.name = "Informe nome e sobrenome";
    if (!EMAIL_RE.test(cleanEmail)) next.email = "E-mail inválido";
    else if (db.users.some((user) => user.email.toLowerCase() === cleanEmail))
      next.email = "Já existe uma pessoa com esse e-mail";
    setErrors(next);
    if (next.name || next.email) {
      setAttempt((n) => n + 1);
      return;
    }
    if (act.inviteUser({ name: cleanName, email: cleanEmail, title: title.trim(), roleId, teamIds }))
      onClose();
  };

  return (
    <Overlay
      title="Convidar pessoa"
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            Enviar convite
          </button>
        </>
      }
    >
      {/* a real form: Enter in a text field sends the invite (implicit submission) */}
      <form
        className="form-grid"
        ref={form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
        <Field label="Nome completo" wide required error={errors.name}>
          <input
            className="input"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="E-mail" required error={errors.email}>
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
          {(props) => (
            <select
              className="select"
              {...props}
              value={roleId}
              onChange={(event) => setRoleId(event.target.value as RoleId)}
            >
              {db.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <FieldGroup label="Equipes" wide>
          <div>
            {teams.map((team) => (
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
        </FieldGroup>
      </form>
    </Overlay>
  );
}

export function Access({ tab = "users" }: { tab?: string }) {
  const { db, me, can, act } = useWorkspace();
  const active = TABS.includes(tab) ? tab : "users";
  const [invite, setInvite] = useState(false);
  const manage = can("user.manage");
  const roleName = (roleId: RoleId) => db.roles.find((role) => role.id === roleId)?.name ?? roleId;
  return (
    <>
      <PageHead
        title="Usuários e permissões"
        sub="Organização → Equipe → Cargo → Papel de acesso. O papel define capacidades; o cargo descreve a função; a participação em projeto vem das equipes."
      >
        {manage && (
          <button type="button" className="btn btn-primary" onClick={() => setInvite(true)}>
            <Icon name="plus" size={14} />
            Convidar pessoa
          </button>
        )}
      </PageHead>
      <TabNav
        label="Seções de usuários e permissões"
        items={[
          { key: "users", label: "Usuários" },
          { key: "roles", label: "Papéis e permissões" },
        ]}
        active={active}
        base="/access/"
      />
      {active === "users" ? (
        <div className="panel">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Pessoa</th>
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
                  return (
                    <tr key={user.id}>
                      <td>
                        <span className="who-cell">
                          <Avatar user={user} decorative />
                          <span>
                            <b>{user.name}</b>
                            {manage && <span className="cell-sub">{user.email}</span>}
                          </span>
                        </span>
                      </td>
                      <td>{user.title || "—"}</td>
                      <td>{org?.name ?? "—"}</td>
                      <td>
                        <div className="cell-chips">
                          {user.teamIds.map((teamId) => {
                            const team = db.teams.find((item) => item.id === teamId);
                            return team ? (
                              <span className="chip" key={teamId}>
                                {team.name}
                              </span>
                            ) : null;
                          })}
                        </div>
                      </td>
                      <td>
                        {manage && user.id !== me.id ? (
                          <Select
                            className="select role-select"
                            label={`Papel de ${user.name}`}
                            value={user.roleId}
                            onChange={(value) => act.setUserRole(user.id, value as RoleId)}
                            options={db.roles.map((role) => ({ value: role.id, label: role.name }))}
                          />
                        ) : (
                          <span className="chip">{roleName(user.roleId)}</span>
                        )}
                      </td>
                      <td>
                        {user.invited ? (
                          <span className="chip warn">Convite pendente</span>
                        ) : (
                          <span className="chip ok">Ativo</span>
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
          <p className="muted page-lead">
            As operações validam estas capacidades de fato — esconder o botão não é a única barreira.
            Tentativas sem permissão são registradas na auditoria.
          </p>
          <div className="stack">
            {CAPABILITY_MATRIX.map((group) => (
              <div className="panel" key={group.group}>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>{group.group}</th>
                        {db.roles.map((role) => (
                          <th key={role.id} className="center">
                            {role.name.split(" ")[0]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item) => (
                        <tr key={item.cap}>
                          <td>{item.label}</td>
                          {db.roles.map((role) => (
                            <td key={role.id} className="center">
                              {roleHasCapability(role.id, item.cap) ? (
                                <span className="cap-yes" role="img" aria-label="Sim">
                                  <Icon name="check" size={14} />
                                </span>
                              ) : (
                                <span className="subtle" role="img" aria-label="Não">
                                  —
                                </span>
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
          </div>
        </>
      )}
      {invite && <InviteModal onClose={() => setInvite(false)} />}
    </>
  );
}
