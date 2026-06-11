import {
  formatMatrixRowOption,
  mapCategoryToRowKey,
  syncGridRowLabel,
  type SyncGridRowKey,
} from "./syncGridSchema";
import type { ChipAssessment } from "./matrixQuality";
import { qualityToSyncStatus, type SyncBarStatus, type SyncMatrixBar } from "./syncMatrix";
import type { LogisticsChip, LogisticsPlan } from "./types";

const ACTION_VERB_PATTERN =
  /\b(secure|maintain|disrupt|jam|establish|reinforce|screen|suppress|observe|monitor|coordinate|resupply|deploy|advance|block|protect|investigate|inform|harden|strike)\b/i;

export function aggregateChipsByAction(
  chips: LogisticsChip[]
): Map<string, LogisticsChip> {
  const groups = new Map<string, LogisticsChip[]>();
  for (const chip of chips) {
    const list = groups.get(chip.actionId) ?? [];
    list.push(chip);
    groups.set(chip.actionId, list);
  }

  const merged = new Map<string, LogisticsChip>();
  for (const [actionId, group] of groups) {
    merged.set(actionId, mergeChipGroup(group));
  }
  return merged;
}

function mergeChipGroup(chips: LogisticsChip[]): LogisticsChip {
  const first = chips[0]!;
  const startOffset = Math.min(...chips.map((chip) => chip.startOffset));
  const endOffset = Math.max(
    ...chips.map((chip) => chip.startOffset + chip.duration)
  );
  const sceneSummaries = chips
    .map((chip) => chip.sceneSummary)
    .filter((value): value is string => Boolean(value?.trim()));
  return {
    ...first,
    startOffset,
    duration: Math.max(endOffset - startOffset, first.duration, 60),
    dependencies: [...new Set(chips.flatMap((chip) => chip.dependencies))],
    resourceIds: [...new Set(chips.flatMap((chip) => chip.resourceIds ?? []))],
    citedFactIds: [...new Set(chips.flatMap((chip) => chip.citedFactIds ?? []))],
    linkedFactIds: [...new Set(chips.flatMap((chip) => chip.linkedFactIds ?? []))],
    sceneEntities: [...new Set(chips.flatMap((chip) => chip.sceneEntities ?? []))],
    sceneDomains: [...new Set(chips.flatMap((chip) => chip.sceneDomains ?? []))],
    sceneSummary: sceneSummaries[0] ?? first.sceneSummary,
    timingUncertain: chips.some((chip) => chip.timingUncertain),
  };
}

export function mergeChipAssessments(
  chips: LogisticsChip[],
  assessments: Map<string, ChipAssessment>
): ChipAssessment {
  const qualityRank: Record<ChipAssessment["level"], number> = {
    green: 0,
    yellow: 1,
    red: 2,
  };
  let worst: ChipAssessment["level"] = "green";
  const reasons = new Set<string>();
  const fixes = new Set<string>();

  for (const chip of chips) {
    const assessment = assessments.get(chip.id) ?? {
      level: "green" as const,
      reasons: [],
      fixes: [],
    };
    if (qualityRank[assessment.level] > qualityRank[worst]) {
      worst = assessment.level;
    }
    for (const reason of assessment.reasons) reasons.add(reason);
    for (const fix of assessment.fixes) fixes.add(fix);
  }

  return { level: worst, reasons: [...reasons], fixes: [...fixes] };
}

export function resolveChipTargetFactIds(chip: LogisticsChip): string[] | undefined {
  const linked = chip.linkedFactIds ?? [];
  const cited = chip.citedFactIds ?? [];
  const merged = [...new Set([...linked, ...cited])];
  return merged.length > 0 ? merged : undefined;
}

export function buildSystemSyncBar(input: {
  chip: LogisticsChip;
  assessment: ChipAssessment;
  chipById: Map<string, LogisticsChip>;
  coaLabel: string;
  modifiedIds: Set<string>;
}): SyncMatrixBar {
  const { chip, assessment, chipById, coaLabel, modifiedIds } = input;

  const category = resolveCategoryFromChip(chip);
  const rowKey = mapCategoryToRowKey(category, chip);
  const actor = formatActorFromResources(chip);
  const actionVerb = extractActionVerb(chip);
  const target = extractTarget(chip);
  const missingFields = buildMissingFields(chip, assessment);
  const status: SyncBarStatus = missingFields.includes("timing")
    ? "contingent"
    : qualityToSyncStatus(assessment.level);

  const dependencyLabels = chip.dependencies
    .map((depId) => {
      const dep = chipById.get(depId);
      return dep ? extractActionVerb(dep) || dep.label : depId;
    })
    .filter(Boolean);

  const triggerLabel =
    dependencyLabels.length > 0
      ? `After ${dependencyLabels[0]}`
      : undefined;

  return {
    id: chip.id,
    actionId: chip.actionId,
    label: chip.label,
    subLabel: syncGridRowLabel(rowKey),
    startSec: chip.startOffset,
    durationSec: Math.max(chip.duration, 10 * 60),
    status,
    dependencies: [...chip.dependencies],
    dependencyLabels,
    resourceLabel: chip.resourceIds?.[0],
    reasons: assessment.reasons,
    fixes: assessment.fixes,
    origin: modifiedIds.has(chip.id) ? "user-modified" : "system-generated",
    targetFactIds: resolveChipTargetFactIds(chip),
    missingFields,
    rowKey,
    actor,
    target,
    actionVerb,
    startCondition: triggerLabel,
    operationalFunction: formatMatrixRowOption(rowKey),
    sourceLabel: `System generated — ${coaLabel}`,
    isManual: false,
  };
}

