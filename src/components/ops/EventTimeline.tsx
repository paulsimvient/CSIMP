import { useState } from "react";
import type { ObservedFact } from "../../intel/types";
import type { MessageTrafficItem, OverviewTrack } from "./types";
import styles from "../../App.module.css";

type TimelineFilter = "all" | "threats" | "sensors" | "decisions" | "system";

export function resolveTimelineFactId(
  item: MessageTrafficItem,
  tracks: OverviewTrack[],
  facts: ObservedFact[] = []
): string | undefined {
  if (item.factId) return item.factId;
  const lifecycleMatch = item.id.match(/^lifecycle-(.+?)-(?:new|tracking|lost|fresh|warm|stale|[a-z-]+)-/i);
  if (lifecycleMatch?.[1]) return lifecycleMatch[1];
  if (item.id.startsWith("fact-")) return item.id.slice("fact-".length);
  const actionMatch = item.id.match(/^action-(.+)$/);
  if (actionMatch?.[1]) {
    const citedInText = facts.find((fact) => item.text.includes(fact.entity));
    if (citedInText) return citedInText.id;
  }
  for (const track of tracks) {
    if (item.id.includes(`lifecycle-${track.id}-`)) return track.id;
    if (item.text.includes(track.callsign)) return track.id;
  }
  for (const fact of facts) {
    if (item.id.includes(fact.id) || item.text.includes(fact.entity) || item.text.includes(fact.event)) {
      return fact.id;
    }
  }
  return undefined;
}

export function timelineEventHint(
  item: MessageTrafficItem,
  factId: string | undefined
): string {
  if (factId) return "Focus contact on map and seed matrix task author";
  if (item.kind === "validation") return "Open decision trace for grounding issues";
  if (item.kind === "ops") return "Open matrix task author with this action as instruction";
  return "No linked map object for this event";
}

function timelineEventActionable(item: MessageTrafficItem, factId: string | undefined): boolean {
  return Boolean(factId) || item.kind === "validation" || item.kind === "ops";
}

type EventTimelineProps = {
  items: MessageTrafficItem[];
  tracks: OverviewTrack[];
  facts?: ObservedFact[];
  onFocusFact: (factId: string) => void;
  onEventNavigate: (item: MessageTrafficItem, factId?: string) => void;
  highlightFactId?: string;
  embedded?: boolean;
};

export function EventTimeline({
  items,
  tracks,
  facts = [],
  onFocusFact,
  onEventNavigate,
  highlightFactId,
  embedded = false,
}: EventTimelineProps) {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const filtered = items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "threats") return item.severity === "alert";
    if (filter === "sensors") return item.kind === "track";
    if (filter === "decisions") return item.kind === "ops" || item.kind === "validation";
    return item.kind === "validation";
  });

  return (
    <section className={embedded ? styles.timelineEmbed : styles.dashboardCard}>
      <div className={styles.panelHeaderRow}>
        {!embedded && <h3 className={styles.dashboardTitle}>Event Timeline</h3>}
        <div className={styles.timelineFilters}>
          {(["all", "threats", "sensors", "decisions", "system"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={filter === tab ? styles.timelineFilterActive : styles.timelineFilter}
              onClick={() => setFilter(tab)}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.timelineRows}>
        {filtered.slice(0, embedded ? 16 : 8).map((item) => {
          const factId = resolveTimelineFactId(item, tracks, facts);
          const actionable = timelineEventActionable(item, factId);
          return (
            <button
              key={item.id}
              type="button"
              className={`${styles.timelineRow} ${styles.timelineRowButton} ${
                factId && highlightFactId === factId ? styles.timelineRowHighlighted : ""
              } ${actionable ? "" : styles.timelineRowInactive}`}
              title={timelineEventHint(item, factId)}
              onClick={() => {
                if (factId) onFocusFact(factId);
                onEventNavigate(item, factId);
              }}
            >
              <span>{item.time}</span>
              <span>{item.kind.toUpperCase()}</span>
              <span>{item.text}</span>
              <span>{item.id.replace(/^.*-/, "").toUpperCase()}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
