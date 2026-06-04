import type { ObservedFact } from "../../intel/types";
import type { ManualSyncEntry } from "../../coa/manualSync";
import type { SyncMatrixBar } from "../../coa/syncMatrix";
import { isSensorEntityFact } from "../../scene/sensors";
import type { OverviewTrack } from "./types";

export type MapDisplayKind = "threat" | "sensor" | "friendly" | "unknown";

const OBJECTIVE_DOMAINS = new Set(["information", "logistics", "space"]);

/** Same side rules as overview tracks in App.buildSceneContacts. */
export function contactSideFromFact(fact: ObservedFact): OverviewTrack["side"] {
  if (isSensorEntityFact(fact)) return "friendly";
  if (
    fact.domain === "UAS" &&
    (fact.severity === "high" || fact.severity === "critical")
  ) {
    return "hostile";
  }
  if (fact.severity === "high" || fact.severity === "critical") {
    return "hostile";
  }
  return "unknown";
}

/** Map halo color — aligned with contact side / role, not raw domain alone. */
export function classifyMapDisplayKind(fact: ObservedFact): MapDisplayKind {
  if (isSensorEntityFact(fact)) return "sensor";
  const side = contactSideFromFact(fact);
  if (side === "hostile") return "threat";
  if (OBJECTIVE_DOMAINS.has(fact.domain)) return "friendly";
  if (fact.domain === "ground") return "friendly";
  if (side === "unknown") return "unknown";
  return "friendly";
}

export function isObjectiveDomain(domain?: string): boolean {
  return domain ? OBJECTIVE_DOMAINS.has(domain.toLowerCase()) : false;
}

export type SceneObjectKind = "contact" | "fact" | "task" | "verb" | "asset";

/** Map symbology: green/blue = controllable, grey = unknown, red = threat. */
export type SceneAffiliation = "controllable" | "unknown" | "threat";

/** Which scene objects a picker field may assign. */
export type SceneSelectableRole = "controllable" | "objective";

export type SceneObjectOption = {
  id: string;
  label: string;
  entity: string;
  event?: string;
  domain?: string;
  factId?: string;
  kind: SceneObjectKind;
  affiliation?: SceneAffiliation;
};

const TASK_VERBS = [
  "Secure",
  "Maintain",
  "Suppress",
  "Observe",
  "Monitor",
  "Coordinate",
  "Disrupt",
  "Establish",
  "Screen",
  "Advance",
  "Protect",
  "Resupply",
  "Deploy",
  "Strike",
  "Investigate",
] as const;

export const VERB_GROUPS: { label: string; verbs: readonly string[] }[] = [
  { label: "Maneuver", verbs: ["Advance", "Deploy", "Establish", "Screen"] },
  { label: "Fires & effects", verbs: ["Strike", "Suppress", "Disrupt"] },
  { label: "Protection", verbs: ["Secure", "Protect", "Maintain"] },
  { label: "ISR", verbs: ["Observe", "Monitor", "Investigate"] },
  { label: "Support & C2", verbs: ["Coordinate", "Resupply"] },
];

export type SceneOptionGroup = {
  label: string;
  options: SceneObjectOption[];
};

/** Mirrors situational map threat / sensor / friendly classification. */
export function classifyFactAffiliation(fact: ObservedFact): SceneAffiliation {
  if (isSensorEntityFact(fact)) return "controllable";
  if (
    fact.domain === "UAS" ||
    fact.domain === "maritime" ||
    fact.domain === "air" ||
    fact.severity === "high" ||
    fact.severity === "critical"
  ) {
    return "threat";
  }
  return "controllable";
}

export function classifyTrackAffiliation(track: OverviewTrack): SceneAffiliation {
  if (track.side === "hostile") return "threat";
  if (track.side === "unknown") return "unknown";
  return "controllable";
}

/** When seeding the matrix task author from a map/scene selection. */
export function sceneSelectionComposerRole(option: SceneObjectOption): "actor" | "target" {
  if (option.affiliation === "threat") return "target";
  if (isObjectiveDomain(option.domain)) return "target";
  return "actor";
}

