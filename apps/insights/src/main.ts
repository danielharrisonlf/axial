import { createApp, h } from "vue";
import Insights from "./InsightsDashboard.vue";
import "./styles/insights.css";
import { EMPTY_PROPS, type InsightsView } from "./types";

// Standalone development page: no host data, so every panel shows its empty state.
// ?view=analytics|audit picks the page; ?theme=light|dark forces the color scheme.
const params = new URLSearchParams(window.location.search);
const theme = params.get("theme");
if (theme === "light" || theme === "dark") document.documentElement.style.colorScheme = theme;
const requested = params.get("view");
const view: InsightsView = requested === "analytics" || requested === "audit" ? requested : "executive";
createApp({ render: () => h(Insights, { ...EMPTY_PROPS, view, standalone: true }) }).mount("#app");
