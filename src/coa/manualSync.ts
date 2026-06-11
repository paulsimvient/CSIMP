import {
  formatMatrixTick,
  formatMissionTick,
  type SyncBarStatus,
} from "./syncMatrix";
import {
  defaultActionVerbForRowKey,
  formatMatrixRowOption,
  mapCategoryToRowKey,
  parseRowKeyFromText,
  rowKeyToLegacyCategory,
  type SyncGridRowKey,
  type SyncMatrixCategory,
} from "./syncGridSchema";

export type { SyncMatrixCategory } from "./syncGridSchema";

export type SyncTaskOrigin =
  | "system-generated"
  | "user-added"
  | "user-modified"
  | "imported"
  | "contingent";

export type MatrixComposerDraft = {
  rowKey: SyncGridRowKey;
  startSec: number;
  entryId?: string;
  actionVerb?: string;
};

export type TimingUnresolved = "start" | "duration" | "end";

export type ParsedManualInstruction = {
  actor?: string;
  actionVerb?: string;
  target?: string;
  startCondition?: string;
  endTimeLabel?: string;
  dependency?: string;
  category: SyncMatrixCategory;
  rowKey: SyncGridRowKey;
  startSec: number;
  durationSec: number;
  endSec?: number;
  status: SyncBarStatus;
  missingFields: string[];
  timingUnresolved: TimingUnresolved[];
  summaryLabel: string;
};

export type ManualSyncEntry = {
  id: string;
  origin: SyncTaskOrigin;
  actor?: string;
  actionVerb?: string;
  target?: string;
  targetFactId?: string;
  startCondition?: string;
  endTimeLabel?: string;
  dependency?: string;
  dependencyBarId?: string;
  category: SyncMatrixCategory;
  rowKey: SyncGridRowKey;
  subLabel: string;
  startSec: number;
  durationSec: number;
  status: SyncBarStatus;
  confidence?: "low" | "medium" | "high";
  source: "map" | "matrix" | "import";
  missingFields: string[];
  timingUnresolved?: TimingUnresolved[];
  instruction?: string;
  confirmed: boolean;
};

export type ManualSyncTarget = {
  factId: string;
  entity: string;
  domain?: string;
  event?: string;
};

const CATEGORY_KEYWORDS: Array<{ pattern: RegExp; category: SyncMatrixCategory }> = [
  { pattern: /\b(main effort|maneuver|advance|secure objective|assault)\b/i, category: "main-effort" },
  { pattern: /\b(isr|recon|surveillance|maintain contact|orbit|observe)\b/i, category: "isr" },
  { pattern: /\b(info ops|information ops|influence|counter rumor|inform)\b/i, category: "information" },
  { pattern: /\b(harden|contain|forensic)\b/i, category: "cyber" },
  { pattern: /\b(cyber|disrupt|jam|degrade)\b/i, category: "cyber" },
  { pattern: /\b(fires|suppress|strike|sead)\b/i, category: "fires" },
  { pattern: /\b(logistics|resupply|fuel|casevac|sustainment)\b/i, category: "logistics" },
  { pattern: /\b(security|screen|guard|preserve)\b/i, category: "security" },
  { pattern: /\b(reserve|reinforce on order|be prepared)\b/i, category: "reserve" },
];

const ACTION_VERBS =
  /\b(secure|maintain|disrupt|jam|harden|inform|investigate|establish|reinforce|screen|suppress|observe|monitor|coordinate|resupply|deploy|advance|block|protect)\b/i;

export function parseMissionOffsetSec(label: string): number | undefined {
  const match = label.match(/H\+(\d{1,3})(?::(\d{2}))?/i);
  if (!match) return undefined;
  const primary = Number(match[1]);
  const minutesPart = match[2] ? Number(match[2]) : undefined;
  if (minutesPart !== undefined) {
    return primary * 3600 + minutesPart * 60;
  }
  return primary * 60;
}

