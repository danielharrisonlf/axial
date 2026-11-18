import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Field } from "../components/ui";
import type { AuthSession, InvitationPreview, OrganizationChoice } from "../data/api/auth";
import { ApiError } from "../data/api/http";
import { toRoleId } from "../data/api/mappers";
import { ROLE_LABEL } from "../lib/format";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** Message of a failed authentication call, in the interface language. */
export function authError(
  error: unknown,
  context: "login" | "signup" | "invite" | "accept" | "password",
): string {
  if (error instanceof ApiError) {
    if (error.status === 0 || error.status >= 500)
      return "Serviço indisponível. Tente novamente em instantes.";
    if (error.status === 429) return "Muitas tentativas. Aguarde um minuto e tente de novo.";
    if (error.status === 401)
      return context === "password"
        ? "Senha atual incorreta."
        : context === "accept"
          ? "Senha incorreta para esta conta."
          : "E-mail ou senha incorretos.";
    if (error.status === 404)
      return context === "signup"
        ? "O cadastro de empresas está desativado neste ambiente."
        : "Convite inválido, expirado ou já usado.";
    if (error.status === 409)
      return context === "signup"
        ? "Não foi possível concluir o cadastro. Se o e-mail já tem conta, use a senha dela."
        : "Este convite não pode mais ser aceito.";
    if (error.status === 400)
      return context === "password" && /differ/i.test(error.message)
        ? "A nova senha precisa ser diferente da atual."
        : "Revise os dados informados.";
  }
  return error instanceof Error ? error.message : "Não foi possível concluir.";
}

const passwordError = (value: string) =>
  value.length < PASSWORD_MIN
    ? `Use pelo menos ${PASSWORD_MIN} caracteres`
    : value.length > PASSWORD_MAX
      ? `Use no máximo ${PASSWORD_MAX} caracteres`
      : "";

/** Centered column with the brand above a prototype panel. */
export function AuthLayout({
  title,
  children,
  foot,
}: {
  title: string;
  children: ReactNode;
  foot?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · Kairos`;
  }, [title]);
  return (
    <main className="auth">
      <div className="auth-col">
        <div className="auth-brand">
          <span className="sb-logo" aria-hidden="true">
            <Icon name="logo" size={18} />
          </span>
          <span className="auth-brand-txt">
            <b>Kairos</b>
            <span>Workspace</span>
          </span>
        </div>
        <section className="panel" aria-labelledby="auth-title">
          <div className="panel-head">
            <h1 id="auth-title">{title}</h1>
          </div>
          <div className="panel-body">{children}</div>
        </section>
        {foot}
      </div>
    </main>
  );
}

function Notice({ tone = "danger", children }: { tone?: "danger" | "info" | "warn"; children: ReactNode }) {
  return (
    <div className={`banner ${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={tone === "danger" ? "alert" : "info"} size={16} />
      <span>{children}</span>
    </div>
  );
}

/** Submit handler with busy state and the first invalid field focused after a failed attempt. */
function useSubmit() {
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (attempt) form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [attempt]);
  const run = (valid: boolean, work: () => Promise<void>, onError: (e: unknown) => string) => {
    if (!valid) {
      setAttempt((n) => n + 1);
      return;
    }
    setBusy(true);
    setError("");
    work()
      .catch((e: unknown) => setError(onError(e)))
      .finally(() => setBusy(false));
  };
  return { form, busy, error, run };
}
const prevent = (handler: () => void) => (event: FormEvent) => {
  event.preventDefault();
  handler();
};

