import { createApp } from "vue";
import Insights from "./InsightsDashboard.vue";
import { EMPTY_PROPS, type InsightsData, type InsightsProps } from "./types";

/**
 * Module Federation contract: the Workspace (React) calls `mount(element, data)`
 * and gets an unmount callback. Vue never leaks into the host bundle.
 */
export function mount(element: HTMLElement, props: InsightsProps = EMPTY_PROPS): () => void {
  const app = createApp(Insights, props as InsightsData);
  app.mount(element);
  return () => app.unmount();
}