export function findSceneOptionForFactId(
  factId: string,
  options: SceneObjectOption[]
): SceneObjectOption | undefined {
  return options.find(
    (opt) =>
      opt.factId === factId || opt.id === `track:${factId}` || opt.id === `fact:${factId}`
  );
}

function isActorEligibleOption(option: SceneObjectOption): boolean {
  if (option.kind === "asset") return true;
  if (option.kind === "contact") {
    if (option.affiliation === "threat") return false;
    if (isObjectiveDomain(option.domain)) return false;
    return option.affiliation === "controllable" || option.affiliation === "unknown";
  }
  if (option.kind === "fact") {
    if (option.affiliation === "threat" || isObjectiveDomain(option.domain)) return false;
    return option.affiliation === "controllable";
  }
  return false;
}

export function isSceneOptionSelectable(
  option: SceneObjectOption,
  role?: SceneSelectableRole,
  kinds?: SceneObjectKind[]
): boolean {
  if (kinds && kinds.length > 0 && !kinds.includes(option.kind)) return false;
  if (option.kind === "verb" || option.kind === "task") return true;
  if (!role) return true;
  if (role === "controllable") {
    return isActorEligibleOption(option);
  }
  return option.kind === "fact" || option.kind === "contact";
}

export function buildSceneObjectOptions(input: {
  facts: ObservedFact[];
  tracks: OverviewTrack[];
  matrixBars?: SyncMatrixBar[];
  manualEntries?: ManualSyncEntry[];
  knownAssets?: string[];
}): SceneObjectOption[] {
  const seen = new Set<string>();
  const options: SceneObjectOption[] = [];

  const push = (option: SceneObjectOption) => {
    if (seen.has(option.id)) return;
    seen.add(option.id);
    options.push(option);
  };

  const factById = new Map(input.facts.map((fact) => [fact.id, fact]));

  for (const track of input.tracks) {
    const affiliation = classifyTrackAffiliation(track);
    const sourceFact = factById.get(track.id);
    push({
      id: `track:${track.id}`,
      label: `${track.callsign} · ${track.classification}`,
      entity: track.callsign,
      event: track.summary,
      domain: sourceFact?.domain ?? track.classification,
      factId: track.id,
      kind: "contact",
      affiliation,
    });
  }

  for (const fact of input.facts) {
    push({
      id: `fact:${fact.id}`,
      label: `${fact.domain} · ${fact.entity}${fact.event ? ` — ${fact.event}` : ""}`,
      entity: fact.entity,
      event: fact.event,
      domain: fact.domain,
      factId: fact.id,
      kind: "fact",
      affiliation: classifyFactAffiliation(fact),
    });
  }

  for (const asset of input.knownAssets ?? []) {
    const trimmed = asset.trim();
    if (!trimmed) continue;
    push({
      id: `asset:${trimmed.toLowerCase()}`,
      label: `Asset · ${trimmed}`,
      entity: trimmed,
      kind: "asset",
      affiliation: "controllable",
    });
  }

  for (const bar of input.matrixBars ?? []) {
    const label = [bar.actor, bar.actionVerb, bar.target].filter(Boolean).join(" ");
    if (!label.trim()) continue;
    push({
      id: `task:${bar.id}`,
      label: `Task · ${label}`,
      entity: bar.target ?? bar.actor ?? bar.label,
      event: bar.actionVerb,
      kind: "task",
      affiliation: "controllable",
    });
  }

  for (const entry of input.manualEntries ?? []) {
    const label = [entry.actor, entry.actionVerb, entry.target].filter(Boolean).join(" ");
    if (!label.trim()) continue;
    push({
      id: `manual:${entry.id}`,
      label: `Manual · ${label}`,
      entity: entry.target ?? entry.actor ?? label,
      event: entry.actionVerb,
      factId: entry.targetFactId,
      kind: "task",
      affiliation: "controllable",
    });
  }

  const verbSet = new Set<string>(TASK_VERBS);

  for (const verb of verbSet) {
    push({
      id: `verb:${verb.toLowerCase()}`,
      label: verb,
      entity: verb,
      event: verb,
      kind: "verb",
    });
  }

  return options;
}

