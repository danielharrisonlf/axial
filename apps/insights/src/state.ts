import { type InjectionKey, inject, provide, reactive, shallowReactive } from "vue";

/** Insights filters (executive and analytics share them, as in the prototype). */
export interface InsightsFilters {
  orgId: string;
  projectId: string;
  teamId: string;
  period: string;
}
/** Audit center filters; they survive navigation between the Insights pages. */
export interface AuditFilters {
  userId: string;
  projectId: string;
  action: string;
  source: string;
  entityType: string;
  period: string;
  page: number;
}
export interface InsightsState {
  /** Profile the filters belong to; another profile starts from clean filters. */
  meId: string;
  ins: InsightsFilters;
  aud: AuditFilters;
}

const STATE: InjectionKey<InsightsState> = Symbol("insights-state");
const TIP: InjectionKey<ChartTip> = Symbol("insights-tooltip");

/**
 * Module-level on purpose: the host remounts the remote on every Insights
 * route, and the filters must survive the navigation (prototype: insF/audF).
 */
const shared = reactive<InsightsState>({
  meId: "",
  ins: { orgId: "", projectId: "", teamId: "", period: "90" },
  aud: { userId: "", projectId: "", action: "", source: "", entityType: "", period: "90", page: 0 },
});

export function provideState(): InsightsState {
  provide(STATE, shared);
  return shared;
}

/** Profile switch: clears the scope filters, as the prototype's profile hook does. */
export function bindProfile(state: InsightsState, meId: string): void {
  if (state.meId === meId) return;
  state.meId = meId;
  state.ins.orgId = "";
  state.ins.projectId = "";
  state.ins.teamId = "";
  state.aud.userId = "";
  state.aud.projectId = "";
  state.aud.page = 0;
}

export function useState(): InsightsState {
  const state = inject(STATE);
  if (!state) throw new Error("Insights: estado não fornecido pela raiz");
  return state;
}

/**
 * Single positioned tooltip for the charts (.tooltip[role=tooltip]). It is a
 * mouse aid only: every chart also exposes its values as text or aria-label.
 */
export interface ChartTip {
  lines: string[] | null;
  x: number;
  y: number;
  show(x: number, y: number, lines: string[]): void;
  hide(): void;
}

export function provideTip(): ChartTip {
  const tip: ChartTip = shallowReactive({
    lines: null,
    x: 0,
    y: 0,
    show(x: number, y: number, lines: string[]) {
      tip.x = x;
      tip.y = y;
      tip.lines = lines;
    },
    hide() {
      tip.lines = null;
    },
  });
  provide(TIP, tip);
  return tip;
}

export function useTip(): ChartTip {
  const tip = inject(TIP);
  if (!tip) throw new Error("Insights: tooltip não fornecido pela raiz");
  return tip;
}
