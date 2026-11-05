import original from "./demo-seed.json";
import type { WorkspaceData } from "./types";

/** Source data is the original prototype's fictional seed, with dates relative to restoration. */
export function createDemoData(now = new Date()): WorkspaceData {
  const data = structuredClone(original) as WorkspaceData;
  const seedDate = new Date(data.meta.seededAt);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const seededDay = new Date(seedDate.getFullYear(), seedDate.getMonth(), seedDate.getDate());
  const shift = today.getTime() - seededDay.getTime();
  const shiftValue = (value: unknown): unknown => {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/.test(value)) {
      const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
      return new Date(date.getTime() + shift).toISOString().slice(0, value.length === 10 ? 10 : undefined);
    }
    if (Array.isArray(value)) return value.map(shiftValue);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shiftValue(item)]));
    return value;
  };
  const shifted = shiftValue(data) as WorkspaceData;
  shifted.meta.seededAt = now.toISOString();
  return shifted;
}
