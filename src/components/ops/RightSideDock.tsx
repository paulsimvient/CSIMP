import type { ReactNode } from "react";
import styles from "./RightSideDock.module.css";

export type RightSidePanel = "inspector" | "workflow";

type Props = {
  panel: RightSidePanel;
  onPanelChange: (panel: RightSidePanel) => void;
  inspector: ReactNode;
  workflow: ReactNode;
};

export function RightSideDock({ panel, onPanelChange, inspector, workflow }: Props) {
  return (
    <div className={styles.dock} aria-label="Right side panels">
      <div className={styles.dockTabs} role="tablist" aria-label="Right side views">
        <button
          type="button"
          role="tab"
          aria-selected={panel === "inspector"}
          className={[styles.dockTab, panel === "inspector" ? styles.dockTabActive : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onPanelChange("inspector")}
        >
          Inspector
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panel === "workflow"}
          className={[styles.dockTab, panel === "workflow" ? styles.dockTabActive : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onPanelChange("workflow")}
        >
          Decision Flow
        </button>
      </div>
      <div className={styles.dockBody} role="tabpanel">
        {panel === "inspector" ? (
          <div className={styles.inspectorHost}>{inspector}</div>
        ) : (
          <div className={styles.workflowHost}>{workflow}</div>
        )}
      </div>
    </div>
  );
}
