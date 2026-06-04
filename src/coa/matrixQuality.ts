import type { LogisticsChip, LogisticsLane, LogisticsPlan } from "./types";

export type MatrixQuality = "red" | "yellow" | "green";

export type ChipAssessment = {
  level: MatrixQuality;
  reasons: string[];
  fixes: string[];
};

export type MatrixQualityContext = {
  blockedDetail?: string;
  generationError?: string;
  selectedCoaStatus?: string;
  pipelineStatus?: string;
};

export function assessChip(
  chip: LogisticsChip,
  context?: MatrixQualityContext,
  provisional?: boolean
): ChipAssessment {
  void provisional;
  const reasons: string[] = [];
  const fixes: string[] = [];
  let level: MatrixQuality = "green";
  const linkedFacts = chip.linkedFactIds?.length ?? chip.citedFactIds?.length ?? 0;

  if (linkedFacts === 0) {
    level = "red";
    reasons.push("No grounded fact links for this action.");
    fixes.push("Add or validate citations so this action is evidence-backed.");
  }

  if (chip.timingUncertain) {
    if (level === "green") level = "yellow";
    reasons.push("Start/end time not confirmed for this action.");
    fixes.push("Set H+ start and end before execution.");
  }

  if (chip.duration <= 0) {
    level = "red";
    reasons.push("Action duration is invalid.");
    fixes.push("Set a positive duration before regenerating.");
  }

  if ((chip.resourceIds?.length ?? 0) === 0 && level !== "red") {
    level = "yellow";
    reasons.push("No explicit asset assignment.");
    fixes.push("Assign a concrete unit/asset to reduce execution ambiguity.");
  }

  if ((chip.dependencies?.length ?? 0) === 0 && chip.startOffset > 0 && level === "green") {
    level = "yellow";
    reasons.push("No upstream dependency despite delayed start.");
    fixes.push("Link this action to prerequisite actions or facts.");
  }

  if (
    context?.blockedDetail &&
    /blocking|no executable|unsat/i.test(context.blockedDetail) &&
    level === "green"
  ) {
    level = "yellow";
    reasons.push("Solver is blocked for at least one plan constraint.");
    fixes.push("Resolve the blocker in Step 02, then regenerate COAs.");
  }

  return { level, reasons, fixes };
}

export function buildChipAssessments(
  plan: Extract<LogisticsPlan, { kind: "populated" }>,
  context?: MatrixQualityContext,
  provisional?: boolean
): Map<string, ChipAssessment> {
  const assessments = new Map(
    plan.chips.map((chip) => [chip.id, assessChip(chip, context, provisional)])
  );

  for (const lane of plan.lanes) {
    const laneChips = plan.chips.filter((chip) => chip.laneId === lane.id);
    markLaneOverlaps(laneChips, assessments);
  }

  return assessments;
}

function markLaneOverlaps(
  laneChips: LogisticsChip[],
  assessments: Map<string, ChipAssessment>
): void {
  for (let i = 0; i < laneChips.length; i++) {
    for (let j = i + 1; j < laneChips.length; j++) {
      const a = laneChips[i]!;
      const b = laneChips[j]!;
      const aEnd = a.startOffset + a.duration;
      const bEnd = b.startOffset + b.duration;
      if (a.startOffset >= bEnd || b.startOffset >= aEnd) continue;

      for (const chip of [a, b]) {
        const current = assessments.get(chip.id)!;
        if (current.level === "red") continue;
        assessments.set(chip.id, {
          level: "red",
          reasons: [
            ...current.reasons,
            "Overlaps another action on the same resource lane.",
          ],
          fixes: [
            ...current.fixes,
            "Reschedule or split tasks so the same asset is not double-booked.",
          ],
        });
      }
    }
  }
}