export function parseManualInstruction(
  instruction: string,
  target?: ManualSyncTarget,
  actorHint?: string,
  rowKeyOverride?: SyncGridRowKey
): ParsedManualInstruction {
  const text = instruction.trim();
  const missingFields: string[] = [];
  const actor =
    actorHint?.trim() ||
    text.match(/\b(\d-\d{2,3}[A-Z]?)\b/i)?.[1] ||
    text.match(/\b(team\s+[a-z0-9-]+|fighter[\w-]*|uav[\w-]*)\b/i)?.[1];

  const actionVerb = text.match(ACTION_VERBS)?.[1];
  const targetLabel =
    target?.entity ||
    text.match(/\b(objective\s+[A-Z]+|OBJ\s+[A-Z]+|node\s+[A-Z]+|PL\s+[A-Z]+|formation|radar site)\b/i)?.[0];

  let category: SyncMatrixCategory = "supporting-effort";
  const leading = text.match(/^\s*(cyber|info|information|isr|logistics|reserve|fires)\b/i)?.[1]?.toLowerCase();
  if (leading === "cyber") category = "cyber";
  else if (leading === "info" || leading === "information") category = "information";
  else if (leading === "isr") category = "isr";
  else if (leading === "logistics") category = "logistics";
  else if (leading === "reserve") category = "reserve";
  else if (leading === "fires") category = "fires";
  else {
    for (const entry of CATEGORY_KEYWORDS) {
      if (entry.pattern.test(text)) {
        category = entry.category;
        break;
      }
    }
  }

  const rowKey =
    rowKeyOverride ??
    parseRowKeyFromText(text) ??
    mapCategoryToRowKey(category, { label: text, actionType: actionVerb });

  const hMatches = [...text.matchAll(/H\+(\d{1,3})(?::(\d{2}))?/gi)];
  const timingUnresolved: TimingUnresolved[] = [];
  let startSec = 0;
  let durationSec = 15 * 60;
  let endSec: number | undefined;
  let endTimeLabel: string | undefined;

  if (hMatches.length >= 2) {
    const start = parseMissionOffsetSec(hMatches[0]![0]);
    const end = parseMissionOffsetSec(hMatches[1]![0]);
    if (start === undefined || end === undefined) {
      timingUnresolved.push("start", "duration");
      missingFields.push("timing");
    } else {
      startSec = start;
      endSec = end;
      durationSec = Math.max(60, end - start);
      endTimeLabel = hMatches[1]![0];
    }
  } else if (hMatches.length === 1) {
    const at = parseMissionOffsetSec(hMatches[0]![0]);
    const tickLabel = hMatches[0]![0];
    if (at === undefined) {
      timingUnresolved.push("start", "duration");
      missingFields.push("timing");
    } else if (/\bby\b/i.test(text)) {
      endTimeLabel = tickLabel;
      endSec = at;
      timingUnresolved.push("start", "duration");
      missingFields.push("start", "duration");
    } else if (/\bfrom\b/i.test(text) && /\bto\b/i.test(text)) {
      startSec = at;
      timingUnresolved.push("duration");
      missingFields.push("duration");
    } else if (/\bfrom\b/i.test(text)) {
      startSec = at;
      timingUnresolved.push("duration");
      missingFields.push("duration");
    } else {
      startSec = at;
      timingUnresolved.push("duration");
      missingFields.push("duration");
    }
  } else {
    timingUnresolved.push("start", "duration");
    missingFields.push("timing");
  }

  const startCondition = text.match(/\b(after|before|when)\s+(.+?)(?:\.|,|$)/i)?.[0];
  const dependency = text.match(/\b(depends on|after)\s+(.+?)(?:\.|,|$)/i)?.[2];

  if (!actor) missingFields.push("actor");
  if (!actionVerb) missingFields.push("action");
  if (!targetLabel) missingFields.push("target");

  const windowLabel = formatTimingWindowLabel({
    startSec,
    durationSec,
    endTimeLabel,
    endSec,
    timingUnresolved,
    missingFields,
  });

  const summaryParts = [actor, actionVerb, targetLabel, windowLabel].filter(Boolean);

  const status: SyncBarStatus =
    /\bcontingent|on order|be prepared\b/i.test(text) ? "contingent" : "planned";

  return {
    actor,
    actionVerb,
    target: targetLabel,
    startCondition,
    endTimeLabel,
    dependency,
    category,
    rowKey,
    startSec,
    durationSec,
    endSec,
    status,
    missingFields,
    timingUnresolved,
    summaryLabel: summaryParts.join(" · "),
  };
}

function formatTimingWindowLabel(input: {
  startSec: number;
  durationSec: number;
  endTimeLabel?: string;
  endSec?: number;
  timingUnresolved: TimingUnresolved[];
  missingFields: string[];
}): string {
  if (input.missingFields.includes("timing")) return "Timing required";
  if (input.timingUnresolved.includes("start") && input.timingUnresolved.includes("duration")) {
    return input.endTimeLabel
      ? `Deadline ${input.endTimeLabel} · Start & duration required`
      : "Start & duration required";
  }
  if (input.timingUnresolved.includes("duration")) {
    return `From ${formatMissionTick(input.startSec)} · Duration required`;
  }
  if (input.timingUnresolved.includes("start")) {
    return input.endTimeLabel
      ? `Complete by ${input.endTimeLabel} · Start time required`
      : "Start time required";
  }
  const endLabel =
    input.endTimeLabel ??
    (input.endSec !== undefined
      ? formatMissionTick(input.endSec)
      : formatMissionTick(input.startSec + input.durationSec));
  return `${formatMissionTick(input.startSec)} – ${endLabel}`;
}