export function LoginScreen({
  auth,
  notice,
  onSignup,
}: {
  auth: AuthSession;
  notice: string | null;
  onSignup: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const { form, busy, error, run } = useSubmit();
  const submit = () => {
    const next = {
      email: EMAIL_RE.test(email.trim()) ? undefined : "Informe um e-mail válido",
      password: password ? undefined : "Informe a senha",
    };
    setErrors(next);
    run(
      !next.email && !next.password,
      () => auth.login(email.trim().toLowerCase(), password),
      (e) => authError(e, "login"),
    );
  };
  return (
    <AuthLayout
      title="Entrar"
      foot={
        <p className="auth-alt">
          Sua empresa ainda não usa o Kairos?
          <button type="button" onClick={onSignup}>
            Criar conta
          </button>
        </p>
      }
    >
      <form ref={form} noValidate onSubmit={prevent(submit)}>
        {notice && <Notice tone="info">{notice}</Notice>}
        {error && <Notice>{error}</Notice>}
        <Field label="E-mail" required error={errors.email}>
          <input
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Senha" required error={errors.password}>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </AuthLayout>
  );
}

export function SignupScreen({ auth, onLogin }: { auth: AuthSession; onLogin: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganization] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { form, busy, error, run } = useSubmit();
  const submit = () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Informe seu nome";
    if (!EMAIL_RE.test(email.trim())) next.email = "Informe um e-mail válido";
    const pw = passwordError(password);
    if (pw) next.password = pw;
    if (!organizationName.trim()) next.organization = "Informe o nome da empresa";
    setErrors(next);
    run(
      !Object.keys(next).length,
      () =>
        auth.signup({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          organizationName: organizationName.trim(),
        }),
      (e) => authError(e, "signup"),
    );
  };
  return (
    <AuthLayout
      title="Criar conta"
      foot={
        <p className="auth-alt">
          Já tem conta?
          <button type="button" onClick={onLogin}>
            Entrar
          </button>
        </p>
      }
    >
      <form ref={form} noValidate onSubmit={prevent(submit)}>
        <p>Cria a sua conta e uma empresa nova, da qual você será administrador.</p>
        {error && <Notice>{error}</Notice>}
        <Field label="Nome" required error={errors.name}>
          <input
            className="input"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="E-mail" required error={errors.email}>
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field
          label="Senha"
          required
          error={errors.password}
          hint={`De ${PASSWORD_MIN} a ${PASSWORD_MAX} caracteres`}
        >
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Empresa" required error={errors.organization}>
          <input
            className="input"
            autoComplete="organization"
            value={organizationName}
            onChange={(e) => setOrganization(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Criando…" : "Criar conta e empresa"}
        </button>
      </form>
    </AuthLayout>
  );
}

export function OrganizationPicker({
  auth,
  organizations,
}: {
  auth: AuthSession;
  organizations: OrganizationChoice[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const choose = (id: string) => {
    setBusy(id);
    setError("");
    auth
      .chooseOrganization(id)
      .catch((e: unknown) => setError(authError(e, "login")))
      .finally(() => setBusy(null));
  };
  return (
    <AuthLayout
      title="Escolha a empresa"
      foot={
        <p className="auth-alt">
          <button type="button" onClick={() => void auth.logout()}>
            Entrar com outra conta
          </button>
        </p>
      }
    >
      <p>Sua conta participa de mais de uma empresa. Você poderá trocar depois, no menu do seu perfil.</p>
      {error && <Notice>{error}</Notice>}
      <div className="auth-orgs">
        {organizations.map((org) => (
          <button
            key={org.id}
            type="button"
            className="auth-org"
            disabled={busy !== null}
            aria-busy={busy === org.id}
            onClick={() => choose(org.id)}
          >
            <span className="sb-logo" aria-hidden="true">
              <Icon name="building" size={16} />
            </span>
            <span className="grow">
              <b>{org.name}</b>
              <span>{ROLE_LABEL[toRoleId(org.role)]}</span>
            </span>
            <Icon name="chevR" size={14} />
          </button>
        ))}
      </div>
    </AuthLayout>
  );
}

export function PasswordChangeScreen({ auth, email }: { auth: AuthSession; email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { form, busy, error, run } = useSubmit();
  const submit = () => {
    const found: Record<string, string> = {};
    if (!current) found.current = "Informe a senha atual";
    const pw = passwordError(next);
    if (pw) found.next = pw;
    else if (next === current) found.next = "A nova senha precisa ser diferente da atual";
    if (confirm !== next) found.confirm = "As senhas não conferem";
    setErrors(found);
    run(
      !Object.keys(found).length,
      () => auth.changePassword(current, next),
      (e) => authError(e, "password"),
    );
  };
  return (
    <AuthLayout title="Defina sua senha">
      <form ref={form} noValidate onSubmit={prevent(submit)}>
        <p>
          A conta <b>{email}</b> usa uma senha provisória. Escolha uma senha só sua para continuar.
        </p>
        {error && <Notice>{error}</Notice>}
        <Field label="Senha atual" required error={errors.current}>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field
          label="Nova senha"
          required
          error={errors.next}
          hint={`De ${PASSWORD_MIN} a ${PASSWORD_MAX} caracteres`}
        >
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="Confirme a nova senha" required error={errors.confirm}>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Salvando…" : "Salvar e entrar"}
        </button>
      </form>
    </AuthLayout>
  );
}

/** `#/convite/<token>`: shows company and role; new accounts choose name and password, existing ones confirm theirs. */
export function InvitationScreen({
  auth,
  token,
  onDone,
}: {
  auth: AuthSession;
  token: string;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { form, busy, error, run } = useSubmit();
  useEffect(() => {
    let cancelled = false;
    auth
      .previewInvitation(token)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(authError(e, "invite"));
      });
    return () => {
      cancelled = true;
    };
  }, [auth, token]);
  if (loadError)
    return (
      <AuthLayout title="Convite">
        <Notice>{loadError}</Notice>
        <p className="auth-alt">
          <button type="button" onClick={onDone}>
            Ir para a entrada
          </button>
        </p>
      </AuthLayout>
    );
  if (!preview)
    return (
      <AuthLayout title="Convite">
        <div className="empty inline" role="status" aria-busy="true">
          <b>Carregando o convite…</b>
        </div>
      </AuthLayout>
    );
  const existing = preview.existingAccount;
  const submit = () => {
    const found: Record<string, string> = {};
    if (!existing && !name.trim()) found.name = "Informe seu nome";
    if (existing ? !password : passwordError(password))
      found.password = existing ? "Informe a sua senha" : passwordError(password);
    setErrors(found);
    run(
      !Object.keys(found).length,
      async () => {
        await auth.acceptInvitation(
          token,
          existing ? { password } : { name: name.trim(), password },
          preview.email,
        );
        onDone();
      },
      (e) => authError(e, "accept"),
    );
  };
  return (
    <AuthLayout title={`Convite para ${preview.organizationName}`}>
      <form ref={form} noValidate onSubmit={prevent(submit)}>
        <p>
          <b>{preview.email}</b> foi convidado(a) como <b>{ROLE_LABEL[toRoleId(preview.role)]}</b>.{" "}
          {existing
            ? "Você já tem conta no Kairos: confirme sua senha para entrar na empresa."
            : "Escolha seu nome e uma senha para criar a conta."}
        </p>
        {error && <Notice>{error}</Notice>}
        {!existing && (
          <Field label="Nome" required error={errors.name}>
            <input
              className="input"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        )}
        <Field
          label={existing ? "Sua senha" : "Senha"}
          required
          error={errors.password}
          hint={existing ? undefined : `De ${PASSWORD_MIN} a ${PASSWORD_MAX} caracteres`}
        >
          <input
            className="input"
            type="password"
            autoComplete={existing ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Entrando…" : "Aceitar convite"}
        </button>
      </form>
    </AuthLayout>
  );
}

export function AuthLoading({ label = "Carregando…" }: { label?: string }) {
  return (
    <main className="auth">
      <div className="empty" role="status" aria-busy="true">
        <b>{label}</b>
      </div>
    </main>
  );
}

/** No demo data after a failure: the person sees that the service is down and can retry. */
export function ServiceUnavailable({ detail, onRetry }: { detail?: string; onRetry: () => void }) {
  return (
    <AuthLayout title="Serviço indisponível">
      <Notice>
        Não foi possível carregar o Workspace{detail ? `: ${detail}` : "."} Nenhum dado de demonstração é
        mostrado no lugar.
      </Notice>
      <p />
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        <Icon name="refresh" size={14} />
        Tentar novamente
      </button>
    </AuthLayout>
  );
}
