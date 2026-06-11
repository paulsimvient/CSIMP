import { useMemo, useState } from "react";
import type {
  CandidateAction,
  GroundingIssue,
  GroundingValidationResult,
  Inference,
  LLMInterpretation,
  ObservedFact,
  ScenarioPacket,
} from "@coa/../intel/types";
import styles from "./IntelPanel.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

type IntelPanelProps = {
  facts: ObservedFact[];
  packet?: ScenarioPacket;
  interpretation?: LLMInterpretation;
  groundingResult?: GroundingValidationResult;
  agentRuntime?: {
    agentId: string;
    agentVersion: string;
    releaseId?: string;
    inputHash: string;
    outputHash: string;
  };
};

// ─── Component ────────────────────────────────────────────────────────────────

export function IntelPanel({
  facts,
  packet,
  interpretation,
  groundingResult,
  agentRuntime,
}: IntelPanelProps) {
  const [selectedTitle, setSelectedTitle] = useState<string>("Runtime summary");
  const [selectedPayload, setSelectedPayload] = useState<unknown>(null);
  const summaryPayload = useMemo(
    () => ({
      observedFactsCount: facts.length,
      packetFactsCount: packet?.observedFacts.length ?? 0,
      interpretationAvailable: Boolean(interpretation),
      candidateActionsCount: interpretation?.candidateActions.length ?? 0,
      decisionPointsCount: interpretation?.decisionPoints.length ?? 0,
      grounding: groundingResult
        ? {
            valid: groundingResult.valid,
            blockingIssues: groundingResult.blockingIssues,
            reviewIssues: groundingResult.reviewIssues,
            usableForPlanning: groundingResult.usableForPlanning,
            validatedActionIds: groundingResult.validatedActionIds,
            validatedDecisionPointIds: groundingResult.validatedDecisionPointIds,
          }
        : null,
    }),
    [facts.length, groundingResult, interpretation, packet?.observedFacts.length]
  );

  const inspectorPayload = selectedPayload ?? summaryPayload;

  return (
    <div className={styles.panel}>
      {agentRuntime ? (
        <div className={styles.agentRuntime}>
          Agent {agentRuntime.agentId} v{agentRuntime.agentVersion}
          {agentRuntime.releaseId ? ` · ${agentRuntime.releaseId}` : ""}
          {" · "}in {agentRuntime.inputHash.slice(0, 8)} out {agentRuntime.outputHash.slice(0, 8)}
        </div>
      ) : null}
      <Section title="Technical Inspector">
        <div className={styles.inspectorPanel}>
          <div className={styles.inspectorHeader}>{selectedTitle}</div>
          <div className={styles.inspectorHint}>
            Select any row/card below to inspect its raw runtime payload.
          </div>
          <pre className={styles.inspectorCode}>
            {JSON.stringify(inspectorPayload, null, 2)}
          </pre>
        </div>
      </Section>

      <Section title="Observed Facts" badge={facts.length}>
        {facts.length === 0 ? (
          <EmptyNote text="No facts collected yet." />
        ) : (
          <div className={styles.factList}>
            {facts.map((fact) => (
              <FactCard
                key={fact.id}
                fact={fact}
                isInPacket={packet?.observedFacts.some((f) => f.id === fact.id) ?? false}
                isCited={
                  interpretation?.observedFactsUsed.includes(fact.id) ?? false
                }
                isUnused={groundingResult?.unusedFacts.includes(fact.id) ?? false}
                onSelect={(payload) => {
                  setSelectedTitle(`fact:${fact.id}`);
                  setSelectedPayload(payload);
                }}
              />
            ))}
          </div>
        )}
      </Section>

      {interpretation && (
        <>
          <Section title="Inferences" badge={interpretation.inferences.length}>
            {interpretation.inferences.map((inf, i) => (
              <InferenceCard
                key={i}
                inference={inf}
                onSelect={(payload) => {
                  setSelectedTitle(`inference:${i + 1}`);
                  setSelectedPayload(payload);
                }}
              />
            ))}
            {interpretation.assumptions.length > 0 && (
              <div className={styles.assumptions}>
                <span className={styles.assumptionsLabel}>Assumptions:</span>
                {interpretation.assumptions.map((a, i) => (
                  <div key={i} className={styles.assumption}>
                    <span className={`${styles.assumptionBadge} ${styles[`status-${a.status}`]}`}>
                      {a.status}
                    </span>
                    {a.claim}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Decision Points" badge={interpretation.decisionPoints.length}>
            {interpretation.decisionPoints.map((dp) => (
              <button
                key={dp.id}
                className={styles.inferenceCardButton}
                type="button"
                onClick={() => {
                  setSelectedTitle(`decision-point:${dp.id}`);
                  setSelectedPayload(dp);
                }}
              >
                <div className={styles.inferenceHeader}>
                  <code className={styles.factRef}>{dp.id}</code>
                  <span className={styles.inferenceClaim}>{dp.question}</span>
                </div>
                <div className={styles.inferenceFacts}>
                  {dp.triggerFacts.map((id) => (
                    <code key={id} className={styles.factRef}>
                      {id}
                    </code>
                  ))}
                </div>
                <div className={styles.actionCitations}>
                  {dp.options.map((option) => (
                    <span key={option.id} className={styles.assumption}>
                      {option.label}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </Section>

          <Section title="Uncertainties" badge={interpretation.uncertainties.length}>
            <ul className={styles.uncertaintyList}>
              {interpretation.uncertainties.map((u, i) => (
                <li key={i} className={styles.uncertainty}>
                  {u}
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Candidate Actions"
            badge={interpretation.candidateActions.length}
          >
            {interpretation.candidateActions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                validated={
                  groundingResult?.validatedActionIds.includes(action.id) ?? null
                }
                onSelect={(payload) => {
                  setSelectedTitle(`action:${action.id}`);
                  setSelectedPayload(payload);
                }}
              />
            ))}
          </Section>
        </>
      )}

      {groundingResult && (
        <Section
          title="Grounding Validation"
          badge={groundingResult.issues.length}
          badgeVariant={groundingResult.valid ? "ok" : "warn"}
        >
          <GroundingReport
            result={groundingResult}
            onSelectIssue={(issue, index) => {
              setSelectedTitle(`issue:${issue.kind}:${index + 1}`);
              setSelectedPayload(issue);
            }}
          />
        </Section>
      )}
    </div>
  );
}

// ─── Fact card ────────────────────────────────────────────────────────────────

function FactCard({
  fact,
  isInPacket,
  isCited,
  isUnused,
  onSelect,
}: {
  fact: ObservedFact;
  isInPacket: boolean;
  isCited: boolean;
  isUnused: boolean;
  onSelect: (payload: unknown) => void;
}) {
  const payload = {
    ...fact,
    flags: { isInPacket, isCited, isUnused },
  };
  return (
    <button
      className={`${styles.factCard} ${styles.factCardButton} ${!isInPacket ? styles.factExcluded : ""} ${isUnused ? styles.factUnused : ""}`}
      type="button"
      onClick={() => onSelect(payload)}
    >
      <div className={styles.factHeader}>
        <code className={styles.factId}>{fact.id}</code>
        <span className={styles.factDomain}>{fact.domain.toUpperCase()}</span>
        <ConfidenceBadge confidence={fact.confidence} />
        <SeverityBadge severity={fact.severity} />
        {!isInPacket && <span className={styles.tag}>excluded</span>}
        {isCited && <span className={`${styles.tag} ${styles.tagCited}`}>cited</span>}
        {isUnused && isInPacket && (
          <span className={`${styles.tag} ${styles.tagUnused}`}>unused</span>
        )}
      </div>
      <div className={styles.factEvent}>{fact.event}</div>
      <div className={styles.factMeta}>
        {fact.entity} · {fact.time}
        {fact.location ? ` · ${fact.location}` : ""}
        {" · "}<span className={styles.factSource}>{fact.source}</span>
      </div>
    </button>
  );
}

// ─── Inference card ───────────────────────────────────────────────────────────

function InferenceCard({
  inference,
  onSelect,
}: {
  inference: Inference;
  onSelect: (payload: unknown) => void;
}) {
  return (
    <button
      className={styles.inferenceCardButton}
      type="button"
      onClick={() => onSelect(inference)}
    >
      <div className={styles.inferenceHeader}>
        <ConfidenceBadge confidence={inference.confidence} />
        <span className={styles.inferenceClaim}>{inference.claim}</span>
      </div>
      <div className={styles.inferenceFacts}>
        {inference.supportingFacts.map((id) => (
          <code key={id} className={styles.factRef}>
            {id}
          </code>
        ))}
      </div>
      {inference.whyNotHigher && (
        <div className={styles.inferenceGap}>{inference.whyNotHigher}</div>
      )}
    </button>
  );
}

// ─── Action card ──────────────────────────────────────────────────────────────

function ActionCard({
  action,
  validated,
  onSelect,
}: {
  action: CandidateAction;
  validated: boolean | null;
  onSelect: (payload: unknown) => void;
}) {
  const payload = {
    ...action,
    validation: validated === null ? "unknown" : validated ? "grounded" : "failed",
  };
  return (
    <button
      className={`${styles.actionCard} ${styles.actionCardButton} ${validated === false ? styles.actionInvalid : ""} ${validated === true ? styles.actionValid : ""}`}
      type="button"
      onClick={() => onSelect(payload)}
    >
      <div className={styles.actionHeader}>
        <code className={styles.actionId}>{action.id}</code>
        {validated !== null && (
          <span
            className={`${styles.validationBadge} ${validated ? styles.validBadge : styles.invalidBadge}`}
          >
            {validated ? "grounded" : "FAILED grounding"}
          </span>
        )}
      </div>
      <div className={styles.actionDescription}>{action.description}</div>
      <div className={styles.actionRationale}>{action.rationale}</div>
      <div className={styles.actionCitations}>
        {action.citedFacts.map((id) => (
          <code key={id} className={styles.factRef}>
            {id}
          </code>
        ))}
      </div>
    </button>
  );
}

// ─── Grounding report ─────────────────────────────────────────────────────────

function GroundingReport({
  result,
  onSelectIssue,
}: {
  result: GroundingValidationResult;
  onSelectIssue: (issue: GroundingIssue, index: number) => void;
}) {
  if (result.valid) {
    return (
      <div className={styles.groundingOk}>
        All citations verified. {result.validatedActionIds.length} action
        {result.validatedActionIds.length !== 1 ? "s" : ""} validated.
      </div>
    );
  }

  return (
    <div className={styles.groundingIssues}>
      {result.issues.map((issue, i) => (
          <button
            key={i}
            className={styles.groundingIssueButton}
            type="button"
            onClick={() => onSelectIssue(issue, i)}
          >
            <span className={styles.issueKind}>{issue.kind}</span>
            <span className={styles.issueDetail}>
              {issue.kind === "hallucinated-fact-id" && `Unknown ID: "${issue.id}"`}
              {issue.kind === "unsupported-inference" &&
                `Inference "${issue.claim}": ${issue.reason}`}
              {issue.kind === "unsupported-action" &&
                `Action "${issue.actionId}": ${issue.reason}`}
              {issue.kind === "unsupported-decision-option" &&
                `Decision "${issue.decisionPointId}" option "${issue.optionId}": ${issue.reason}`}
              {issue.kind === "degraded-grounding" &&
                `Decision "${issue.decisionPointId}" option "${issue.optionId}": ${issue.reason}`}
              {issue.kind === "unknown-asset" &&
                `Action "${issue.actionId}" references unknown asset "${issue.asset}"`}
              {issue.kind === "missing-authority-state" &&
                `Action "${issue.actionId}" references unknown authority "${issue.authority}"`}
              {issue.kind === "hedge-violation" &&
                `"${issue.forbiddenWord}" in ${issue.claim}`}
              {issue.kind === "constraint-violation" &&
                `${issue.constraint} — found in ${issue.foundIn}`}
              {issue.kind === "invented-entity" &&
                `"${issue.entity}" in ${issue.foundIn}`}
            </span>
          </button>
        ))}
      {result.unusedFacts.length > 0 && (
        <div className={styles.unusedNote}>
          Unused facts: {result.unusedFacts.join(", ")}
        </div>
      )}
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function Section({
  title,
  badge,
  badgeVariant = "neutral",
  children,
}: {
  title: string;
  badge?: number;
  badgeVariant?: "neutral" | "ok" | "warn";
  children: React.ReactNode;
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>{title}</span>
        {badge !== undefined && (
          <span
            className={`${styles.sectionBadge} ${
              badgeVariant === "ok"
                ? styles.badgeOk
                : badgeVariant === "warn" && badge > 0
                  ? styles.badgeWarn
                  : ""
            }`}
          >
            {badge}
          </span>
        )}
      </div>
      <div className={styles.sectionContent}>{children}</div>
    </div>
  );
}

function ConfidenceBadge({
  confidence,
}: {
  confidence: "low" | "medium" | "high";
}) {
  return (
    <span className={`${styles.badge} ${styles[`conf-${confidence}`]}`}>
      {confidence}
    </span>
  );
}

function SeverityBadge({
  severity,
}: {
  severity: "low" | "medium" | "high" | "critical";
}) {
  return (
    <span className={`${styles.badge} ${styles[`sev-${severity}`]}`}>
      {severity}
    </span>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <div className={styles.emptyNote}>{text}</div>;
}
