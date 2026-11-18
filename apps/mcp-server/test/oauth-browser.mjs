/**
 * The OAuth consent page in a real browser (Chromium through Playwright), opened from another site the way
 * claude.ai or chatgpt.com open it: a top-level navigation in the same tab, or a popup. It checks that the
 * SameSite=Strict CSRF cookie set by that cross-site navigation is sent back by the form post, that the
 * organization choice works, that "Cancelar" returns access_denied, and that the browser lands on the host's
 * callback with a redeemable code.
 *
 * The "host" runs on http://localhost:<port> and the Kairos gateway on http://127.0.0.1:<port>: different sites
 * for the browser. Needs the same databases as test/oauth-e2e.mjs and Playwright's Chromium
 * (`pnpm --filter @axial/web exec playwright install chromium`).
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  claimsOf,
  MEMBER_EMAIL,
  MEMBER_PASSWORD,
  startOAuthStack,
} from "./support/oauth-stack.mjs";

// The Workspace already pins Playwright and its Chromium; this script uses the same installation.
const webDirectory = fileURLToPath(new URL("../../web/", import.meta.url));
const { chromium } = createRequire(join(webDirectory, "package.json"))("@playwright/test");

const stack = await startOAuthStack();
const callbacks = [];
const host = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/callback") {
    callbacks.push(url.searchParams);
    response.writeHead(200, { "content-type": "text/html" }).end("<h1>Connected</h1>");
    return;
  }
  const target = url.searchParams.get("authorize") ?? "";
  const popup = url.searchParams.get("popup") === "1";
  const link = popup
    ? `<button id="connect">Connect</button><script>document.getElementById("connect").onclick = () =>
        window.open(${JSON.stringify(target).replaceAll("<", "\\u003c")}, "kairos", "popup");</script>`
    : `<a id="connect" href="${target.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">Connect</a>`;
  response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>Host</title>${link}`);
});
await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
const hostOrigin = `http://localhost:${host.address().port}`;
const redirectUri = `${hostOrigin}/callback`;

let browser;
let failure;
try {
  const registered = await (
    await fetch(`${stack.issuer}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Browser host",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
      }),
    })
  ).json();
  const start = (state) => {
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: registered.client_id,
      redirect_uri: redirectUri,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      scope: "projects:read projects:write",
      state,
      resource: stack.resource,
    });
    return { verifier, url: `${stack.issuer}/oauth/authorize?${query}` };
  };
  const redeem = async (code, verifier) => {
    const response = await fetch(`${stack.issuer}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: registered.client_id,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
    });
    assert.equal(response.status, 200, "the code is redeemable");
    return response.json();
  };
  const lastCallback = (state) => {
    const params = callbacks.at(-1);
    assert.ok(params, "the browser reached the host callback");
    assert.equal(params.get("state"), state);
    assert.equal(params.get("iss"), stack.issuer);
    return params;
  };

  browser = await chromium.launch();

  // Same tab: a link on the host's site, single-organization account.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const flow = start("same-tab");
    await page.goto(`${hostOrigin}/?authorize=${encodeURIComponent(flow.url)}`);
    await page.click("#connect");
    await page.waitForURL((url) => url.href.startsWith(`${stack.issuer}/oauth/authorize`));
    const [csrf] = await context.cookies(`${stack.issuer}/oauth/authorize`);
    assert.equal(csrf?.name, "kairos_oauth_csrf", "the cross-site navigation stored the CSRF cookie");
    assert.equal(csrf.sameSite, "Strict");
    assert.equal(csrf.httpOnly, true);
    await page.fill("#email", MEMBER_EMAIL);
    await page.fill("#password", MEMBER_PASSWORD);
    await page.click('button[value="allow"]');
    await page.waitForURL((url) => url.href.startsWith(redirectUri));
    const params = lastCallback("same-tab");
    const tokens = await redeem(params.get("code"), flow.verifier);
    assert.equal(claimsOf(tokens.access_token).organizationId, stack.alpha);
    await context.close();
  }

  // Popup, as claude.ai opens it: the account belongs to two organizations and picks the second.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const flow = start("popup");
    await page.goto(`${hostOrigin}/?popup=1&authorize=${encodeURIComponent(flow.url)}`);
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.click("#connect")]);
    await popup.waitForLoadState();
    await popup.fill("#email", ADMIN_EMAIL);
    await popup.fill("#password", ADMIN_PASSWORD);
    await popup.click('button[value="allow"]');
    await popup.waitForSelector('input[name="organizationId"]');
    assert.match(await popup.content(), /Escolha a organização/);
    await popup.check(`input[name="organizationId"][value="${stack.beta}"]`);
    await popup.click('button[value="allow"]');
    await popup.waitForURL((url) => url.href.startsWith(redirectUri));
    const params = lastCallback("popup");
    const tokens = await redeem(params.get("code"), flow.verifier);
    assert.equal(claimsOf(tokens.access_token).organizationId, stack.beta);
    await context.close();
  }

  // Cancel returns access_denied to the host.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const flow = start("cancel");
    await page.goto(`${hostOrigin}/?authorize=${encodeURIComponent(flow.url)}`);
    await page.click("#connect");
    await page.click('button[value="deny"]');
    await page.waitForURL((url) => url.href.startsWith(redirectUri));
    assert.equal(lastCallback("cancel").get("error"), "access_denied");
    await context.close();
  }

  console.log(
    "OAuth browser test passed: cross-site navigation and popup, SameSite=Strict CSRF cookie, login, organization choice, cancel and redirect back to the host",
  );
} catch (error) {
  failure = error;
} finally {
  await browser?.close();
  await new Promise((resolve) => host.close(resolve));
  await stack.close();
}
if (failure) throw failure;
