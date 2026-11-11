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
        settings: { currentUserId: string; theme: string };
      } | null,
    storageKey,
  );
}
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("projectflow.db.v1", "source remains untouched");
  });
});
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test("prototype routes, initial data and project filters", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  await evidence(page, info, "board");
  await page.goto("/#/dashboard");
  await expect(page.getByRole("heading", { name: /Bom dia|Boa tarde|Boa noite/ })).toBeVisible();
  await evidence(page, info, "dashboard");
  expect(errors).toEqual([]);
});

test("create project, epic and task, edit drawer, comment, Kanban move and persistence", async ({
  page,
}, info) => {
  await page.goto("/#/projects");
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Novo projeto", exact: true });
  await modal.getByRole("button", { name: "Criar projeto", exact: true }).click();
  await expect(modal.getByRole("alert").first()).toBeVisible();
  await modal.getByRole("textbox", { name: "Nome do projeto", exact: true }).fill("Aceitação React");
  await modal.getByRole("textbox", { name: "Chave", exact: true }).fill("QAR");
  await modal.getByRole("button", { name: "Criar projeto", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aceitação React", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Épico", exact: true }).click();
  await page.getByRole("textbox", { name: "Nome do épico", exact: true }).fill("Fluxo independente");
  await page.getByRole("button", { name: "Criar épico", exact: true }).click();
  await expect(page.getByText("Fluxo independente", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Nova tarefa", exact: true }).click();
  const taskModal = page.getByRole("dialog", { name: "Nova tarefa", exact: true });
  await taskModal.getByRole("textbox", { name: "Título", exact: true }).fill("Tarefa de aceitação");
  await taskModal
    .getByRole("combobox", { name: "Épico", exact: true })
    .selectOption({ label: "Fluxo independente" });
  await taskModal.getByRole("button", { name: "Criar tarefa", exact: true }).click();
  await page.getByRole("tab", { name: /Tarefas/ }).click();
  await page.getByRole("button", { name: "Tarefa de aceitação", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("textbox", { name: "Título da tarefa", exact: true }).fill("Tarefa revisada");
  await drawer
    .getByRole("textbox", { name: "Descrição da tarefa", exact: true })
    .fill("Descrição persistida em React");
  await drawer.getByRole("combobox", { name: "Prioridade da tarefa", exact: true }).selectOption("high");
  const labelsTrigger = drawer.getByRole("button", { name: "Editar etiquetas", exact: true });
  await labelsTrigger.click();
  await expect(page.getByRole("menu", { name: "Editar etiquetas", exact: true })).toBeVisible();
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
  await expect(drawer.locator(".comment p").filter({ hasText: "Comentário de aceitação" })).toBeVisible();
  expect((await saved(page))?.comments.some((comment) => comment.text === "Comentário de aceitação")).toBe(
    true,
  );
  await drawer
    .getByRole("textbox", { name: "Novo critério de aceite", exact: true })
    .fill("Critério verificado");
  await drawer.getByRole("button", { name: "Adicionar critério", exact: true }).click();
  await expect(drawer.getByRole("checkbox", { name: "Critério verificado", exact: true })).toBeVisible();
  await drawer.getByRole("textbox", { name: "Nova subtarefa", exact: true }).fill("Subtarefa verificada");
  await drawer.getByRole("button", { name: "Adicionar subtarefa", exact: true }).click();
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
  expect((await saved(page))?.tasks.find((task) => task.title === "Tarefa revisada")?.status).toBe(
    "in_progress",
  );
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
  await page.getByRole("dialog").getByRole("button", { name: "Encerrar sprint", exact: true }).click();
  await expect(active.getByText("concluída", { exact: true })).toBeVisible();
  const planned = page
    .locator(".panel")
    .filter({ has: page.getByRole("heading", { name: "Sprint 16", exact: true }) });
  await planned.getByRole("button", { name: "Iniciar sprint", exact: true }).click();
  await expect(planned.getByText("ativa", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("dialog", { name: "Novo projeto", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const search = page.getByRole("searchbox", { name: "Buscar", exact: true });
  await search.fill("Portal");
  await page
    .locator(".results")
    .getByRole("menuitem", { name: /Portal do Cliente 2.0/ })
    .click();
  await expect(page.getByRole("heading", { name: "Portal do Cliente 2.0", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mudar para tema escuro", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mudar para tema claro", exact: true })).toBeVisible();
  const background = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
  );
  expect(background.toLowerCase()).toBe("#0e1116");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Nova tarefa", exact: true }).click();
  await evidence(page, info, "dark-modal");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Trocar perfil de demonstração", exact: true }).click();
  await expect(page.getByText("Perfis de demonstração", { exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: /Sérgio Tavares/ }).click();
  await expect(page.getByRole("button", { name: "Nova tarefa", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: /Tarefas/ }).click();
  await page
    .getByRole("button", { name: "Implementar listagem de faturas com filtros por período", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Título da tarefa", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Status da tarefa", exact: true })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Novo comentário", exact: true })).toHaveCount(0);
  await evidence(page, info, "viewer-dark-drawer");
  await page.keyboard.press("Escape");
  await page.goto("/#/projects");
  await expect(page.getByRole("button", { name: "Novo projeto", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Mudar para tema claro", exact: true })).toBeVisible();
  expect((await saved(page))?.settings).toMatchObject({ currentUserId: "u18", theme: "dark" });
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
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Navegação principal", exact: true })
    .getByRole("button", { name: "Kanban", exact: true })
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
  await page.getByRole("button", { name: "Trocar perfil de demonstração", exact: true }).click();
  await page.getByRole("menuitem", { name: /Camila Freitas/ }).click();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Novo projeto", exact: true })).toHaveCount(0);
  await page.goto("/#/projects/prj-apc");
  await expect(page.getByText("Acesso indisponível", { exact: true })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Buscar", exact: true });
  await search.fill("Aplicativo de Campo");
  await expect(page.locator(".results").getByText("Nenhum resultado", { exact: true })).toBeVisible();
});

test("incompatible local data recovers visibly and remains usable", async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, "{broken storage");
  }, storageKey);
  await page.goto("/#/projects");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(11);
  await expect(page.getByText("Demonstração restaurada", { exact: true })).toBeVisible();
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
    .getByRole("button", { name: "Notificações", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Notificações multicanal", exact: true })).toBeVisible();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(20);
  await page.locator(".row-link").first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Mensagem", { exact: true })).toBeVisible();
  await evidence(page, info, "notifications-drawer");
  await drawer.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("tab", { name: "Preferências", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(18);
  const emailPreference = page.getByRole("checkbox", {
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
  await page.getByRole("tab", { name: "Templates", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tarefa atribuída", exact: true })).toBeVisible();
  await expect(page.getByText("Templates", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Provedores", exact: true }).click();
  const sms = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "SMS", exact: true }) });
  await expect(sms.getByText("não configurado", { exact: true })).toBeVisible();
  await sms.getByRole("button", { name: "Configurar", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Configurar SMS (SMSGo)", exact: true });
  await modal.getByRole("textbox").first().fill("+55 11 90000-0002");
  await modal.getByRole("button", { name: "Salvar configuração", exact: true }).click();
  await expect(sms.getByText("configurado", { exact: true })).toBeVisible();
  await evidence(page, info, "notifications-providers");
  await page.getByRole("button", { name: "Trocar perfil de demonstração", exact: true }).click();
  await page.getByRole("menuitem", { name: /Sérgio Tavares/ }).click();
  await page.goto("/#/notifications/prefs");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
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
    .getByRole("dialog", { name: "Arquivar projeto", exact: true })
    .getByRole("button", { name: "Arquivar", exact: true })
    .click();
  await page.goto("/#/projects");
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("archived");
  await expect(
    page.getByRole("button", { name: "Diagnóstico Industrial Andrade", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Trocar perfil de demonstração", exact: true }).click();
  await page.getByRole("menuitem", { name: /Ricardo Nogueira/ }).click();
  await expect(page.getByText("Nenhum projeto encontrado", { exact: true })).toBeVisible();
  await expect(page.getByText("Diagnóstico Industrial Andrade", { exact: true })).toHaveCount(0);
  await page.goto("/#/projects/prj-cma");
  await expect(page.getByText("Acesso indisponível", { exact: true })).toBeVisible();
  await expect(page.getByText("Diagnóstico Industrial Andrade", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Restaurar", exact: true })).toHaveCount(0);
});

test("insights microfrontend exposes the PDF surfaces and gates the audit center", async ({ page }, info) => {
  await page.goto("/#/insights");
  await expect(page.getByRole("heading", { name: "ProjectFlow Insights", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Dashboard executivo", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Projetos ativos", { exact: true })).toBeVisible();
  await evidence(page, info, "insights-executive");

  await page.getByRole("tab", { name: "Análises de desempenho", exact: true }).click();
  await expect(page.getByText("Comparação de projetos", { exact: true })).toBeVisible();
  await expect(page.getByText("Indicadores por sprint", { exact: true })).toBeVisible();
  await evidence(page, info, "insights-performance");

  await page.getByRole("tab", { name: "Central de auditoria", exact: true }).click();
  await expect(page.getByText("Nenhum registro", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("table")).toBeVisible();
  await evidence(page, info, "insights-audit");

  await page.getByRole("button", { name: "Trocar perfil de demonstração", exact: true }).click();
  await page.getByRole("menuitem", { name: /Sérgio Tavares/ }).click();
  await page.goto("/#/insights");
  await expect(page.getByRole("heading", { name: "ProjectFlow Insights", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Central de auditoria", exact: true })).toHaveCount(0);
});

test("access management lists users, roles and the capability matrix", async ({ page }, info) => {
  await page.goto("/#/access");
  await expect(page.getByRole("heading", { name: "Usuários e permissões", exact: true })).toBeVisible();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(18);
  await evidence(page, info, "access-users");

  await page.getByRole("tab", { name: "Papéis e permissões", exact: true }).click();
  await expect(page.getByText("gerenciar usuários", { exact: true })).toBeVisible();
  await expect(page.getByText("central de auditoria", { exact: true })).toBeVisible();
  await evidence(page, info, "access-roles");

  await page.getByRole("button", { name: "Trocar perfil de demonstração", exact: true }).click();
  await page.getByRole("menuitem", { name: /Sérgio Tavares/ }).click();
  await page.goto("/#/access/users");
  await expect(page.getByRole("button", { name: "Convidar colaborador", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /Papel de/ })).toHaveCount(0);
});
