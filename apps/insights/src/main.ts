import { createApp } from "vue";
import Insights from "./InsightsDashboard.vue";
import { EMPTY_PROPS, type InsightsData } from "./types";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
if (theme === "dark") document.documentElement.dataset.theme = "dark";
createApp(Insights, EMPTY_PROPS as InsightsData).mount("#app");
