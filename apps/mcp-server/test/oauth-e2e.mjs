/**
 * OAuth end to end with the official MCP client SDK (`@modelcontextprotocol/client`) as a real remote client,
 * against real ms-identity, ms-projects, mcp-server and gateway processes (test/support/oauth-stack.mjs):
 *
 * 1. discovery: 401 with resource_metadata → protected resource metadata → authorization server metadata;
 * 2. dynamic registration, authorize (login form, organization choice), token, initialize, tools/list (full
 *    catalog), read tools (ms-projects and the ms-identity directory), refresh, a new call with the new token;
 * 3. a client that asks only for projects:read: reads work, a write is refused before reaching ms-projects;
 * 4. the consent form as browsers send it: CSRF cookie attributes, cross-site form posts refused, no session left
 *    behind, redirects back to claude.ai, chatgpt.com, cursor:// and localhost with code, state and iss.
 *
 * The browser itself (SameSite cookie on a cross-site navigation) is covered by test/oauth-browser.mjs.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  Client,
  InsufficientScopeError,
  StreamableHTTPClientTransport,
  auth as sdkAuth,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  claimsOf,
  hiddenFields,
  MEMBER_EMAIL,
  MEMBER_PASSWORD,
  startOAuthStack,
} from "./support/oauth-stack.mjs";

const CATALOG_SIZE = 49;
const stack = await startOAuthStack();
const clients = [];
let failure;

/**
 * An OAuth client provider kept in memory, the way an MCP host stores registration and tokens. Its "browser"
 * opens the consent page, signs in and, for accounts in several organizations, picks `organizationId`.
 */
function provider({
  name,
  email,
  password,
  organizationId,
  redirectUrl = "http://127.0.0.1:47777/callback",
}) {
  const state = { authorizations: [], callback: undefined };
  let client;
  let tokens;
  let verifier;
  let discovery;
  state.provider = {
    get redirectUrl() {
      return redirectUrl;
    },
    get clientMetadata() {
      return {
        client_name: name,
        redirect_uris: [redirectUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      };
    },
    clientInformation: () => client,
    saveClientInformation: (information) => {
      client = information;
    },
    tokens: () => tokens,
    saveTokens: (saved) => {
      tokens = saved;
    },
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    codeVerifier: () => verifier,
    saveDiscoveryState: (value) => {
      discovery = value;
    },
    discoveryState: () => discovery,
    redirectToAuthorization: async (authorizationUrl) => {
      state.authorizations.push(authorizationUrl);
      if (state.stopAtAuthorization) return;
      const page = await fetch(authorizationUrl, { redirect: "manual" });
      assert.equal(page.status, 200, "consent page");
      const cookie = page.headers.get("set-cookie")?.split(";")[0];
      const submit = (fields) =>
        fetch(new URL("authorize", authorizationUrl), {
          method: "POST",
          redirect: "manual",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie,
            "sec-fetch-site": "same-origin",
          },
          body: new URLSearchParams(fields).toString(),
        });
      let response = await submit({ ...hiddenFields(await page.text()), email, password, decision: "allow" });
      if (response.status === 200) {
        const choice = await response.text();
        assert.match(choice, /Escolha a organização/);
        state.organizationChoice = true;
        response = await submit({ ...hiddenFields(choice), organizationId, decision: "allow" });
      }
      assert.equal(response.status, 303, `authorize answered ${response.status}`);
      state.callback = new URL(response.headers.get("location"));
    },
  };
  state.tokens = () => tokens;
  state.client = () => client;
  return state;
}