function buildMissingFields(
  chip: LogisticsChip,
  assessment: ChipAssessment
): string[] {
  const missing = new Set<string>();
  if (chip.duration <= 0) {
    missing.add("timing");
  }
  if (!formatActorFromResources(chip)) {
    missing.add("actor");
  }
  if (!extractActionVerb(chip)) {
    missing.add("action");
  }
  if (!extractTarget(chip)) {
    missing.add("target");
  }
  if (assessment.level === "red" && assessment.reasons.some((r) => /fact/i.test(r))) {
    missing.add("evidence");
  }
  return [...missing];
}

export function formatActorFromResources(chip: LogisticsChip): string | undefined {
  const resources = chip.resourceIds ?? [];
  const primary = resources.find(
    (id) => id !== "command-element" && id !== "general-asset" && id !== "unassigned-asset"
  );
  if (primary) {
    const unit = formatResourceAsUnit(primary);
    if (unit) return unit;
  }

  const unitMatch = chip.label.match(/\b(\d-\d{2,3}[A-Z]?)\b/i);
  if (unitMatch?.[1]) return unitMatch[1];

  if (resources[0] === "command-element") return "Command Element";
  return undefined;
}

function formatResourceAsUnit(resourceId: string): string | undefined {
  const normalized = resourceId.replace(/_/g, "-");
  if (/^\d-\d+/i.test(normalized)) return normalized;
  const parts = normalized.split("-").filter(Boolean);
  if (parts.length === 0) return undefined;
  if (/^\d+$/.test(parts[0]!) && parts[1]) {
    return `${parts[0]}-${parts[1]}${parts[2] ? parts[2].toUpperCase() : ""}`;
  }
  return parts
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

export function extractActionVerb(chip: LogisticsChip): string | undefined {
  const fromLabel = chip.label.match(ACTION_VERB_PATTERN)?.[1];
  if (fromLabel) return capitalize(fromLabel);

  const type = chip.actionType?.toLowerCase();
  const typeMap: Record<string, string> = {
    observe: "Observe",
    monitor: "Monitor",
    coordinate: "Coordinate",
    preserve: "Screen",
    inform: "Inform",
    harden: "Harden",
    movement: "Advance",
    maneuver: "Maneuver",
    strike: "Strike",
    fires: "Suppress",
    investigate: "Investigate",
    cyber: "Disrupt",
    information: "Inform",
  };
  if (type && typeMap[type]) return typeMap[type];
  return undefined;
}

export function extractTarget(chip: LogisticsChip): string | undefined {
  const entity = chip.sceneEntities?.[0];
  if (entity) {
    const objective = entity.match(/\b(OBJ\s*\w+|Objective\s*\w+)/i)?.[0];
    return objective ?? entity;
  }

  const fromSummary = chip.sceneSummary?.split(":")[0]?.trim();
  if (fromSummary) return fromSummary;

  const fromLabel = chip.label.match(
    /\b(objective\s+\w+|OBJ\s+\w+|PL\s+\w+|node\s+\w+|radar site|formation)\b/i
  )?.[0];
  return fromLabel ? capitalizePhrase(fromLabel) : undefined;
}

function resolveCategoryFromChip(chip: LogisticsChip): import("./syncGridSchema").SyncMatrixCategory {
  const domains = (chip.sceneDomains ?? []).map((d) => d.toLowerCase());
  const actionType = (chip.actionType ?? "other").toLowerCase();
  const label = chip.label.toLowerCase();

  if (/monitor|observe|surveillance|isr|orbit|collection/.test(label)) return "isr";
  if (/info ops|information ops|influence|counter rumor|public message/.test(label)) {
    return "information";
  }
  if (/wait for|further information|report/.test(label) && actionType !== "inform") {
    return "supporting-effort";
  }

  switch (actionType) {
    case "observe":
    case "monitor":
      return "isr";
    case "investigate":
      if (domains.some((d) => d.includes("cyber")) || /cyber|authentication|forensic|siem/.test(label)) {
        return "cyber";
      }
      return "isr";
    case "preserve":
      return "security";
    case "inform":
      return "information";
    case "harden":
      return "cyber";
    case "coordinate":
      return "supporting-effort";
    case "strike":
    case "fires":
      return "fires";
    case "movement":
    case "maneuver":
      return "main-effort";
  }

  if (domains.some((d) => d.includes("cyber"))) return "cyber";
  if (/inform|influence|message|rumor/.test(label)) return "information";
  if (/fires|strike|suppress/.test(label)) return "fires";
  if (/logistics|fuel|resupply|casevac/.test(label)) return "logistics";
  if (/screen|secure|preserve/.test(label)) return "security";
  if (/reserve|reinforce on order|be prepared/.test(label)) return "reserve";
  if (/maneuver|advance|deploy|intercept/.test(label)) return "main-effort";
  return "supporting-effort";
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function capitalizePhrase(text: string): string {
  return text.replace(/\b\w+/g, (part) => capitalize(part));
}

export function resolveCoaMatrixLabel(
  plan: Extract<LogisticsPlan, { kind: "populated" }>,
  coaLabel?: string
): string {
  if (coaLabel?.trim()) return coaLabel.trim();
  const match = plan.coaId.match(/coa-(\d+)/i);
  if (match?.[1]) return `COA ${match[1]}`;
  return "COA";
}
