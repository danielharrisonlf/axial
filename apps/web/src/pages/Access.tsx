import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Avatar, Empty, Field, FieldGroup, Overlay, PageHead, Select, TabNav } from "../components/ui";
import { toApiRole, toRoleId } from "../data/api/mappers";
import type { RoleId } from "../data/types";
import { CAPABILITY_MATRIX, roleHasCapability, useWorkspace } from "../data/workspace";
import { fmtDate, fmtDateTime } from "../lib/format";
import { type Invitation, useSession } from "../session";

const TABS = ["users", "invites", "roles"];
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

/** Copies the invitation link; the link is shown only once (ms-identity keeps only its hash). */
function CopyLink({ url }: { url: string }) {
  const { notify } = useWorkspace();
  const copy = () => {
    const fail = () => notify("Não foi possível copiar", "Selecione o link e copie manualmente.", "warn");
    if (!navigator.clipboard?.writeText) return fail();
    navigator.clipboard.writeText(url).then(() => notify("Link copiado", "", "ok"), fail);
  };
  return (
    <div className="invite-link">
      <input
        className="input"
        readOnly
        value={url}
        aria-label="Link do convite"
        onFocus={(e) => e.target.select()}
      />
      <button type="button" className="btn" onClick={copy}>
        <Icon name="copy" size={14} />
        Copiar
      </button>
    </div>
  );
}

/** API mode: invitation by link (POST /invitations). The invitee chooses name and password. */
function ApiInviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { db, me, notify } = useWorkspace();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [roleId, setRoleId] = useState<RoleId>("dev");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const teams = db.teams.filter((team) => team.orgId === me.orgId);
  const submit = () => {
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) return setError("E-mail inválido");
    if (db.users.some((user) => user.active && user.email.toLowerCase() === clean))
      return setError("Essa pessoa já é membro ativo da empresa");
    if (!session) return;
    setError(undefined);
    setBusy(true);
    session.admin
      .createInvitation({ email: clean, role: toApiRole(roleId), teamIds, title: title.trim() || undefined })
      .then((result) => {
        setCreated(result);
        onCreated();
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : "";
        notify(
          "Convite não criado",
          /member/i.test(message)
            ? "Essa pessoa já é membro ativo da empresa."
            : "Revise os dados e tente de novo.",
          "err",
        );
      })
      .finally(() => setBusy(false));
  };
  if (created)
    return (
      <Overlay
        title="Convite criado"
        onClose={onClose}
        foot={
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Concluir
          </button>
        }
      >
        <p className="muted">
          Envie este link para <b>{email.trim().toLowerCase()}</b>. Ele vale até{" "}
          {fmtDateTime(created.expiresAt)}, pode ser usado uma vez e não poderá ser exibido de novo.
        </p>
        <CopyLink url={created.url} />
      </Overlay>
    );
  return (
    <Overlay
      title="Convidar pessoa"
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            Criar link de convite
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
        <Field label="E-mail" required error={error}>
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
            maxLength={120}
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

const INVITE_STATUS: Record<Invitation["status"], { label: string; tone: string }> = {
  pending: { label: "Pendente", tone: "warn" },
  accepted: { label: "Aceito", tone: "ok" },
  revoked: { label: "Revogado", tone: "" },
  expired: { label: "Expirado", tone: "" },
};

/** Pending invitations with revoke (ADMIN); accepted, revoked and expired ones stay as history. */
function Invitations({ version }: { version: number }) {
  const { db, notify } = useWorkspace();
  const session = useSession();
  const [items, setItems] = useState<Invitation[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    if (!session) return;
    setError(false);
    session.admin
      .listInvitations()
      .then(setItems)
      .catch(() => setError(true));
  }, [session]);
  useEffect(() => {
    void version;
    load();
  }, [load, version]);
  if (error)
    return (
      <Empty
        icon="alert"
        title="Não foi possível carregar os convites"
        sub="O serviço de identidade não respondeu."
      >
        <button type="button" className="btn" onClick={load}>
          <Icon name="refresh" size={14} />
          Tentar novamente
        </button>
      </Empty>
    );
  if (!items)
    return (
      <div className="empty" role="status" aria-busy="true">
        <b>Carregando…</b>
      </div>
    );
  if (!items.length)
    return <Empty icon="mail" title="Nenhum convite" sub="Convide pessoas pelo botão “Convidar pessoa”." />;
  const roleName = (role: Invitation["role"]) => db.roles.find((r) => r.id === toRoleId(role))?.name ?? role;
  return (
    <div className="panel">
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>E-mail</th>
              <th>Papel de acesso</th>
              <th>Criado em</th>
              <th>Validade</th>
              <th>Situação</th>
              <th>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <b>{item.email}</b>
                  {item.title && <span className="cell-sub">{item.title}</span>}
                </td>
                <td>{roleName(item.role)}</td>
                <td>{fmtDate(item.createdAt)}</td>
                <td>{fmtDateTime(item.expiresAt)}</td>
                <td>
                  <span className={`chip ${INVITE_STATUS[item.status].tone}`}>
                    {INVITE_STATUS[item.status].label}
                  </span>
                </td>
                <td>
                  {item.status === "pending" && session && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        session.admin
                          .revokeInvitation(item.id)
                          .then(() => {
                            notify("Convite revogado", item.email, "ok");
                            load();
                          })
                          .catch(() => notify("Não foi possível revogar", item.email, "err"))
                      }
                    >
                      Revogar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Access({ tab = "users" }: { tab?: string }) {
  const { db, me, can, act } = useWorkspace();
  const session = useSession();
  const manage = can("user.manage");
  // the invitations tab exists only on the real backend, for administrators
  const tabs = session && manage ? TABS : TABS.filter((key) => key !== "invites");
  const active = tabs.includes(tab) ? tab : "users";
  const [invite, setInvite] = useState(false);
  const [invites, setInvites] = useState(0);
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
          ...(tabs.includes("invites") ? [{ key: "invites", label: "Convites" }] : []),
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
                        ) : user.active ? (
                          <span className="chip ok">Ativo</span>
                        ) : (
                          <span className="chip">Desativado</span>
                        )}
                        {session && manage && user.id !== me.id && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-label={`${user.active ? "Desativar" : "Reativar"} ${user.name}`}
                            onClick={() => void session.admin.setMemberActive(user.id, !user.active)}
                          >
                            {user.active ? "Desativar" : "Reativar"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : active === "invites" ? (
        <Invitations version={invites} />
      ) : (
        <>
          <p className="muted page-lead">
            {session
              ? "Os serviços validam estas capacidades em cada chamada — esconder o botão não é a única barreira. Líderes de equipe atuam só nos projetos das próprias equipes; desenvolvedores editam só as tarefas atribuídas a eles."
              : "As operações validam estas capacidades de fato — esconder o botão não é a única barreira. Tentativas sem permissão são registradas na auditoria."}
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
      {invite &&
        (session ? (
          <ApiInviteModal onClose={() => setInvite(false)} onCreated={() => setInvites((n) => n + 1)} />
        ) : (
          <InviteModal onClose={() => setInvite(false)} />
        ))}
    </>
  );
}