export function sceneOptionFromFactId(
  factId: string,
  options: SceneObjectOption[],
  facts: ObservedFact[]
): SceneObjectOption | undefined {
  const trackOption = options.find((opt) => opt.id === `track:${factId}`);
  if (trackOption) return trackOption;
  const direct = options.find((opt) => opt.factId === factId || opt.id === `fact:${factId}`);
  if (direct) return direct;
  const fact = facts.find((item) => item.id === factId);
  if (!fact) return undefined;
  return {
    id: `fact:${fact.id}`,
    label: `${fact.domain} · ${fact.entity}${fact.event ? ` — ${fact.event}` : ""}`,
    entity: fact.entity,
    event: fact.event,
    domain: fact.domain,
    factId: fact.id,
    kind: "fact",
    affiliation: classifyFactAffiliation(fact),
  };
}

export function resolveOptionMapFactId(option: SceneObjectOption): string | undefined {
  if (option.kind === "contact" || option.kind === "fact") {
    return option.factId;
  }
  if (option.kind === "task" && option.factId) {
    return option.factId;
  }
  return undefined;
}

export function filterSceneOptions(
  options: SceneObjectOption[],
  kinds?: SceneObjectKind[],
  role?: SceneSelectableRole
): SceneObjectOption[] {
  return options.filter((opt) => isSceneOptionSelectable(opt, role, kinds));
}

function sortOptions(options: SceneObjectOption[]): SceneObjectOption[] {
  return [...options].sort((a, b) => a.label.localeCompare(b.label));
}

function domainSectionLabel(domain?: string): string {
  if (!domain) return "Other";
  switch (domain.toLowerCase()) {
    case "uas":
      return "UAS";
    case "maritime":
      return "Maritime";
    case "air":
    case "unknown-air":
      return "Air";
    case "ground":
      return "Ground";
    case "cyber":
      return "Cyber";
    case "signals":
    case "signal-source":
      return "Signals / sensors";
    case "information":
      return "Information";
    case "space":
      return "Space";
    case "logistics":
      return "Logistics";
    default:
      return domain.charAt(0).toUpperCase() + domain.slice(1);
  }
}

function pushGroup(
  groups: SceneOptionGroup[],
  label: string,
  options: SceneObjectOption[]
): void {
  if (options.length === 0) return;
  groups.push({ label, options: sortOptions(options) });
}

function groupVerbOptions(options: SceneObjectOption[]): SceneOptionGroup[] {
  const byLabel = new Map(options.map((opt) => [opt.label, opt]));
  const groups: SceneOptionGroup[] = [];
  const placed = new Set<string>();

  for (const section of VERB_GROUPS) {
    const sectionOptions = section.verbs
      .map((verb) => byLabel.get(verb))
      .filter((opt): opt is SceneObjectOption => Boolean(opt));
    sectionOptions.forEach((opt) => placed.add(opt.id));
    pushGroup(groups, section.label, sectionOptions);
  }

  const remainder = options.filter((opt) => !placed.has(opt.id));
  pushGroup(groups, "Other actions", remainder);
  return groups;
}

function groupTaskOptions(options: SceneObjectOption[]): SceneOptionGroup[] {
  const groups: SceneOptionGroup[] = [];
  pushGroup(
    groups,
    "COA / system tasks",
    options.filter((opt) => opt.id.startsWith("task:"))
  );
  pushGroup(
    groups,
    "Manual tasks",
    options.filter((opt) => opt.id.startsWith("manual:"))
  );
  const other = options.filter(
    (opt) => !opt.id.startsWith("task:") && !opt.id.startsWith("manual:")
  );
  pushGroup(groups, "Other tasks", other);
  return groups;
}

function groupControllableOptions(options: SceneObjectOption[]): SceneOptionGroup[] {
  const groups: SceneOptionGroup[] = [];
  pushGroup(
    groups,
    "Known assets",
    options.filter((opt) => opt.kind === "asset")
  );
  pushGroup(
    groups,
    "Friendly contacts (green)",
    options.filter((opt) => opt.kind === "contact" && opt.affiliation === "controllable")
  );
  pushGroup(
    groups,
    "Unknown contacts (grey)",
    options.filter((opt) => opt.kind === "contact" && opt.affiliation === "unknown")
  );
  return groups;
}

