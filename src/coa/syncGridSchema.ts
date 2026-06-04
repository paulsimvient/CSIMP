import type { LogisticsChip } from "./types";

export type SyncMatrixCategory =
  | "main-effort"
  | "supporting-effort"
  | "security"
  | "isr"
  | "fires"
  | "cyber"
  | "logistics"
  | "reserve";

/** Stable row key for the commander synchronization grid. */
export type SyncGridRowKey =
  | "maneuver::main-effort"
  | "maneuver::supporting-effort"
  | "maneuver::reserve"
  | "fires::suppression"
  | "fires::on-call"
  | "isr::air"
  | "isr::ground"
  | "cyber::disruption"
  | "protection::security"
  | "protection::air-defense"
  | "sustainment::logistics"
  | "sustainment::casevac";

export type SyncGridRowDef = {
  rowKey: SyncGridRowKey;
  section: string;
  label: string;
};

export const SYNC_GRID_TASK_ROWS: SyncGridRowDef[] = [
  { rowKey: "maneuver::main-effort", section: "MANEUVER", label: "Main Effort" },
  { rowKey: "maneuver::supporting-effort", section: "MANEUVER", label: "Supporting Effort" },
  { rowKey: "maneuver::reserve", section: "MANEUVER", label: "Reserve" },
  { rowKey: "fires::suppression", section: "FIRES", label: "Suppression" },
  { rowKey: "fires::on-call", section: "FIRES", label: "On-call Fires" },
  { rowKey: "isr::air", section: "ISR", label: "Air ISR" },
  { rowKey: "isr::ground", section: "ISR", label: "Ground ISR" },
  { rowKey: "cyber::disruption", section: "CYBER / EW", label: "Disruption" },
  { rowKey: "protection::security", section: "PROTECTION", label: "Security" },
  { rowKey: "protection::air-defense", section: "PROTECTION", label: "Air Defense" },
  { rowKey: "sustainment::logistics", section: "SUSTAINMENT", label: "Logistics" },
  { rowKey: "sustainment::casevac", section: "SUSTAINMENT", label: "Medical / CASEVAC" },
];

export type SyncGridSectionDef = {
  id: string;
  label: string;
};

export const SYNC_GRID_SECTIONS: SyncGridSectionDef[] = [
  { id: "maneuver", label: "MANEUVER" },
  { id: "fires", label: "FIRES" },
  { id: "isr", label: "ISR" },
  { id: "cyber", label: "CYBER / EW" },
  { id: "protection", label: "PROTECTION" },
  { id: "sustainment", label: "SUSTAINMENT" },
];

export function syncGridRowLabel(rowKey: SyncGridRowKey): string {
  return SYNC_GRID_TASK_ROWS.find((row) => row.rowKey === rowKey)?.label ?? rowKey;
}

export function syncGridRowSection(rowKey: SyncGridRowKey): string {
  return SYNC_GRID_TASK_ROWS.find((row) => row.rowKey === rowKey)?.section ?? "MANEUVER";
}

export function formatMatrixRowOption(rowKey: SyncGridRowKey): string {
  const def = SYNC_GRID_TASK_ROWS.find((row) => row.rowKey === rowKey);
  return def ? `${def.section} / ${def.label}` : rowKey;
}

export function sectionIdForRowKey(rowKey: SyncGridRowKey): string | undefined {
  const sectionLabel = syncGridRowSection(rowKey);
  return SYNC_GRID_SECTIONS.find((section) => section.label === sectionLabel)?.id;
}

export function mapCategoryToRowKey(
  category: SyncMatrixCategory,
  chip?: Pick<LogisticsChip, "label" | "actionType">
): SyncGridRowKey {
  const label = (chip?.label ?? "").toLowerCase();
  const actionType = (chip?.actionType ?? "").toLowerCase();

  if (category === "reserve" || /reserve|reinforce on order|be prepared/.test(label)) {
    return "maneuver::reserve";
  }
  if (category === "fires") {
    return /on[- ]?call|contingent/.test(label) ? "fires::on-call" : "fires::suppression";
  }
  if (category === "isr") {
    return /ground|sensor|radar/.test(label) ? "isr::ground" : "isr::air";
  }
  if (category === "cyber") return "cyber::disruption";
  if (category === "security") {
    return /air defense|patriot|missile/.test(label)
      ? "protection::air-defense"
      : "protection::security";
  }
  if (category === "logistics") {
    return /casevac|medical|medevac/.test(label) ? "sustainment::casevac" : "sustainment::logistics";
  }
  if (category === "main-effort") return "maneuver::main-effort";
  if (category === "supporting-effort") return "maneuver::supporting-effort";

  if (/maneuver|advance|secure objective|assault/.test(label) || actionType === "movement") {
    return "maneuver::main-effort";
  }
  return "maneuver::supporting-effort";
}

export function parseRowKeyFromText(text: string): SyncGridRowKey | undefined {
  const lower = text.toLowerCase();
  if (/\b(main effort)\b/.test(lower)) return "maneuver::main-effort";
  if (/\b(supporting effort)\b/.test(lower)) return "maneuver::supporting-effort";
  if (/\breserve\b/.test(lower)) return "maneuver::reserve";
  if (/\b(on[- ]?call fires?)\b/.test(lower)) return "fires::on-call";
  if (/\b(fires?|suppression|suppress)\b/.test(lower)) return "fires::suppression";
  if (/\b(ground isr|ground sensor)\b/.test(lower)) return "isr::ground";
  if (/\b(air isr|isr|recon|surveillance)\b/.test(lower)) return "isr::air";
  if (/\b(cyber|ew|disrupt)\b/.test(lower)) return "cyber::disruption";
  if (/\b(air defense)\b/.test(lower)) return "protection::air-defense";
  if (/\b(security|screen|guard)\b/.test(lower)) return "protection::security";
  if (/\b(casevac|medical|medevac)\b/.test(lower)) return "sustainment::casevac";
  if (/\b(logistics|resupply|fuel|sustainment)\b/.test(lower)) return "sustainment::logistics";
  if (/\b(maneuver)\b/.test(lower)) return "maneuver::main-effort";
  return undefined;
}

export function formatTaskCardPrimary(bar: {
  actor?: string;
  actionVerb?: string;
  label: string;
}): string {
  const verb = bar.actionVerb ?? bar.label;
  if (bar.actor) return `${bar.actor}: ${verb}`;
  return verb;
}

export function formatTaskCardSecondary(bar: {
  target?: string;
  label: string;
  missingFields?: string[];
}): string {
  if (
    bar.missingFields?.includes("timing") ||
    bar.missingFields?.includes("start") ||
    bar.missingFields?.includes("duration")
  ) {
    return "Timing required";
  }
  return bar.target?.trim() || bar.label;
}

export function rowKeyToLegacyCategory(rowKey: SyncGridRowKey): SyncMatrixCategory {
  if (rowKey.startsWith("maneuver::main-effort")) return "main-effort";
  if (rowKey.startsWith("maneuver::supporting")) return "supporting-effort";
  if (rowKey.startsWith("maneuver::reserve")) return "reserve";
  if (rowKey.startsWith("fires::")) return "fires";
  if (rowKey.startsWith("isr::")) return "isr";
  if (rowKey.startsWith("cyber::")) return "cyber";
  if (rowKey.startsWith("protection::")) return "security";
  if (rowKey.startsWith("sustainment::")) return "logistics";
  return "supporting-effort";
}
