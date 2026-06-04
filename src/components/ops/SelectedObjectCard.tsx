import type { ReactNode } from "react";
import type { TaskObjectRef, TaskObjectRole } from "./taskComposerTypes";
import styles from "./SelectedObjectCard.module.css";

type Props = {
  role: TaskObjectRole;
  label: string;
  object: TaskObjectRef | null;
  pickModeActive: boolean;
  onCardClick: () => void;
  onLocate: () => void;
  onPickFromMap: () => void;
  onSearch: () => void;
  searchOpen: boolean;
  searchSlot?: ReactNode;
  pickFeedback?: string | null;
};

const ROLE_HINT: Record<TaskObjectRole, string> = {
  actor: "Grey unknown contacts, green ground/cyber units — not red threats or information objectives",
  target: "Red threats, green information/logistics/space objectives, any contact",
};

export function SelectedObjectCard({
  role,
  label,
  object,
  pickModeActive,
  onCardClick,
  onLocate,
  onPickFromMap,
  onSearch,
  searchOpen,
  searchSlot,
  pickFeedback,
}: Props) {
  return (
    <div
      className={[
        styles.card,
        object ? styles.cardFilled : styles.cardEmpty,
        pickModeActive ? styles.cardPickMode : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.cardHeader}>{label}</div>
      <button type="button" className={styles.cardBody} onClick={onCardClick}>
        <span className={styles.icon} data-role={role} aria-hidden />
        <span className={styles.meta}>
          <strong>{object?.label ?? object?.entity ?? "Not selected"}</strong>
          <small>
            {object?.label && object.subtitle
              ? object.subtitle
              : object?.subtitle ?? ROLE_HINT[role]}
          </small>
        </span>
      </button>
      <div className={styles.actions}>
        <button type="button" onClick={onLocate} disabled={!object?.factId}>
          Locate on Map
        </button>
        <button
          type="button"
          className={pickModeActive ? styles.actionActive : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onPickFromMap}
        >
          {pickModeActive ? "Picking…" : "Pick from Map"}
        </button>
        <button type="button" onClick={onSearch}>
          {searchOpen ? "Hide Search" : "Search"}
        </button>
      </div>
      {pickModeActive && pickFeedback ? (
        <p className={styles.pickFeedback}>{pickFeedback}</p>
      ) : null}
      {searchOpen ? searchSlot : null}
    </div>
  );
}