function groupFactsByDomain(facts: SceneObjectOption[], prefix: string): SceneOptionGroup[] {
  const byDomain = new Map<string, SceneObjectOption[]>();
  for (const fact of facts) {
    const key = domainSectionLabel(fact.domain);
    const bucket = byDomain.get(key) ?? [];
    bucket.push(fact);
    byDomain.set(key, bucket);
  }
  return [...byDomain.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, domainFacts]) => ({
      label: `${prefix}${label}`,
      options: sortOptions(domainFacts),
    }));
}

function groupObjectiveOptions(options: SceneObjectOption[]): SceneOptionGroup[] {
  const groups: SceneOptionGroup[] = [];
  const contacts = options.filter((opt) => opt.kind === "contact");
  const facts = options.filter((opt) => opt.kind === "fact");
  const tasks = options.filter((opt) => opt.kind === "task");

  pushGroup(
    groups,
    "Threat contacts (red)",
    contacts.filter((opt) => opt.affiliation === "threat")
  );
  pushGroup(
    groups,
    "Unknown contacts (grey)",
    contacts.filter((opt) => opt.affiliation === "unknown")
  );
  pushGroup(
    groups,
    "Friendly contacts (green)",
    contacts.filter((opt) => opt.affiliation === "controllable")
  );

  const threatFacts = facts.filter((opt) => opt.affiliation === "threat");
  const otherFacts = facts.filter((opt) => opt.affiliation !== "threat");
  groups.push(...groupFactsByDomain(threatFacts, "Threat · "));
  groups.push(...groupFactsByDomain(otherFacts, "Objective · "));

  pushGroup(
    groups,
    "COA / system tasks",
    tasks.filter((opt) => opt.id.startsWith("task:"))
  );
  pushGroup(
    groups,
    "Manual tasks",
    tasks.filter((opt) => opt.id.startsWith("manual:"))
  );

  return groups;
}

function groupMixedOptions(options: SceneObjectOption[]): SceneOptionGroup[] {
  const groups: SceneOptionGroup[] = [];
  const verbs = options.filter((opt) => opt.kind === "verb");
  const tasks = options.filter((opt) => opt.kind === "task");
  const nonVerbs = options.filter((opt) => opt.kind !== "verb" && opt.kind !== "task");

  if (verbs.length > 0) {
    groups.push(...groupVerbOptions(verbs));
  }
  if (nonVerbs.length > 0) {
    groups.push(...groupObjectiveOptions(nonVerbs));
  }
  if (tasks.length > 0) {
    groups.push(...groupTaskOptions(tasks));
  }
  return groups;
}

/** User-facing reason a map object cannot fill the armed picker field. */
export function scenePickRejectMessage(
  option: SceneObjectOption,
  role?: SceneSelectableRole,
  kinds?: SceneObjectKind[]
): string {
  if (isSceneOptionSelectable(option, role, kinds)) return "";
  if (role === "controllable" && isObjectiveDomain(option.domain)) {
    return "Information, logistics, and space objectives belong under Target — use Pick from Map on the Target card.";
  }
  if (role === "controllable" && option.affiliation === "threat") {
    return "Threat contacts (red) belong under Target, not Acting unit.";
  }
  if (role === "controllable" && option.kind === "fact") {
    return "Use a grey unknown contact or green ground/cyber unit — or assign this objective under Target.";
  }
  if (role === "objective" && option.kind === "asset") {
    return "Known assets are acting units — use Acting unit / Actor instead.";
  }
  return "That map object cannot fill this field — try another marker or use Search.";
}

/** Organize filtered picker options into labeled sections for optgroup rendering. */
export function groupSceneOptions(options: SceneObjectOption[]): SceneOptionGroup[] {
  if (options.length === 0) return [];

  const kinds = new Set(options.map((opt) => opt.kind));
  if (kinds.size === 1 && kinds.has("verb")) {
    return groupVerbOptions(options);
  }
  if (kinds.size === 1 && kinds.has("task")) {
    return groupTaskOptions(options);
  }
  if ([...kinds].every((kind) => kind === "contact" || kind === "asset")) {
    return groupControllableOptions(options);
  }
  if (kinds.has("fact") || kinds.has("contact")) {
    return groupObjectiveOptions(options);
  }
  return groupMixedOptions(options);
}
