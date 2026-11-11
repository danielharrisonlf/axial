import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.env.WEB_URL ?? "http://127.0.0.1:4173";
const outDir = new URL("../../../output/validation/performance/vitals/", import.meta.url);
await mkdir(outDir, { recursive: true });

const profiles = [
  { name: "desktop", viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, isMobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true },
];
const routes = [
  { name: "dashboard", path: "/#/dashboard" },
  { name: "projects", path: "/#/projects" },
];

const browser = await chromium.launch();
try {
  for (const profile of profiles) {
    for (const route of routes) {
      const context = await browser.newContext({
        viewport: profile.viewport,
        deviceScaleFactor: profile.deviceScaleFactor,
        isMobile: profile.isMobile,
        colorScheme: "light",
      });
      const page = await context.newPage();
      const client = await context.newCDPSession(page);
      await client.send("Performance.enable");
      await page.addInitScript(() => {
        window.__perf = { lcp: 0, cls: 0, longTasks: 0, longTaskTime: 0, shifts: [] };
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          window.__perf.lcp = entries.at(-1)?.startTime ?? window.__perf.lcp;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue;
            window.__perf.cls += entry.value;
            window.__perf.shifts.push(entry.value);
          }
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__perf.longTasks += 1;
            window.__perf.longTaskTime += entry.duration;
          }
        }).observe({ type: "longtask", buffered: true });
      });
      await page.goto(`${base}${route.path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2500);
      const metrics = await client.send("Performance.getMetrics");
      const metric = (name) => metrics.metrics.find((item) => item.name === name)?.value ?? null;
      const vitals = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        const paints = Object.fromEntries(
          performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime]),
        );
        const resources = performance.getEntriesByType("resource").map((entry) => ({
          name: entry.name,
          type: entry.initiatorType,
          transferSize: entry.transferSize,
          duration: entry.duration,
        }));
        return {
          lcp: window.__perf.lcp,
          cls: window.__perf.cls,
          longTasks: window.__perf.longTasks,
          longTaskTime: window.__perf.longTaskTime,
          domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
          load: nav?.loadEventEnd ?? null,
          responseEnd: nav?.responseEnd ?? null,
          firstPaint: paints["first-paint"] ?? null,
          firstContentfulPaint: paints["first-contentful-paint"] ?? null,
          transferBytes: resources.reduce((sum, item) => sum + (item.transferSize || 0), 0),
          resourceCount: resources.length,
          jsTransferBytes: resources
            .filter((item) => item.name.endsWith(".js"))
            .reduce((sum, item) => sum + (item.transferSize || 0), 0),
        };
      });
      const cdp = {
        jsHeapUsed: metric("JSHeapUsedSize"),
        nodes: metric("Nodes"),
        documents: metric("Documents"),
        listeners: metric("JSEventListeners"),
        layoutCount: metric("LayoutCount"),
        recalcStyleCount: metric("RecalcStyleCount"),
        taskDuration: metric("TaskDuration"),
        scriptDuration: metric("ScriptDuration"),
      };
      const result = { profile: profile.name, route: route.name, vitals, cdp };
      await writeFile(new URL(`${profile.name}-${route.name}.json`, outDir), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
      await context.close();
    }
  }
} finally {
  await browser.close();
}