/** Recompute missing fields and confirmed state from current entry values. */
export function validateManualEntry(entry: ManualSyncEntry): ManualSyncEntry {
  const missing: string[] = [];
  if (!entry.actor?.trim()) missing.push("actor");
  if (!entry.actionVerb?.trim()) missing.push("action");
  if (!entry.target?.trim()) missing.push("target");

  const unresolved = entry.timingUnresolved ?? [];
  if (unresolved.includes("start")) missing.push("start");
  if (unresolved.includes("duration") || unresolved.includes("end")) {
    missing.push("duration");
  }
  if (unresolved.length === 0 && !entry.endTimeLabel && entry.durationSec <= 0) {
    missing.push("timing");
  }

  const uniqueMissing = [...new Set(missing)];
  return {
    ...entry,
    missingFields: uniqueMissing,
    confirmed: uniqueMissing.length === 0,
  };
}

export function resolveDependencyBarId(option: {
  id: string;
  kind: string;
}): string | undefined {
  if (option.kind !== "task") return undefined;
  if (option.id.startsWith("task:")) return option.id.slice("task:".length);
  if (option.id.startsWith("manual:")) return option.id.slice("manual:".length);
  return undefined;
}

export function applyManualEntryPatch(
  entry: ManualSyncEntry,
  patch: Partial<
    Pick<
      ManualSyncEntry,
      | "startSec"
      | "durationSec"
      | "rowKey"
      | "category"
      | "subLabel"
      | "actor"
      | "target"
      | "targetFactId"
      | "actionVerb"
      | "status"
      | "dependency"
      | "dependencyBarId"
      | "startCondition"
      | "endTimeLabel"
      | "timingUnresolved"
    >
  >
): ManualSyncEntry {
  let timingUnresolved = [...(entry.timingUnresolved ?? [])];
  const next: ManualSyncEntry = {
    ...entry,
    origin: entry.origin === "user-added" ? "user-added" : "user-modified",
  };

  if (patch.actor !== undefined) next.actor = patch.actor;
  if (patch.target !== undefined) next.target = patch.target;
  if ("targetFactId" in patch) next.targetFactId = patch.targetFactId;
  if (patch.actionVerb !== undefined) next.actionVerb = patch.actionVerb;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.dependency !== undefined) next.dependency = patch.dependency;
  if (patch.dependencyBarId !== undefined) next.dependencyBarId = patch.dependencyBarId;
  if (patch.startCondition !== undefined) next.startCondition = patch.startCondition;
  if (patch.timingUnresolved !== undefined) timingUnresolved = [...patch.timingUnresolved];

  if (patch.startSec !== undefined) {
    next.startSec = patch.startSec;
    timingUnresolved = timingUnresolved.filter((field) => field !== "start");
    next.endTimeLabel = formatMissionTick(patch.startSec + next.durationSec);
  }

  if (patch.durationSec !== undefined) {
    next.durationSec = patch.durationSec;
    timingUnresolved = timingUnresolved.filter((field) => field !== "duration");
    next.endTimeLabel = formatMissionTick(next.startSec + patch.durationSec);
  }

  if (patch.endTimeLabel !== undefined) {
    next.endTimeLabel = patch.endTimeLabel;
  }

  if (patch.rowKey !== undefined) {
    next.rowKey = patch.rowKey;
    next.category = patch.category ?? rowKeyToLegacyCategory(patch.rowKey);
    next.subLabel = patch.subLabel ?? formatMatrixRowOption(patch.rowKey);
  } else if (patch.category !== undefined) {
    next.category = patch.category;
  }
  if (patch.subLabel !== undefined && patch.rowKey === undefined) {
    next.subLabel = patch.subLabel;
  }

  next.timingUnresolved = timingUnresolved;
  return validateManualEntry(next);
}

/**
 * One line per task instruction (newline-separated). Used for imported COA drafts.
 */
