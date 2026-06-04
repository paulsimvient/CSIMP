import { BackgroundThemeSwitcher } from "@components/BackgroundThemeSwitcher";
import { useEffect, useRef, useState } from "react";
import type { ActiveView } from "./activeView";
import { useOpsWindowsOptional } from "./OpsWindowsContext";
import styles from "../../App.module.css";

export type OpsHeaderProps = {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  threatLevel: string;
  confidenceLevel: string;
  phase: string;
  summaryTime: string;
  environmentLabel: string;
  onRestartScenario: () => void;
  onExportTrace: () => void;
};

function MissionSummaryContent({
  phase,
  summaryTime,
  environmentLabel,
}: {
  phase: string;
  summaryTime: string;
  environmentLabel: string;
}) {
  return (
    <div className={styles.summaryGrid}>
      <span>Objective</span>
      <strong>Maintain Strait Stability</strong>
      <span>Area</span>
      <strong>{environmentLabel}</strong>
      <span>Primary Concern</span>
      <strong>Multi-domain sensor degradation and strike risk</strong>
      <span>Phase</span>
      <strong>{phase}</strong>
      <span>Time in Phase</span>
      <strong>{summaryTime}</strong>
    </div>
  );
}

function MissionMenu(props: Pick<OpsHeaderProps, "phase" | "summaryTime" | "environmentLabel">) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.missionMenuWrap} ref={menuRef}>
      <button
        type="button"
        className={open ? styles.headerButtonActive : styles.headerButton}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Mission
      </button>
      {open && (
        <div className={styles.missionPopover} role="dialog" aria-label="Mission summary">
          <h3 className={styles.dashboardTitle}>Mission Summary</h3>
          <MissionSummaryContent
            phase={props.phase}
            summaryTime={props.summaryTime}
            environmentLabel={props.environmentLabel}
          />
        </div>
      )}
    </div>
  );
}

function NavigationTabs({
  activeView,
  setActiveView,
}: {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
}) {
  const tabs: Array<{ id: ActiveView; label: string }> = [
    { id: "overview", label: "Decision Flow" },
    { id: "reports", label: "Reports" },
    { id: "trace", label: "Decision Trace" },
  ];
  const analysisViews: Array<{ id: ActiveView; label: string }> = [
    { id: "signals", label: "Signals" },
    { id: "actions", label: "Action Proposals" },
    { id: "coas", label: "COA Candidates" },
    { id: "logistics", label: "Logistics" },
  ];
  const analysisActive = analysisViews.some((view) => view.id === activeView);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const analysisRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!analysisOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!analysisRef.current?.contains(event.target as Node)) {
        setAnalysisOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnalysisOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [analysisOpen]);

  return (
    <nav className={styles.commandNav}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={activeView === tab.id ? styles.commandNavActive : styles.commandNavItem}
          onClick={() => setActiveView(tab.id)}
        >
          {tab.label}
        </button>
      ))}
      <div className={styles.analysisNavWrap} ref={analysisRef}>
        <button
          type="button"
          className={analysisActive ? styles.commandNavActive : styles.commandNavItem}
          aria-expanded={analysisOpen}
          aria-haspopup="menu"
          onClick={() => setAnalysisOpen((open) => !open)}
        >
          Analysis {analysisActive ? "▾" : "▸"}
        </button>
        {analysisOpen ? (
          <div className={styles.analysisNavMenu} role="menu" aria-label="Analysis views">
            {analysisViews.map((view) => (
              <button
                key={view.id}
                type="button"
                role="menuitem"
                className={
                  activeView === view.id ? styles.analysisNavItemActive : styles.analysisNavItem
                }
                onClick={() => {
                  setActiveView(view.id);
                  setAnalysisOpen(false);
                }}
              >
                {view.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  );
}

export function OpsHeader(props: OpsHeaderProps) {
  useOpsWindowsOptional();

  return (
    <header className={styles.commandHeader}>
      <div className={styles.commandHeaderRow}>
        <div className={styles.brandBlock}>
          <div className={styles.brandTitle}>CODA2</div>
          <div className={styles.brandSub}>Command Loop</div>
        </div>
        <div className={styles.headerStat}>
          <span>Scenario</span>
          <strong>Broken Signal</strong>
        </div>
        <div className={styles.headerStat}>
          <span>Threat Level</span>
          <strong>{props.threatLevel}</strong>
        </div>
        <div className={styles.headerStat}>
          <span>Confidence</span>
          <strong>{props.confidenceLevel}</strong>
        </div>
        <div className={styles.headerControls}>
          <BackgroundThemeSwitcher />
          <MissionMenu
            phase={props.phase}
            summaryTime={props.summaryTime}
            environmentLabel={props.environmentLabel}
          />
          <button type="button" className={styles.headerButton} onClick={props.onRestartScenario}>
            Restart
          </button>
          <button type="button" className={styles.headerButton} onClick={props.onExportTrace}>
            Export Trace
          </button>
        </div>
      </div>
      <NavigationTabs activeView={props.activeView} setActiveView={props.setActiveView} />
    </header>
  );
}
