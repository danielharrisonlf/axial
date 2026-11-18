import { expect, type Page, type TestInfo, test } from "@playwright/test";

const storageKey = "axial.workspace.demo.v1";
const browserErrors = new WeakMap<Page, string[]>();
async function evidence(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.screenshot({ path: `../../output/validation/web/${name}.png`, fullPage: true });
}
async function saved(page: Page) {
  return page.evaluate(
    (key) =>
      JSON.parse(localStorage.getItem(key) ?? "null") as {
        projects: Array<{ id: string; name: string }>;
        tasks: Array<{ id: string; title: string; status: string; sprintId: string | null }>;
        comments: Array<{ taskId: string; text: string }>;
        audit: Array<{ source: string; summary: string }>;
        settings: { currentUserId: string; theme: string };
      } | null,
    storageKey,
  );
}
// the Workspace has no profile switcher: the test chooses the signed-in user in the saved state
async function switchProfile(page: Page, name: RegExp) {
  // before the first change nothing is saved yet: re-selecting the current theme writes the state
  if (!(await page.evaluate((key) => localStorage.getItem(key) !== null, storageKey))) {
    const back = page.url();
    await page.goto("/#/settings");
    await page
      .getByRole("radiogroup", { name: "Tema da interface" })
      .getByRole("radio", { name: "Sistema" })
      .click();
    await page.goto(back);
  }
  await page.evaluate(
    ([key, source, flags]) => {
      const data = JSON.parse(localStorage.getItem(key) ?? "null") as {
        users: Array<{ id: string; name: string }>;
        settings: { currentUserId: string };
      };
      const user = data.users.find((u) => new RegExp(source, flags).test(u.name));
      if (!user) throw new Error(`no user matches ${source}`);
      data.settings.currentUserId = user.id;
      localStorage.setItem(key, JSON.stringify(data));
    },
    [storageKey, name.source, name.flags] as const,
  );
  await page.reload();
  await expect(page.locator(".profile-btn .who b")).toHaveText(name);
}
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    localStorage.setItem("projectflow.db.v1", "source remains untouched");
  });
});
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test("prototype routes, initial data and project filters", async ({ page }, info) => {
  await page.goto("/#/projects");
  await expect(page.getByRole("heading", { name: "Projetos", exact: true })).toBeVisible();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(11);
  await expect(page.getByRole("button", { name: "Portal do Cliente 2.0", exact: true })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  const sourceLayout = await page.getByRole("heading", { name: "Projetos", exact: true }).boundingBox();
  expect(sourceLayout?.x).toBeGreaterThanOrEqual(250);
  expect(sourceLayout?.y).toBeLessThan(110);
  await evidence(page, info, "projects");
  await page.getByRole("searchbox", { name: "Buscar projetos" }).fill("PCL");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Buscar projetos" }).fill("");
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("paused");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Automação de Faturamento", exact: true })).toBeVisible();
  await page.goto("/#/projects/prj-pcl");
  await expect(page.getByRole("heading", { name: "Portal do Cliente 2.0", exact: true })).toBeVisible();
  await expect(page.getByText("Central de faturas", { exact: true })).toBeVisible();
  await evidence(page, info, "project-detail");
  await page.goto("/#/board");
  await expect(page.getByRole("heading", { name: "Kanban", exact: true })).toBeVisible();
  await expect(
    page.getByText("Implementar listagem de faturas com filtros por período", { exact: true }),
  ).toBeVisible();
  // the five columns fit at 1440 (audit UI-33 / VAL-01)
  const board = page.locator(".board");
  expect(await board.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await evidence(page, info, "board");
  await page.goto("/#/dashboard");
  await expect(page.getByRole("heading", { name: /Bom dia|Boa tarde|Boa noite/ })).toBeVisible();
  await expect(page.locator(".stat-strip .stat")).toHaveCount(5);
  await evidence(page, info, "dashboard");
});

test("create project, epic and task, edit drawer, comment, Kanban move and persistence", async ({
  page,
}, info) => {
  await page.goto("/#/projects");
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Novo projeto", exact: true });
  await modal.getByRole("button", { name: "Criar projeto", exact: true }).click();
  // validation on submit: invalid field marked, error bound by aria-describedby and focused
  const projectName = modal.getByRole("textbox", { name: "Nome do projeto", exact: true });
  await expect(projectName).toHaveAttribute("aria-invalid", "true");
  await expect(projectName).toBeFocused();
  const errorId = (await projectName.getAttribute("aria-describedby"))?.split(" ").at(-1) ?? "";
  await expect(modal.locator(`[id="${errorId}"]`)).toBeVisible();
  await projectName.fill("Aceitação React");
  await modal.getByRole("textbox", { name: "Chave", exact: true }).fill("QAR");
  await modal.getByRole("button", { name: "Criar projeto", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aceitação React", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Épico", exact: true }).click();
  await page.getByRole("textbox", { name: "Nome do épico", exact: true }).fill("Fluxo independente");
  await page.getByRole("button", { name: "Criar épico", exact: true }).click();
  await expect(page.getByRole("main").getByText("Fluxo independente", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Nova tarefa", exact: true }).click();
  const taskModal = page.getByRole("dialog", { name: "Nova tarefa", exact: true });
  await taskModal.getByRole("textbox", { name: "Título", exact: true }).fill("Tarefa de aceitação");
  await taskModal
    .getByRole("combobox", { name: "Épico", exact: true })
    .selectOption({ label: "Fluxo independente" });
  await taskModal.getByRole("button", { name: "Criar tarefa", exact: true }).click();
  await page.getByRole("link", { name: /Tarefas/ }).click();
  await page.getByRole("button", { name: "Tarefa de aceitação", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Tarefa QAR-101", exact: true });
  await drawer.getByRole("textbox", { name: "Título da tarefa", exact: true }).fill("Tarefa revisada");
  await drawer
    .getByRole("textbox", { name: "Descrição da tarefa", exact: true })
    .fill("Descrição persistida em React");
  // inspector property: a menu button with single choice
  await drawer.getByRole("button", { name: /^Prioridade:/ }).click();
  await page
    .getByRole("menu", { name: "Prioridade", exact: true })
    .getByRole("menuitemradio", { name: "Alta" })
    .click();
  await expect(drawer.getByRole("button", { name: "Prioridade: Alta", exact: true })).toBeFocused();
  const labelsTrigger = drawer.getByRole("button", { name: "Adicionar etiquetas", exact: true });
  await labelsTrigger.click();
  await expect(page.getByRole("menu", { name: "Etiquetas", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(labelsTrigger).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const taskTrigger = page.getByRole("button", { name: "Tarefa revisada", exact: true });
  await expect(taskTrigger).toBeFocused();
  await taskTrigger.click();
  await drawer.getByRole("textbox", { name: "Novo comentário", exact: true }).fill("Comentário de aceitação");
  await drawer.getByRole("button", { name: "Comentar", exact: true }).click();
  await expect(
    drawer.locator(".comment .c-body").filter({ hasText: "Comentário de aceitação" }),
  ).toBeVisible();
  expect((await saved(page))?.comments.some((comment) => comment.text === "Comentário de aceitação")).toBe(
    true,
  );
  await drawer
    .getByRole("textbox", { name: "Novo critério de aceite", exact: true })
    .fill("Critério verificado");
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("checkbox", { name: "Critério verificado", exact: true })).toBeVisible();
  await drawer.getByRole("textbox", { name: "Nova subtarefa", exact: true }).fill("Subtarefa verificada");
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("button", { name: /Subtarefa verificada/ })).toBeVisible();
  await evidence(page, info, "drawer");
  await drawer.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("main").getByRole("button", { name: "Kanban", exact: true }).click();
  await page
    .getByRole("button", { name: "QAR-101 Tarefa revisada", exact: true })
    .dragTo(page.locator('[data-status="in_progress"]'));
  await expect(
    page.locator('[data-status="in_progress"]').getByText("Tarefa revisada", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("Tarefa revisada", { exact: true })).toBeVisible();
  const stored = (await saved(page))?.tasks.find((task) => task.title === "Tarefa revisada");
  expect(stored?.status).toBe("in_progress");
  expect(await page.evaluate(() => localStorage.getItem("projectflow.db.v1"))).toBe(
    "source remains untouched",
  );
});

test("sprint start and completion return unfinished tasks to backlog", async ({ page }) => {
  await page.goto("/#/sprints");
  const active = page
    .locator(".panel")
    .filter({ has: page.getByRole("heading", { name: "Sprint 15", exact: true }) });
  await active.getByRole("button", { name: "Encerrar sprint", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Encerrar sprint", exact: true }).click();
  await expect(active.getByText("Concluída", { exact: true })).toBeVisible();
  const planned = page
    .locator(".panel")
    .filter({ has: page.getByRole("heading", { name: "Sprint 16", exact: true }) });
  await planned.getByRole("button", { name: "Iniciar sprint", exact: true }).click();
  await expect(planned.getByText("Ativa", { exact: true })).toBeVisible();
  await page.goto("/#/backlog");
  await expect(
    page.getByRole("button", {
      name: "Implementar listagem de faturas com filtros por período",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await saved(page))?.tasks
      .filter((task) => task.sprintId === "sp-pcl-15")
      .every((task) => task.status === "done"),
  ).toBe(true);
});

test("search, dark theme, modal keyboard focus and viewer permissions", async ({ page }, info) => {
  await page.goto("/#/projects");
  const trigger = page.getByRole("button", { name: "Novo projeto", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Novo projeto", exact: true });
  await expect(dialog).toBeVisible();
  // Tab stays inside the dialog
  for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const search = page.getByRole("searchbox", { name: "Buscar tarefas e projetos", exact: true });
  await search.fill("Portal");
  await page
    .locator(".results")
    .getByRole("button", { name: /Portal do Cliente 2.0/ })
    .click();
  await expect(page.getByRole("heading", { name: "Portal do Cliente 2.0", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mudar para tema escuro", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mudar para tema claro", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // tokens resolve through light-dark(): the dark --bg is #0E1116
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(14, 17, 22)");
  await page.getByRole("button", { name: "Nova tarefa", exact: true }).click();
  await evidence(page, info, "dark-modal");
  await page.keyboard.press("Escape");
  await switchProfile(page, /Sérgio Tavares/);
  await expect(page.getByRole("button", { name: "Nova tarefa", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: /Tarefas/ }).click();
  await page
    .getByRole("button", { name: "Implementar listagem de faturas com filtros por período", exact: true })
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("textbox", { name: "Título da tarefa", exact: true })).toBeDisabled();
  // read-only profile: properties are values, not controls
  await expect(drawer.getByRole("button", { name: /^Status:/ })).toHaveCount(0);
  await expect(drawer.locator(".task-props .prop-val").first()).toBeVisible();
  await expect(drawer.getByRole("textbox", { name: "Novo comentário", exact: true })).toHaveCount(0);
  await evidence(page, info, "viewer-dark-drawer");
  await page.keyboard.press("Escape");
  await page.goto("/#/projects");
  await expect(page.getByRole("button", { name: "Novo projeto", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Mudar para tema claro", exact: true })).toBeVisible();
  expect((await saved(page))?.settings).toMatchObject({ currentUserId: "u18", theme: "dark" });
});

test("keyboard: skip link, Ctrl+K, layered Esc and Alt+arrows on the Kanban", async ({ page }) => {
  await page.goto("/#/board");
  await expect(page.getByRole("heading", { name: "Kanban", exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Pular para o conteúdo", exact: true });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#conteudo")).toBeFocused();
  expect(page.url()).toContain("#/board");
  await page.keyboard.press("Control+k");
  const search = page.getByRole("searchbox", { name: "Buscar tarefas e projetos", exact: true });
  await expect(search).toBeFocused();
  // typing keeps focus and the caret in the field
  await page.keyboard.type("PCL-1");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("PCL-1");
  await page.keyboard.press("Escape");
  await search.fill("");
  const card = page.getByRole("button", { name: /^PCL-109 / });
  await card.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.locator('[data-status="todo"]').getByRole("button", { name: /^PCL-109 / })).toBeFocused();
  await expect(page.locator("#live-polite")).toContainText("PCL-109");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(
    page.locator('[data-status="backlog"]').getByRole("button", { name: /^PCL-109 / }),
  ).toBeFocused();
  // Enter opens the inspector; a menu inside it closes first, then the drawer
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: /^Tarefa PCL-109/ });
  await expect(drawer).toBeVisible();
  await expect(card).toHaveAttribute("aria-current", "true");
  const status = drawer.getByRole("button", { name: /^Status:/ });
  await status.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu", { name: "Status", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(status).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^PCL-109 / })).toBeFocused();
  // Ctrl+K does not escape a dialog
  await page.keyboard.press("n");
  const modal = page.getByRole("dialog", { name: "Nova tarefa", exact: true });
  await expect(modal).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(search).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
});

test("mobile navigation, table scrolling and modal controls stay reachable", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/projects");
  await expect(page.getByRole("heading", { name: "Projetos", exact: true })).toBeVisible();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(await overflow()).toBe(false);
  const tableScroll = page.locator(".tbl-wrap");
  expect(await tableScroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await tableScroll.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const burger = page.getByRole("button", { name: "Abrir menu de navegação", exact: true });
  await burger.click();
  await expect(burger).toHaveAttribute("aria-expanded", "true");
  // Esc closes the off-canvas navigation and returns focus to the burger
  await page.keyboard.press("Escape");
  await expect(burger).toHaveAttribute("aria-expanded", "false");
  await expect(burger).toBeFocused();
  await burger.click();
  await page
    .getByRole("navigation", { name: "Navegação principal", exact: true })
    .getByRole("link", { name: "Kanban", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Kanban", exact: true })).toBeVisible();
  expect(await overflow()).toBe(false);
  await evidence(page, info, "mobile-board");
  await page.getByRole("button", { name: "Nova tarefa", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nova tarefa", exact: true });
  await expect(dialog.getByRole("button", { name: "Criar tarefa", exact: true })).toBeInViewport();
  expect(await overflow()).toBe(false);
  await dialog.getByRole("textbox", { name: "Título", exact: true }).fill("Tarefa móvel");
  await evidence(page, info, "mobile-task-modal");
  await dialog.getByRole("button", { name: "Criar tarefa", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Tarefa móvel", { exact: true })).toBeVisible();
});

test("a contributor sees only their teams and cannot open another project", async ({ page }) => {
  await page.goto("/#/projects");
  await switchProfile(page, /Camila Freitas/);
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Novo projeto", exact: true })).toHaveCount(0);
  await page.goto("/#/projects/prj-apc");
  await expect(page.getByText("Acesso indisponível", { exact: true })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Buscar tarefas e projetos", exact: true });
  await search.fill("Aplicativo de Campo");
  await expect(page.locator(".results").getByText("Nenhum resultado", { exact: true })).toBeVisible();
});

test("incompatible local data recovers visibly and remains usable", async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, "{broken storage");
  }, storageKey);
  await page.goto("/#/projects");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(11);
  await expect(page.getByText("Dados recuperados", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mudar para tema escuro", exact: true }).click();
  expect((await saved(page))?.settings.theme).toBe("dark");
  expect(await page.evaluate(() => localStorage.getItem("projectflow.db.v1"))).toBe(
    "source remains untouched",
  );
});

test("notifications history, preferences, templates and providers follow the prototype", async ({
  page,
}, info) => {
  await page.goto("/#/dashboard");
  await page
    .getByLabel("Navegação principal")
    .getByRole("link", { name: "Notificações", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Notificações multicanal", exact: true })).toBeVisible();
  // seed 9: lean history, one delivery per event across three channels, two failures
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(8);
  await expect(page.getByRole("table").getByText("Falhou", { exact: true })).toHaveCount(2);
  await page.locator(".row-link").first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Mensagem", { exact: true })).toBeVisible();
  await evidence(page, info, "notifications-drawer");
  await drawer.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("link", { name: "Preferências", exact: true }).click();
  await expect(page.getByRole("switch")).toHaveCount(18);
  const emailPreference = page.getByRole("switch", {
    name: "Tarefa atribuída via E-mail",
    exact: true,
  });
  await expect(emailPreference).toBeChecked();
  await emailPreference.uncheck();
  expect(
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem("axial.workspace.demo.v1") ?? "null") as {
        notificationPreferences?: Record<string, { email: boolean }>;
      } | null;
      return data?.notificationPreferences?.["task.assigned.v1"]?.email;
    }),
  ).toBe(false);
  await page.getByRole("link", { name: "Templates", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tarefa atribuída", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Provedores", exact: true }).click();
  const sms = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "SMS", exact: true }) });
  await expect(sms.getByText("Não configurado", { exact: true })).toBeVisible();
  await sms.getByRole("button", { name: "Configurar", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Configurar SMS (SMSGo)", exact: true });
  await modal.getByRole("textbox").first().fill("+55 11 90000-0002");
  await modal.getByRole("button", { name: "Salvar configuração", exact: true }).click();
  await expect(sms.getByText("Configurado", { exact: true })).toBeVisible();
  await evidence(page, info, "notifications-providers");
  await switchProfile(page, /Sérgio Tavares/);
  await page.goto("/#/notifications/prefs");
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByText("Seu perfil pode visualizar, mas não alterar as preferências.")).toBeVisible();
  await page.goto("/#/notifications/providers");
  await expect(page.getByRole("button", { name: "Configurar", exact: true })).toHaveCount(0);
});

test("archived projects remain scoped in lists and direct links after profile switching", async ({
  page,
}) => {
  await page.goto("/#/projects/prj-cma");
  await page.getByRole("main").getByRole("button", { name: "Ações do projeto", exact: true }).click();
  await page.getByRole("menuitem", { name: "Arquivar", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Arquivar projeto", exact: true })
    .getByRole("button", { name: "Arquivar", exact: true })
    .click();
  await page.goto("/#/projects");
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("archived");
  await expect(
    page.getByRole("button", { name: "Diagnóstico Industrial Andrade", exact: true }),
  ).toBeVisible();
  await switchProfile(page, /Ricardo Nogueira/);
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("archived");
  await expect(page.getByText("Nenhum projeto encontrado", { exact: true })).toBeVisible();
  await expect(page.getByText("Diagnóstico Industrial Andrade", { exact: true })).toHaveCount(0);
  await page.goto("/#/projects/prj-cma");
  await expect(page.getByText("Acesso indisponível", { exact: true })).toBeVisible();
  await expect(page.getByText("Diagnóstico Industrial Andrade", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Restaurar", exact: true })).toHaveCount(0);
});

test("insights microfrontend exposes the PDF surfaces and gates the audit center", async ({ page }, info) => {
  await page.goto("/#/insights");
  await expect(page.getByRole("heading", { name: "Visão executiva", exact: true })).toBeVisible();
  const insightsNav = page.getByRole("navigation", { name: "Navegação principal", exact: true });
  await expect(insightsNav.getByRole("link", { name: "Visão executiva", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("Projetos ativos", { exact: true })).toBeVisible();
  await evidence(page, info, "insights-executive");

  await insightsNav.getByRole("link", { name: "Análise de projetos", exact: true }).click();
  await expect(page.getByText("Comparação de projetos", { exact: true })).toBeVisible();
  await expect(page.getByText("Indicadores por sprint", { exact: true })).toBeVisible();
  await evidence(page, info, "insights-performance");

  await insightsNav.getByRole("link", { name: "Central de auditoria", exact: true }).click();
  await expect(page.getByText("Nenhum registro", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("table")).toBeVisible();
  await evidence(page, info, "insights-audit");

  await switchProfile(page, /Sérgio Tavares/);
  await page.goto("/#/insights");
  await expect(page.getByRole("heading", { name: "Visão executiva", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Central de auditoria", exact: true })).toHaveCount(0);
});

test("access management lists users, roles and the capability matrix", async ({ page }, info) => {
  await page.goto("/#/access");
  await expect(page.getByRole("heading", { name: "Usuários e permissões", exact: true })).toBeVisible();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(18);
  await expect(page.getByRole("button", { name: "Convidar pessoa", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Papel de/ }).first()).toBeVisible();
  await evidence(page, info, "access-users");

  await page.getByRole("link", { name: "Papéis e permissões", exact: true }).click();
  await expect(page.getByText("gerenciar usuários", { exact: true })).toBeVisible();
  await expect(page.getByText("central de auditoria", { exact: true })).toBeVisible();
  await evidence(page, info, "access-roles");

  await switchProfile(page, /Sérgio Tavares/);
  await page.goto("/#/access/users");
  await expect(page.getByRole("button", { name: "Convidar pessoa", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /Papel de/ })).toHaveCount(0);
});

test("MCP connect section shows the server URL from the build configuration", async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/#/mcp/connect");
  // playwright.config.ts starts the dev server with VITE_API_BASE_URL=https://api.gateway.example.test
  const url = "https://api.gateway.example.test/mcp";
  await expect(page.locator("pre.code").first()).toHaveText(url);
  await expect(page.getByText(`claude mcp add --scope user --transport http kairos ${url}`)).toBeVisible();
  await expect(page.getByText("abra uma nova sessão do Claude Code", { exact: false })).toBeVisible();
  await expect(page.locator("pre.code", { hasText: '"mcpServers"' })).toContainText(`"url": "${url}"`);
  const copy = page.getByRole("button", { name: "Copiar endereço do servidor MCP", exact: true });
  await copy.click();
  await expect(copy).toHaveText("Copiado");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await evidence(page, info, "mcp-connect");
});

test("MCP catalog lists the server tools and the console writes with the mcp origin", async ({ page }) => {
  await page.goto("/#/mcp");
  await expect(page.getByRole("heading", { name: "Agentes e integração MCP", exact: true })).toBeVisible();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(8);
  await expect(page.getByText("Histórico de execuções")).toHaveCount(0);
  await page.getByRole("link", { name: "Testar ferramenta", exact: true }).click();
  await page.getByRole("combobox", { name: "Ferramenta", exact: true }).selectOption("update-task-status");
  // the example carries the task's current version (optimistic concurrency, as the real server)
  const args = page.getByRole("textbox", { name: "Argumentos (JSON)", exact: true });
  const example = JSON.parse(await args.inputValue()) as { taskId: string; version: number };
  await page.getByRole("button", { name: "Executar ferramenta", exact: true }).click();
  const response = page.getByRole("region", { name: "Resposta JSON", exact: true });
  await expect(response).toContainText('"in_review"');
  await expect(response).toContainText(`"version": ${example.version + 1}`);
  const audit = (await saved(page))?.audit[0];
  expect(audit?.source).toBe("mcp");
  // the same arguments again carry a stale version
  await page.getByRole("button", { name: "Executar ferramenta", exact: true }).click();
  await expect(response).toContainText('"version_conflict"');
  await page.getByRole("textbox", { name: "Argumentos (JSON)", exact: true }).fill("{ invalid");
  await page.getByRole("button", { name: "Executar ferramenta", exact: true }).click();
  await expect(page.getByRole("region", { name: "Resposta JSON", exact: true })).toContainText(
    '"isError": true',
  );
});

const ROUTES = [
  "/dashboard",
  "/projects",
  "/projects/prj-pcl",
  "/my-tasks",
  "/teams",
  "/board",
  "/backlog",
  "/sprints",
  "/timeline",
  "/mcp",
  "/mcp/test",
  "/notifications",
  "/access",
  "/access/roles",
  "/settings",
  "/insights",
  "/insights/analytics",
  "/insights/audit",
];
async function settled(page: Page) {
  await expect(page.locator("#conteudo h1").first()).toBeVisible();
  await expect(page.locator("#conteudo [aria-busy=true]")).toHaveCount(0);
}

for (const theme of ["light", "dark"] as const) {
  test(`no horizontal page scroll at 390 px and AA text contrast (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ROUTES) {
      await page.goto(`/#${route}`);
      await settled(page);
      const width = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - window.innerWidth,
        main:
          (document.getElementById("conteudo")?.scrollWidth ?? 0) -
          (document.getElementById("conteudo")?.clientWidth ?? 0),
      }));
      expect(width, route).toEqual({ doc: 0, main: 0 });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const route of ROUTES) {
      await page.goto(`/#${route}`);
      await settled(page);
      // computed colors: text over its effective background (translucent layers composed)
      const failures = await page.evaluate(() => {
        const parse = (value: string) => {
          const parts = (value.match(/rgba?\(([^)]+)\)/)?.[1] ?? "0 0 0")
            .split(/[ ,/]+/)
            .filter(Boolean)
            .map(Number);
          return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
        };
        type Rgb = ReturnType<typeof parse>;
        const over = (top: Rgb, bottom: Rgb): Rgb => ({
          r: top.r * top.a + bottom.r * (1 - top.a),
          g: top.g * top.a + bottom.g * (1 - top.a),
          b: top.b * top.a + bottom.b * (1 - top.a),
          a: 1,
        });
        const lum = (c: Rgb) => {
          const f = (v: number) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        const background = (el: Element) => {
          const layers: Rgb[] = [];
          for (let node: Element | null = el; node; node = node.parentElement) {
            const c = parse(getComputedStyle(node).backgroundColor);
            if (c.a > 0) layers.push(c);
            if (c.a >= 1) break;
          }
          let acc = parse(getComputedStyle(document.body).backgroundColor);
          for (const layer of layers.reverse()) acc = over(layer, acc);
          return acc;
        };
        const out: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const seen = new Set<Element>();
        while (walker.nextNode()) {
          const el = walker.currentNode.parentElement;
          if (!el || seen.has(el) || !walker.currentNode.textContent?.trim()) continue;
          seen.add(el);
          // avatar initials are the documented exception; disabled controls are exempt
          if (el.closest(".sr-only, .avatar, :disabled, [aria-disabled=true]")) continue;
          const rect = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (!rect.width || !rect.height || cs.visibility === "hidden" || Number(cs.opacity) < 0.05)
            continue;
          const bg = background(el);
          const fg = over(parse(cs.color), bg);
          const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a) as [number, number];
          const ratio = (hi + 0.05) / (lo + 0.05);
          const size = Number.parseFloat(cs.fontSize);
          const need = size >= 24 || (Number(cs.fontWeight) >= 700 && size >= 18.66) ? 3 : 4.5;
          if (ratio < need - 0.01)
            out.push(
              `${el.className} "${walker.currentNode.textContent?.trim().slice(0, 30)}" ${ratio.toFixed(2)}`,
            );
        }
        return out;
      });
      expect(failures, route).toEqual([]);
    }
  });
}

test("presentation flows: Esc keeps inspector edits, audit finds the moved task, roles gate Insights", async ({
  page,
}) => {
  await page.goto("/#/board");
  await page.getByRole("button", { name: /^PCL-109 / }).click();
  const drawer = page.getByRole("dialog", { name: /^Tarefa PCL-109/ });
  await drawer
    .getByRole("textbox", { name: "Título da tarefa", exact: true })
    .fill("Assinatura eletrônica revisada");
  // Esc closes the inspector before the field blurs; the edit is still saved
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const card = page.getByRole("button", { name: "PCL-109 Assinatura eletrônica revisada", exact: true });
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press("Alt+ArrowRight");
  // the audit center finds the moved task by its reference and shows only what changed
  await page.goto("/#/insights/audit");
  await page.getByRole("searchbox", { name: "Buscar na auditoria", exact: true }).fill("PCL-109");
  const firstRow = page.getByRole("table").locator("tbody tr").first();
  await expect(firstRow).toContainText("Tarefa · PCL-109");
  await expect(firstRow).toContainText("moveu PCL-109 de Backlog para A fazer");
  await firstRow.getByRole("button").click();
  const record = page.getByRole("dialog", { name: "Registro de auditoria" });
  await expect(record.locator(".diff-table tbody tr")).toHaveCount(1);
  await expect(record.locator(".diff-table")).toContainText("Backlog");
  await expect(record.locator(".diff-table")).toContainText("A fazer");
  await page.keyboard.press("Escape");
  // a developer has no insights.view: the page explains it
  await switchProfile(page, /Camila Freitas/);
  await page.goto("/#/insights");
  await expect(page.getByText("Acesso restrito", { exact: true })).toBeVisible();
  await expect(page.getByText(/não tem acesso ao Insights/)).toBeVisible();
  // destructive confirmations open on "Cancelar"
  await switchProfile(page, /Helena Costa/);
  await page.goto("/#/projects/prj-pcl");
  await page.getByRole("main").getByRole("button", { name: "Ações do projeto", exact: true }).click();
  await page.getByRole("menuitem", { name: "Arquivar", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Arquivar projeto", exact: true });
  await expect(confirm.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
});
