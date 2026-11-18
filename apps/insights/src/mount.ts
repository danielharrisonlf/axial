import { createApp, h, shallowReactive } from "vue";
import Insights from "./InsightsDashboard.vue";
import "./styles/insights.css";
import { EMPTY_PROPS, type InsightsProps } from "./types";

/** Unmount callback that can also receive new props without remounting the app. */
export interface InsightsHandle {
  (): void;
  update(props: InsightsProps): void;
}

/**
 * Module Federation contract: the Workspace (React) calls `mount(element, props)`
 * once and gets back the unmount callback, which also carries `update(props)`
 * for data and view changes. Vue never leaks into the host bundle.
 */
export function mount(element: HTMLElement, props: InsightsProps = EMPTY_PROPS): InsightsHandle {
  const state = shallowReactive<InsightsProps>({ ...props });
  const app = createApp({ render: () => h(Insights, { ...state }) });
  app.mount(element);
  const unmount = () => app.unmount();
  return Object.assign(unmount, {
    update(next: InsightsProps) {
      Object.assign(state, next);
    },
  });
}