async function connect(state) {
  const transport = new StreamableHTTPClientTransport(new URL(stack.resource), {
    authProvider: state.provider,
  });
  const mcp = new Client({ name: "kairos-oauth-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  clients.push(mcp);
  return mcp;
}

/** First connection: the SDK discovers, registers and sends the "browser" to log in; then the code is redeemed. */
async function signIn(state) {
  const transport = new StreamableHTTPClientTransport(new URL(stack.resource), {
    authProvider: state.provider,
  });
  const first = new Client({ name: "kairos-oauth-e2e", version: "1.0.0" });
  await assert.rejects(first.connect(transport), UnauthorizedError);
  assert.ok(state.callback, "the SDK went through the consent page");
  assert.equal(state.callback.searchParams.get("iss"), stack.issuer, "RFC 9207 iss on the callback");
  await transport.finishAuth(state.callback.searchParams.get("code"), state.callback.searchParams.get("iss"));
  return connect(state);
}

const text = (result) => result.content?.find((block) => block.type === "text")?.text ?? "";
const call = async (mcp, name, args = {}) => {
  const result = await mcp.callTool({ name, arguments: args });
  assert.ok(!result.isError, `${name} failed: ${text(result)}`);
  return result.structuredContent ?? JSON.parse(text(result));
};

try {
  // 1. Discovery as a client sees it, through the gateway.
  const challenge = await fetch(stack.resource, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(challenge.status, 401);
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(
    challenge.headers.get("www-authenticate") ?? "",
  )?.[1];
  assert.equal(metadataUrl, `${stack.gateway}/.well-known/oauth-protected-resource/mcp`);
  const protectedResource = await (await fetch(metadataUrl)).json();
  assert.equal(protectedResource.resource, stack.resource);
  assert.deepEqual(protectedResource.authorization_servers, [stack.issuer]);
  assert.deepEqual(protectedResource.scopes_supported, ["projects:read", "projects:write"]);
  const server = await (
    await fetch(`${stack.gateway}/.well-known/oauth-authorization-server/identity`)
  ).json();
  assert.equal(server.issuer, stack.issuer);
  assert.equal(server.registration_endpoint, `${stack.issuer}/oauth/register`);
  assert.deepEqual(server.code_challenge_methods_supported, ["S256"]);

  // 2. Full flow for the administrator, who belongs to two organizations and picks the second.
  const sessionsBefore = (await stack.db.query("SELECT count(*)::int AS n FROM identity.session")).rows[0].n;
  const adminFlow = provider({
    name: "Kairos OAuth E2E",
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    organizationId: stack.beta,
  });
  const admin = await signIn(adminFlow);
  assert.ok(adminFlow.client()?.client_id, "dynamic registration");
  assert.equal(adminFlow.organizationChoice, true, "the account chose among its organizations");
  const firstTokens = adminFlow.tokens();
  assert.equal(firstTokens.scope, "projects:read projects:write");
  assert.ok(firstTokens.refresh_token);
  const claims = claimsOf(firstTokens.access_token);
  assert.equal(claims.organizationId, stack.beta);
  assert.equal(claims.source, "mcp");
  assert.deepEqual(claims.aud, ["axial-projects", stack.resource]);
  assert.equal(admin.getServerVersion()?.name, "axial-projects");
  const { tools } = await admin.listTools();
  assert.equal(tools.length, CATALOG_SIZE, "the full catalog for a read+write token");
  const me = JSON.parse((await admin.readResource({ uri: "axial://me" })).contents[0].text);
  assert.equal(me.organizationId, stack.beta);
  assert.equal(me.clientId, adminFlow.client().client_id);
  assert.deepEqual(me.scopes, ["projects:read", "projects:write"]);
  const project = await call(admin, "create-project", { key: "OAUTH", name: "OAuth E2E", color: "#3b82f6" });
  assert.equal((await call(admin, "list-projects")).total, 1);
  const members = await call(admin, "list-members");
  assert.ok(
    members.some((row) => row.email === ADMIN_EMAIL),
    "the directory answers a delegated token through the MCP",
  );
  assert.equal(
    (await stack.db.query("SELECT count(*)::int AS n FROM identity.session")).rows[0].n,
    sessionsBefore,
    "the OAuth login leaves no browser session behind",
  );

  // Refresh: the SDK rotates the refresh token; the new access token keeps working.
  await admin.close();
  assert.equal(await sdkAuth(adminFlow.provider, { serverUrl: stack.resource }), "AUTHORIZED");
  const refreshed = adminFlow.tokens();
  assert.notEqual(refreshed.access_token, firstTokens.access_token);
  assert.notEqual(refreshed.refresh_token, firstTokens.refresh_token, "refresh token rotation");
  assert.equal(claimsOf(refreshed.access_token).organizationId, stack.beta, "refresh keeps the organization");
  const again = await connect(adminFlow);
  assert.equal((await call(again, "get-project", { projectId: project.id })).key, "OAUTH");

  // 3. A client that asks only for projects:read (single organization account).
  const readFlow = provider({ name: "Read only", email: MEMBER_EMAIL, password: MEMBER_PASSWORD });
  const readTransport = new StreamableHTTPClientTransport(new URL(stack.resource), {
    authProvider: readFlow.provider,
  });
  assert.equal(
    await sdkAuth(readFlow.provider, { serverUrl: stack.resource, scope: "projects:read" }),
    "REDIRECT",
  );
  assert.equal(readFlow.organizationChoice, undefined, "one organization: no choice");
  await readTransport.finishAuth(
    readFlow.callback.searchParams.get("code"),
    readFlow.callback.searchParams.get("iss"),
  );
  assert.equal(readFlow.tokens().scope, "projects:read");
  assert.equal(claimsOf(readFlow.tokens().access_token).organizationId, stack.alpha);
  const reader = await connect(readFlow);
  assert.equal((await reader.listTools()).tools.length, CATALOG_SIZE, "listing is not scope-filtered");
  assert.equal((await call(reader, "list-projects")).total, 0, "alpha has no projects yet");
  // The write is refused with insufficient_scope; the SDK then asks for the wider scope (step-up), which this
  // client does not complete.
  readFlow.stopAtAuthorization = true;
  const refused = await reader
    .callTool({ name: "create-project", arguments: { key: "NOPE", name: "Must not exist" } })
    .then(
      () => undefined,
      (error) => error,
    );
  assert.ok(
    refused instanceof InsufficientScopeError || refused instanceof UnauthorizedError,
    `write refused, got ${refused}`,
  );
  const stepUp = readFlow.authorizations.at(-1);
  assert.equal(stepUp?.searchParams.get("scope"), "projects:read projects:write", "step-up asks for write");
  const alphaToken = (
    await (
      await fetch(`${stack.gateway}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, organizationId: stack.alpha }),
      })
    ).json()
  ).accessToken;
  const alphaProjects = await (
    await fetch(`${stack.gateway}/api/v1/projects`, { headers: { authorization: `Bearer ${alphaToken}` } })
  ).json();
  assert.equal(alphaProjects.total, 0, "nothing reached ms-projects");

  // 4. The consent form as browsers send it, for the redirect targets of real MCP hosts.
  // (The password login above opened a Workspace session of its own; count from here.)
  const sessionsBeforeConsent = (await stack.db.query("SELECT count(*)::int AS n FROM identity.session"))
    .rows[0].n;
  const targets = [
    "https://claude.ai/api/mcp/auth_callback",
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "cursor://anysphere.cursor-mcp/oauth/callback",
    "http://localhost:33418/callback",
  ];
  const registered = await (
    await fetch(`${stack.issuer}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Hosts",
        redirect_uris: targets,
        token_endpoint_auth_method: "none",
      }),
    })
  ).json();
  assert.deepEqual(registered.redirect_uris, targets);
  const verifierValue = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(verifierValue).digest("base64url");
  const consent = async (redirectUri, origin) => {
    const query = new URLSearchParams({
      response_type: "code",
      client_id: registered.client_id,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      scope: "projects:read projects:write",
      state: "opaque-state",
      resource: stack.resource,
    });
    // A top-level navigation started on the host's site.
    const page = await fetch(`${stack.issuer}/oauth/authorize?${query}`, {
      redirect: "manual",
      headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", referer: origin },
    });
    assert.equal(page.status, 200, redirectUri);
    return { page, fields: hiddenFields(await page.text()) };
  };
  const post = (fields, headers) =>
    fetch(`${stack.issuer}/oauth/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams({
        ...fields,
        email: MEMBER_EMAIL,
        password: MEMBER_PASSWORD,
        decision: "allow",
      }),
    });

  const { page, fields } = await consent(targets[0], "https://claude.ai/");
  const setCookie = page.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /^kairos_oauth_csrf=[A-Za-z0-9_-]{43};/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\/identity\/oauth/i);
  assert.doesNotMatch(page.headers.get("content-security-policy") ?? "", /form-action/);
  const cookie = setCookie.split(";")[0];
  for (const [label, headers] of [
    ["no cookie", { "sec-fetch-site": "same-origin" }],
    ["another site's form", { cookie, "sec-fetch-site": "cross-site" }],
    ["same-site subdomain form", { cookie, "sec-fetch-site": "same-site" }],
    [
      "wrong token",
      {
        cookie: "kairos_oauth_csrf=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "sec-fetch-site": "same-origin",
      },
    ],
  ]) {
    const response = await post(fields, headers);
    assert.equal(response.status, 403, `CSRF: ${label}`);
    assert.match(await response.text(), /Formulário expirado/);
  }
  for (const [index, target] of targets.entries()) {
    const step = index === 0 ? { page, fields } : await consent(target, "https://example.test/");
    const response = await post(step.fields, {
      cookie: step.page.headers.get("set-cookie").split(";")[0],
      "sec-fetch-site": "same-origin",
      origin: stack.gateway,
    });
    assert.equal(response.status, 303, target);
    assert.equal(response.headers.get("set-cookie"), null, "the login sets no session cookie");
    const location = new URL(response.headers.get("location"));
    assert.equal(`${location.protocol}//${location.host}${location.pathname}`, target);
    assert.equal(location.searchParams.get("state"), "opaque-state");
    assert.equal(location.searchParams.get("iss"), stack.issuer);
    const exchanged = await fetch(`${stack.issuer}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: registered.client_id,
        code: location.searchParams.get("code"),
        code_verifier: verifierValue,
        redirect_uri: target,
        resource: stack.resource,
      }),
    });
    assert.equal(exchanged.status, 200, `code for ${target} is redeemable`);
  }
  assert.equal(
    (await stack.db.query("SELECT count(*)::int AS n FROM identity.session")).rows[0].n,
    sessionsBeforeConsent,
    "no browser session left by any OAuth login",
  );

  console.log(
    "OAuth E2E passed: SDK discovery, registration, login with organization choice, token, initialize, full catalog, reads, refresh rotation, read-only scope refusal with step-up, CSRF and redirects to claude.ai, chatgpt.com, cursor:// and localhost",
  );
} catch (error) {
  failure = error;
} finally {
  await Promise.allSettled(clients.map((client) => client.close()));
  await stack.close();
}
if (failure) throw failure;
