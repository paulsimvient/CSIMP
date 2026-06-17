import { useState } from "react";
import { ModelessWindow } from "./ModelessWindow";
import {
  ingestFeedWindowEnabled,
  useIngestMetrics,
  type IngestRecentItem,
} from "../../intel/useIngestMetrics";
import styles from "../../App.module.css";

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatClock(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-US", { hour12: false });
}

function recentLine(item: IngestRecentItem): string {
  const time = formatClock(item.time);
  return `${time} · ${item.domain} · ${item.entity} · ${item.source}`;
}

type Props = {
  defaultOpen?: boolean;
};

export function IngestFeedWindow({ defaultOpen = ingestFeedWindowEnabled() }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [minimized, setMinimized] = useState(false);
  const { snapshot, ingestRate, error } = useIngestMetrics(open && !minimized);

  if (!open) return null;

  const stream = snapshot?.stream;
  const store = snapshot?.store;
  const streamLabel = !stream?.enabled
    ? "Off"
    : stream.running
      ? "Running"
      : "Stopped";
  const topic = stream?.topic ?? "intel.raw";

  return (
    <ModelessWindow
      title="Intel Ingest"
      open={open}
      minimized={minimized}
      onMinimizedChange={setMinimized}
      onClose={() => setOpen(false)}
      defaultPosition={{ x: 24, y: 96 }}
      defaultWidth={360}
      defaultHeight={300}
      minWidth={300}
      maxWidth={480}
      minHeight={180}
      maxHeight={420}
      zIndex={68}
    >
      <div className={styles.ingestFeedPanel}>
        <div className={styles.ingestFeedStats}>
          <div>
            <span>Stream</span>
            <strong>{streamLabel}</strong>
          </div>
          <div>
            <span>Rate</span>
            <strong>{ingestRate > 0 ? `${formatCount(ingestRate)}/s` : "—"}</strong>
          </div>
          <div>
            <span>Accepted</span>
            <strong>{formatCount(store?.acceptedTotal ?? 0)}</strong>
          </div>
          <div>
            <span>Consumed</span>
            <strong>{formatCount(stream?.messagesConsumed ?? 0)}</strong>
          </div>
          <div>
            <span>Retained</span>
            <strong>{formatCount(store?.retainedFacts ?? 0)}</strong>
          </div>
          <div>
            <span>Duplicates</span>
            <strong>{formatCount(store?.duplicateTotal ?? 0)}</strong>
          </div>
        </div>

        <div className={styles.ingestFeedMeta}>
          <span>{topic}</span>
          <span>Last {formatClock(store?.lastIngestAt ?? stream?.lastMessageAt)}</span>
        </div>

        {error ? <div className={styles.ingestFeedError}>{error}</div> : null}
        {stream?.lastError ? (
          <div className={styles.ingestFeedError}>{stream.lastError}</div>
        ) : null}

        <div className={styles.ingestFeedRecent}>
          <div className={styles.ingestFeedRecentTitle}>Recent</div>
          {store?.recent.length ? (
            <ul className={styles.ingestFeedRecentList}>
              {store.recent.map((item) => (
                <li key={item.id}>{recentLine(item)}</li>
              ))}
            </ul>
          ) : (
            <div className={styles.ingestFeedEmpty}>Waiting for ingest…</div>
          )}
        </div>
      </div>
    </ModelessWindow>
  );
}
