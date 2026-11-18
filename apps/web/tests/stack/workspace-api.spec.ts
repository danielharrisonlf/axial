import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";

// Workspace in API mode against `node tests/stack/stack.mjs up` (Vetor Labs scenario in a *_test
// database). Every assertion reads data back from the services: nothing comes from localStorage.

const PASSWORD = process.env.AXIAL_DEMO_PASSWORD ?? "vetor-labs-local-only";
const SHOTS = "../../output/validation/stack/screens";
const PCL = "Portal do Cliente 2.0 (PCL)";
const stamp = Date.now().toString(36);
const RICARDO = "ricardo.nogueira@vetorlabs.dev";
const HELENA = "helena.costa@vetorlabs.dev";
const CAMILA = "camila.freitas@vetorlabs.dev";
const MARINA = "marina.duarte@vetorlabs.dev";

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  if (email === RICARDO) await page.screenshot({ path: `${SHOTS}/login.png` });
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}
async function openBoard(page: Page, project = PCL) {
  await page.goto("/#/board");
  await page.getByLabel("Projeto atual").selectOption({ label: project });
}
async function fresh(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}
/** Access token straight from the identity service (what an MCP/API client would hold). */
async function apiToken(request: APIRequestContext, email: string) {
  const response = await request.post("/api/v1/auth/login", { data: { email, password: PASSWORD } });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { accessToken: string };
  return body.accessToken;
}

test("Ricardo (one company) logs in, sees API data and creates a task in PCL", async ({ page }) => {
  await login(page, RICARDO);
  await expect(page.getByRole("heading", { level: 1, name: /Ricardo/ })).toBeVisible();
  await expect(page.locator(".profile-btn")).toContainText("Ricardo Nogueira");
  await page.screenshot({ path: `${SHOTS}/dashboard-api.png`, fullPage: true });
  // nothing of the business data lives in the browser
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.filter((key) => !/^kairos\.(organization|theme|favorites|project)/.test(key))).toEqual([]);

  await openBoard(page);
  await page.getByRole("button", { name: "Nova tarefa" }).first().click();
  await page.getByLabel("Título").fill(`Stack ${stamp} criada pelo Ricardo`);
  await page.getByRole("button", { name: "Criar tarefa" }).click();
  await expect(page.locator(".kcard", { hasText: `Stack ${stamp} criada pelo Ricardo` })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/kanban-api.png` });
  // after a reload the task still comes from the API
  await page.reload();
  await openBoard(page);
  await expect(page.locator(".kcard", { hasText: `Stack ${stamp} criada pelo Ricardo` })).toBeVisible();
});

test("the MCP page teaches how to connect with the configured server URL", async ({ page, baseURL }) => {
  await login(page, RICARDO);
  await expect(page.locator(".profile-btn")).toContainText("Ricardo Nogueira");
  await page.goto("/#/mcp/connect");
  // this build has VITE_API_BASE_URL empty: the gateway is the page's own origin (preview proxy)
  await expect(page.locator("pre.code").first()).toHaveText(`${new URL(baseURL ?? "").origin}/mcp`);
  await page.screenshot({ path: `${SHOTS}/mcp-connect-api.png`, fullPage: true });
});

test("another member of PCL (Camila) sees the task Ricardo created", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  await login(page, CAMILA);
  await openBoard(page);
  await expect(page.locator(".kcard", { hasText: `Stack ${stamp} criada pelo Ricardo` })).toBeVisible();
  await context.close();
});

test("a task created through MCP appears for Ricardo, live and after reload", async ({ page, request }) => {
  await login(page, RICARDO);
  await openBoard(page);
  const token = await apiToken(request, MARINA);
  const projects = await request.get("/api/v1/projects?search=PCL", {
    headers: { authorization: `Bearer ${token}` },
  });
  const pcl = ((await projects.json()) as { items: { id: string; key: string }[] }).items.find(
    (item) => item.key === "PCL",
  );
  expect(pcl).toBeTruthy();
  const title = `Stack ${stamp} criada via MCP`;
  const call = await request.post("/mcp", {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "create-task", arguments: { projectId: pcl?.id, title, status: "todo" } },
    },
  });
  expect(call.ok()).toBeTruthy();
  // realtime: the open board picks the task up without a reload
  await expect(page.locator(".kcard", { hasText: title })).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await openBoard(page);
  await expect(page.locator(".kcard", { hasText: title })).toBeVisible();
});

test("Helena (two companies) picks the organization and can switch it", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  await login(page, HELENA);
  await expect(page.getByRole("heading", { name: "Escolha a empresa" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/org-picker.png` });
  await page.getByRole("button", { name: /Vetor Labs/ }).click();
  await expect(page.locator(".profile-btn")).toContainText("Vetor Labs");
  await page.locator(".profile-btn").click();
  await page.getByRole("menuitemradio", { name: /Atlas/ }).click();
  await expect(page.locator(".profile-btn")).toContainText("Atlas");
  await page.goto("/#/projects");
  await expect(page.getByText("Diagnóstico Industrial Andrade").first()).toBeVisible();
  await expect(page.getByText("Portal do Cliente 2.0")).toHaveCount(0);
  await context.close();
});

test("signup creates a company with an empty workspace", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  await page.goto("/");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByLabel("Nome").fill("Paula Teste");
  await page.getByLabel("E-mail").fill(`paula.${stamp}@example.test`);
  await page.getByLabel("Senha").fill("senha-forte-123");
  await page.getByLabel("Empresa").fill(`Empresa ${stamp}`);
  await page.screenshot({ path: `${SHOTS}/signup.png` });
  await page.getByRole("button", { name: "Criar conta e empresa" }).click();
  await expect(page.locator(".profile-btn")).toContainText(`Empresa ${stamp}`);
  await page.goto("/#/projects");
  await expect(page.locator(".empty").first()).toBeVisible();
  await expect(page.getByText("Portal do Cliente 2.0")).toHaveCount(0);
  await context.close();
});

test("an administrator invites by link and the invitee joins", async ({ browser }) => {
  const admin = await fresh(browser);
  await login(admin.page, HELENA);
  await admin.page.getByRole("button", { name: /Vetor Labs/ }).click();
  await admin.page.goto("/#/access");
  await expect(admin.page.getByRole("cell", { name: /^Ricardo Nogueira/ })).toBeVisible();
  await admin.page.screenshot({ path: `${SHOTS}/users-api.png`, fullPage: true });
  await admin.page.getByRole("button", { name: "Convidar pessoa" }).click();
  const email = `convidado.${stamp}@example.test`;
  await admin.page.getByLabel("E-mail").fill(email);
  await admin.page.getByRole("button", { name: "Criar link de convite" }).click();
  const link = await admin.page.getByLabel("Link do convite").inputValue();
  expect(link).toMatch(/#\/convite\//);
  await admin.page.getByRole("button", { name: "Concluir" }).click();
  await admin.page.goto("/#/access/invites");
  await expect(admin.page.getByRole("cell", { name: email })).toBeVisible();

  const invitee = await fresh(browser);
  await invitee.page.goto(`/${new URL(link).hash}`);
  await expect(invitee.page.getByRole("heading", { name: /Convite para Vetor Labs/ })).toBeVisible();
  await invitee.page.getByLabel("Nome").fill("Pessoa Convidada");
  await invitee.page.getByLabel("Senha").fill("senha-forte-456");
  await invitee.page.screenshot({ path: `${SHOTS}/invite.png` });
  await invitee.page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(invitee.page.locator(".profile-btn")).toContainText("Pessoa Convidada");
  await invitee.context.close();
  await admin.context.close();
});
