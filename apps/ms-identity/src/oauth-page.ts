import type { OAuthScope } from "./oauth.js";

/**
 * Server-rendered login and consent page of the OAuth authorization endpoint.
 * Self-contained (no external assets), in Portuguese, with the Workspace palette.
 */

const scopeLabels: Record<OAuthScope, string> = {
  "projects:read": "Ver os projetos, tarefas e sprints a que você tem acesso",
  "projects:write": "Criar tarefas e mudar o status de tarefas em seu nome",
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const styles = `
:root{color-scheme:light dark;
--bg:#F2F4F7;--surface:#FFFFFF;--ink:#1C2127;--ink-2:#4E5866;--border:#D8DEE6;--ctl:#7D8794;
--accent:#2B5FD9;--accent-hover:#2453C7;--accent-ink:#FFFFFF;--accent-bg:#E8EEFC;
--danger:#B92D2D;--danger-bg:#FBE9E7;--danger-border:#EDB5AF}
@media (prefers-color-scheme:dark){:root{
--bg:#0E1116;--surface:#161A21;--ink:#E6E8EB;--ink-2:#AEB5BF;--border:#262B33;--ctl:#687180;
--accent:#7FA0F4;--accent-hover:#93B0F6;--accent-ink:#0E1116;--accent-bg:#1D2738;
--danger:#EC8279;--danger-bg:#331B19;--danger-border:#6A3430}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--ink);
font:14px/20px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:400px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:28px}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:16px;margin-bottom:20px}
h1{font-size:19px;line-height:28px;margin:0 0 8px}
p{margin:0 0 12px;color:var(--ink-2)}
strong{color:var(--ink)}
ul{margin:0 0 20px;padding:12px 12px 12px 32px;background:var(--accent-bg);border-radius:8px}
li+li{margin-top:6px}
label{display:block;font-weight:500;margin:0 0 6px}
input[type=email],input[type=password]{width:100%;height:40px;padding:0 12px;margin:0 0 14px;border:1px solid var(--ctl);
border-radius:8px;background:var(--surface);color:var(--ink);font:inherit}
fieldset{border:0;margin:0 0 16px;padding:0}
legend{font-weight:500;margin-bottom:8px;padding:0}
.option{display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;font-weight:400}
.actions{display:flex;gap:8px;margin-top:4px}
button{flex:1;height:40px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--ctl);
background:var(--surface);color:var(--ink)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
button.primary:hover{background:var(--accent-hover)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.alert{border:1px solid var(--danger-border);background:var(--danger-bg);color:var(--danger);border-radius:8px;padding:10px 12px;margin:0 0 16px}
.note{font-size:12px;line-height:16px;margin-top:16px}
`;

const logo =
  '<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#2B5FD9"/>' +
  '<path d="M10.5 7v18M22.5 7 11.5 16.5 22.5 25" fill="none" stroke="white" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${styles}</style>
</head>
<body>
<main>
<div class="brand">${logo}<span>Kairos</span></div>
${body}
</main>
</body>
</html>`;
}

export interface AuthorizePageModel {
  clientName: string;
  redirectHost: string;
  scopes: OAuthScope[];
  /** Authorization request parameters and the CSRF token, posted back with the form. */
  hidden: Record<string, string>;
  email?: string;
  error?: string;
  /** Second step for accounts in several organizations. */
  organizations?: { id: string; name: string }[];
  ticket?: string;
}

function hiddenFields(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("\n");
}

export function renderAuthorizePage(model: AuthorizePageModel): string {
  const client = escapeHtml(model.clientName);
  const scopes = model.scopes.map((scope) => `<li>${escapeHtml(scopeLabels[scope])}</li>`).join("");
  const error = model.error ? `<p class="alert" role="alert">${escapeHtml(model.error)}</p>` : "";
  const credentials = model.organizations
    ? `<fieldset><legend>Escolha a organização</legend>
${model.organizations
  .map(
    (organization, index) =>
      `<label class="option"><input type="radio" name="organizationId" value="${escapeHtml(organization.id)}"${
        index === 0 ? " checked" : ""
      } required> ${escapeHtml(organization.name)}</label>`,
  )
  .join("\n")}
</fieldset>
<input type="hidden" name="ticket" value="${escapeHtml(model.ticket ?? "")}">`
    : `<label for="email">E-mail</label>
<input id="email" name="email" type="email" autocomplete="username" required maxlength="254" value="${escapeHtml(
        model.email ?? "",
      )}"${model.email ? "" : " autofocus"}>
<label for="password">Senha</label>
<input id="password" name="password" type="password" autocomplete="current-password" required maxlength="128"${
        model.email ? " autofocus" : ""
      }>`;
  return layout(
    "Conectar ao Kairos",
    `<h1>Conectar ${client} ao Kairos</h1>
<p><strong>${client}</strong> está pedindo acesso à sua conta. Ao permitir, ele poderá:</p>
<ul>${scopes}</ul>
${error}
<form method="post" action="authorize">
${hiddenFields(model.hidden)}
${credentials}
<div class="actions">
<button type="submit" name="decision" value="allow" class="primary">Permitir acesso</button>
<button type="submit" name="decision" value="deny" formnovalidate>Cancelar</button>
</div>
</form>
<p class="note">O nome do app é informado pelo próprio app. Depois de permitir, você volta para <strong>${escapeHtml(
      model.redirectHost,
    )}</strong>. Só permita se você iniciou esta conexão.</p>`,
  );
}

export function renderErrorPage(title: string, message: string): string {
  return layout(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`);
}
