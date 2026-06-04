import { formatConstraintTraces } from "@coa/constraintTrace";
import { buildCoaRankRationale } from "@coa/rankRationale";
import type { CoaCandidate } from "@coa/types";
import { formatHeuristicScore, HEURISTIC_ESTIMATE_NOTE } from "../../coa/scoreLabels";
import { ConstraintTracePanel } from "../coa/CoaAuditPanels";
import { CyberEffectsBadge } from "../coa/CyberEffectsBadge";
import styles from "./CoaSelector.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

type CoaSelectorProps = {
  candidates: CoaCandidate[];
  selectedCoaId: string | undefined;
  onSelect: (coaId: string) => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function CoaSelector({
  candidates,
  selectedCoaId,
  onSelect,
}: CoaSelectorProps) {
  if (candidates.length === 0) {
    return (
      <div className={styles.empty}>No COA candidates yet. Run the pipeline.</div>
    );
  }

  return (
    <div className={styles.list}>
      {candidates.map((candidate, index) => (
        <CoaCard
          key={candidate.id}
          candidate={candidate}
          rank={index + 1}
          isSelected={candidate.id === selectedCoaId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function CoaCard({
  candidate,
  rank,
  isSelected,
  onSelect,
}: {
  candidate: CoaCandidate;
  rank: number;
  isSelected: boolean;
  onSelect: (coaId: string) => void;
}) {
  const {
    scores,
    status,
    selectedActions,
    effects,
    logisticsPlan,
    intelFidelity,
    constraintTrace,
    dominatedBy,
  } = candidate;
  const rationale = buildCoaRankRationale(candidate, rank);
  const constraintLines = status === "unsat" ? formatConstraintTraces(constraintTrace) : [];

  return (
    <button
      className={`${styles.card} ${isSelected ? styles.selected : ""} ${status !== "sat" ? styles.unsat : ""}`}
      onClick={() => onSelect(candidate.id)}
    >
      <div className={styles.cardHeader}>
        <span className={styles.rank}>#{rank}</span>
        <span className={styles.label}>{candidate.label}</span>
        <StatusBadge status={status} />
      </div>

      <div className={styles.scores} title={HEURISTIC_ESTIMATE_NOTE}>
        <ScoreBar label="Heuristic Estimate overall" value={scores.overall} highlight />
        <ScoreBar label="Feasibility" value={scores.feasibility} />
        <ScoreBar label="Heuristic Estimate effects" value={scores.effects} />
        <ScoreBar label="Logistics" value={scores.logistics} />
        <ScoreBar label="Risk (low)" value={1 - scores.risk} inverted />
      </div>

      <div className={styles.meta}>
        <span className={styles.metaItem}>
          {selectedActions.length} action{selectedActions.length !== 1 ? "s" : ""}
        </span>
        {logisticsPlan.kind === "populated" && (
          <span className={styles.metaItem}>
            {logisticsPlan.chips.length} chip{logisticsPlan.chips.length !== 1 ? "s" : ""}
          </span>
        )}
        {effects && (
          <span className={styles.metaItem} title={HEURISTIC_ESTIMATE_NOTE}>
            Impact {formatHeuristicScore(effects.expectedImpact).replace("Heuristic Estimate ", "")} · Conf {pct(effects.confidence)}
          </span>
        )}
      </div>

      <CyberEffectsBadge cyberEffects={effects?.cyberEffects} />

      {dominatedBy && (
        <div className={styles.dominated}>Dominated by another feasible COA</div>
      )}

      <ul className={styles.rationale}>
        {rationale.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {constraintLines.length > 0 && (
        <ul className={styles.constraintTrace}>
          {constraintLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {(status === "unsat" || status === "insufficient_evidence") && (
        <div className={styles.traceEmbed}>
          <ConstraintTracePanel candidate={candidate} />
        </div>
      )}

      {intelFidelity && (
        <div className={styles.fidelity}>
          <div className={styles.fidelityHeader}>Intel Scoring Inputs</div>
          <div className={styles.fidelityGrid}>
            <Metric label="Urgency" value={intelFidelity.urgency} />
            <Metric label="Alignment" value={intelFidelity.alignment} />
            <Metric label="Confidence" value={intelFidelity.confidence} />
            <Metric
              label="Resource pressure"
              value={intelFidelity.resourcePressure}
            />
          </div>
          <div className={styles.fidelityAdjustments}>
            <span className={styles.metaItem}>
              Effects Δ {signedPct(intelFidelity.effectsAdjustment)}
            </span>
            <span className={styles.metaItem}>
              Risk Δ {signedPct(intelFidelity.riskAdjustment)}
            </span>
          </div>
        </div>
      )}
    </button>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CoaCandidate["status"] }) {
  const labels: Partial<Record<CoaCandidate["status"], string>> = {
    sat: "SAT",
    unsat: "UNSAT",
    error: "ERR",
    insufficient_evidence: "LOW EVID",
    draft: "DRAFT",
    incomplete: "INCOMPLETE",
    validating: "VALIDATING",
    stale: "STALE",
  };
  return (
    <span className={`${styles.badge} ${styles[`badge-${status}`] ?? ""}`}>
      {labels[status] ?? status.toUpperCase()}
    </span>
  );
}

function ScoreBar({
  label,
  value,
  highlight = false,
  inverted = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  inverted?: boolean;
}) {
  const displayValue = inverted ? 1 - value : value;
  const fillValue = Math.max(0, Math.min(1, value));

  return (
    <div className={`${styles.scoreRow} ${highlight ? styles.scoreHighlight : ""}`}>
      <span className={styles.scoreLabel}>{label}</span>
      <div className={styles.scoreTrack}>
        <div
          className={styles.scoreFill}
          style={{ width: `${fillValue * 100}%` }}
        />
      </div>
      <span className={styles.scoreValue}>{pct(displayValue)}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{pct(value)}</span>
    </div>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function signedPct(v: number): string {
  const rounded = Math.round(v * 100);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}
