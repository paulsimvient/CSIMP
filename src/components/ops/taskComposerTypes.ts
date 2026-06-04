import type { SceneObjectOption } from "./sceneObjects";
import type { SyncMatrixBar } from "../../coa/syncMatrix";
import type { ObservedFact } from "../../intel/types";

export type TaskObjectRole = "actor" | "target";

export type TaskObjectRef = {
  entity: string;
  /** Full picker label (domain · entity — event) for cards and dropdowns. */
  label?: string;
  factId?: string;
  domain?: string;
  subtitle?: string;
  optionId?: string;
};

export function taskObjectFromOption(option: SceneObjectOption): TaskObjectRef {
  return {
    entity: option.entity,
    label: option.label,
    factId: option.factId,
    domain: option.domain,
    subtitle: option.event ?? option.domain,
    optionId: option.id,
  };
}

export function resolveTaskObjectSubtitle(
  ref: TaskObjectRef | null,
  facts: ObservedFact[]
): string | undefined {
  if (!ref) return undefined;
  if (ref.subtitle) return ref.subtitle;
  if (!ref.factId) return ref.domain;
  const fact = facts.find((item) => item.id === ref.factId);
  if (!fact) return ref.domain;
  return fact.event ?? fact.domain;
}

export function taskObjectFromBarField(
  entity: string | undefined,
  factId: string | undefined,
  facts: ObservedFact[],
  role: TaskObjectRole
): TaskObjectRef | null {
  if (!entity?.trim()) return null;
  const fact = factId ? facts.find((item) => item.id === factId) : undefined;
  return {
    entity,
    factId,
    domain: fact?.domain,
    subtitle:
      role === "actor"
        ? fact?.domain
          ? `${fact.domain} unit`
          : "Friendly maneuver unit"
        : fact?.event ?? fact?.domain ?? "Objective",
    optionId: factId ? `fact:${factId}` : undefined,
  };
}

export function loadTaskComposerFromBar(
  bar: SyncMatrixBar,
  facts: ObservedFact[]
): {
  actor: TaskObjectRef | null;
  target: TaskObjectRef | null;
  action: string;
} {
  const targetFactId = bar.targetFactIds?.[0];
  return {
    actor: taskObjectFromBarField(bar.actor, undefined, facts, "actor"),
    target: taskObjectFromBarField(bar.target, targetFactId, facts, "target"),
    action: bar.actionVerb ?? "",
  };
}