export function createImportedManualEntriesFromText(
  text: string,
  options?: { actorHint?: string }
): ManualSyncEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((instruction, index) => {
    const parsed = parseManualInstruction(
      instruction,
      undefined,
      options?.actorHint
    );
    return {
      id: `import-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      origin: "imported" as const,
      actor: parsed.actor,
      actionVerb: parsed.actionVerb,
      target: parsed.target,
      startCondition: parsed.startCondition,
      endTimeLabel: parsed.endTimeLabel,
      dependency: parsed.dependency,
      category: parsed.category,
      rowKey: parsed.rowKey,
      subLabel: formatMatrixRowOption(parsed.rowKey),
      startSec: parsed.startSec,
      durationSec: parsed.durationSec,
      status: parsed.status,
      confidence: "medium",
      source: "import" as const,
      missingFields: parsed.missingFields,
      timingUnresolved: parsed.timingUnresolved,
      instruction,
      confirmed: parsed.missingFields.length === 0,
    };
  });
}

export function createDraftManualEntryAtCell(input: {
  rowKey: SyncGridRowKey;
  startSec: number;
  durationSec: number;
}): ManualSyncEntry {
  const category = rowKeyToLegacyCategory(input.rowKey);
  const actionVerb = defaultActionVerbForRowKey(input.rowKey);
  return {
    id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    origin: "user-added",
    actionVerb,
    category,
    rowKey: input.rowKey,
    subLabel: formatMatrixRowOption(input.rowKey),
    startSec: input.startSec,
    durationSec: Math.max(60, input.durationSec),
    status: "planned",
    confidence: "medium",
    source: "matrix",
    missingFields: ["actor", "target"],
    timingUnresolved: [],
    confirmed: false,
  };
}

/** Build a confirmed manual entry from structured left-panel fields (not NL-only). */
export function buildManualEntryFromStructuredFields(fields: {
  actor: string;
  actionVerb: string;
  target: string;
  targetFactId?: string;
  rowKey: SyncGridRowKey;
  startSec: number;
  durationSec: number;
  endTimeLabel: string;
  dependency?: string;
  dependencyBarId?: string;
  instruction?: string;
  entryId?: string;
}): ManualSyncEntry {
  const category = rowKeyToLegacyCategory(fields.rowKey);
  const entry: ManualSyncEntry = {
    id: fields.entryId ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    origin: "user-added",
    actor: fields.actor.trim(),
    actionVerb: fields.actionVerb.trim(),
    target: fields.target.trim(),
    targetFactId: fields.targetFactId,
    dependency: fields.dependency?.trim() || undefined,
    dependencyBarId: fields.dependencyBarId,
    category,
    rowKey: fields.rowKey,
    subLabel: formatMatrixRowOption(fields.rowKey),
    startSec: fields.startSec,
    durationSec: Math.max(60, fields.durationSec),
    endTimeLabel: fields.endTimeLabel,
    status: "planned",
    confidence: "medium",
    source: fields.targetFactId ? "map" : "matrix",
    timingUnresolved: [],
    instruction: fields.instruction?.trim() || undefined,
    missingFields: [],
    confirmed: false,
  };
  return validateManualEntry(entry);
}

export function createManualEntryFromInstruction(
  instruction: string,
  target: ManualSyncTarget | undefined,
  actorHint?: string,
  rowKey?: SyncGridRowKey
): ManualSyncEntry {
  const parsed = parseManualInstruction(instruction, target, actorHint, rowKey);
  const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    origin: "user-added",
    actor: parsed.actor,
    actionVerb: parsed.actionVerb,
    target: parsed.target ?? target?.entity,
    targetFactId: target?.factId,
    startCondition: parsed.startCondition,
    endTimeLabel: parsed.endTimeLabel,
    dependency: parsed.dependency,
    category: parsed.category,
    rowKey: parsed.rowKey,
    subLabel: formatMatrixRowOption(parsed.rowKey),
    startSec: parsed.startSec,
    durationSec: parsed.durationSec,
    status: parsed.status,
    confidence: "medium",
    source: target ? "map" : "matrix",
    missingFields: parsed.missingFields,
    timingUnresolved: parsed.timingUnresolved,
    instruction,
    confirmed: parsed.missingFields.length === 0,
  };
}

export function manualEntryToBarLabel(entry: ManualSyncEntry): string {
  const timingNote =
    entry.missingFields.includes("timing") ||
    entry.missingFields.includes("start") ||
    entry.missingFields.includes("duration")
      ? "Timing required"
      : undefined;
  if (timingNote) {
    return `${entry.actionVerb ?? "Task"} ${entry.target ?? ""} · ${timingNote}`.trim();
  }
  return [entry.actor, entry.actionVerb, entry.target].filter(Boolean).join(" ");
}

export function originLabel(origin: SyncTaskOrigin): string {
  switch (origin) {
    case "system-generated":
      return "System generated";
    case "user-added":
      return "User added";
    case "user-modified":
      return "User modified";
    case "imported":
      return "Imported";
    case "contingent":
      return "Contingent";
  }
}
