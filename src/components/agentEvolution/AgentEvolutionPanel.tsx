import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./AgentEvolutionPanel.module.css";
import {
  advanceRelease,
  buildCapabilityPassport,
  evolveProposal,
  fetchAgents,
  fetchAudit,
  fetchDoctrineFossils,
  fetchMutationBudget,
  fetchReleases,
  processProposal,
  recordDoctrineDemoFailure,
  registerEnvelopeRoute,
  rollbackRelease,
  validateProposal,
  type ActorCriticSession,
  type AgentRelease,
  type AgentSummary,
  type AuditEvent,
  type CapabilityPassport,
  type DoctrineFossil,
  type PipelineStage,
} from "./agentEvolutionApi";

/** Intentionally includes a redundant rule — actor-critic loop should revise it. */
const EVOLVE_SEED_PROPOSAL = {
  proposalId: "prop-evolve-seed",
  targetAgentId: "intel-interpreter",
  baseAgentVersion: "1.0.0",
  baseCommitSha: "7756912aa664",
  changeTier: "policy-update",
  objective:
    "Strengthen attribution corroboration after grounding failures in eval-run-188.",
  evidenceRefs: ["eval-run-188", "grounding-failure-94"],
  changedFiles: [],
  testsAddedOrChanged: [],
  expectedBenefits: ["Fewer unsupported attribution inferences"],
  knownRisks: ["More conservative monitoring recommendations"],
  requestedRiskClass: "low",
  policyChanges: [
    {
      path: "policies/agents/intel-interpreter/attribution.json",
      operation: "add-rule",
      rule: "Do not infer attribution from a single degraded source.",
    },
  ],
};

const EXAMPLE_PROPOSAL = {
  proposalId: "prop-ui-001",
  targetAgentId: "intel-interpreter",
  baseAgentVersion: "1.0.0",
  baseCommitSha: "7756912aa664",
  changeTier: "policy-update",
  objective:
    "Add attribution guardrail after grounding failures — supervised Tier A policy evolution.",
  evidenceRefs: ["eval-run-188", "grounding-failure-94"],
  changedFiles: [],
  testsAddedOrChanged: [],
  expectedBenefits: ["Fewer unsupported attribution inferences"],
  knownRisks: ["More conservative monitoring recommendations"],
  requestedRiskClass: "low",
  policyChanges: [
    {
      path: "policies/agents/intel-interpreter/attribution.json",
      operation: "add-rule",
      rule: "Require corroboration from two independent sources before attribution claims.",
    },
  ],
};

function stageLabel(stage: PipelineStage): string {
  if (stage.stage === "schema" && !stage.ok) return `Schema failed: ${stage.errors.join("; ")}`;
  if (stage.stage === "policy") {
    return stage.ok
      ? `Policy OK${stage.warnings.length ? ` (${stage.warnings.length} warnings)` : ""}`
      : `Policy denied: ${stage.errors.join("; ")}`;
  }
  if (stage.stage === "static-analysis") {
    return stage.ok
      ? "Static analysis passed"
      : `Static analysis failed: ${stage.findings.join("; ")}`;
  }
  if (stage.stage === "evaluation") {
    const failed = stage.runs.filter((run) => !run.passed).map((run) => run.suite);
    return stage.ok
      ? `Evaluation passed (${stage.runs.length} suites)`
      : `Evaluation failed: ${failed.join(", ")}`;
  }
  if (stage.stage === "promotion") {
    return stage.ok
      ? `Promoted to ${stage.release.stage} as v${stage.release.version}`
      : `Promotion blocked: ${stage.reasons.join("; ")}`;
  }
  return stage.stage;
}

export function AgentEvolutionPanel() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [releases, setReleases] = useState<AgentRelease[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [evolveSession, setEvolveSession] = useState<ActorCriticSession | undefined>();
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | undefined>();
  const [reviewerId, setReviewerId] = useState("operator-lead");
  const [justification, setJustification] = useState("");
  const [nextVersion, setNextVersion] = useState("1.1.0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [fossils, setFossils] = useState<DoctrineFossil[]>([]);
  const [forgeResult, setForgeResult] = useState<{
    fossil?: DoctrineFossil;
    forgedCount?: number;
    counterexample?: string;
  }>();
  const [passport, setPassport] = useState<CapabilityPassport | undefined>();
  const [passportSummary, setPassportSummary] = useState<string | undefined>();
  const [mutationBudget, setMutationBudget] = useState<string | undefined>();

  const selectedRelease = useMemo(
    () => releases.find((release) => release.releaseId === selectedReleaseId),
    [releases, selectedReleaseId]
  );

  const refresh = useCallback(async () => {
    const [agentRes, releaseRes, auditRes, fossilRes] = await Promise.all([
      fetchAgents(),
      fetchReleases(),
      fetchAudit(),
      fetchDoctrineFossils().catch(() => ({ fossils: [] as DoctrineFossil[] })),
    ]);
    setAgents(agentRes.agents);
    setReleases(releaseRes.releases);
    setAudit(auditRes.events.slice(-20).reverse());
    setFossils(fossilRes.fossils);
    try {
      const budgetRes = await fetchMutationBudget("intel-interpreter");
      setMutationBudget(
        `${budgetRes.budget.trustTier} — layers: ${budgetRes.budget.allowedGenomeLayers.join(", ")}`
      );
    } catch {
      setMutationBudget(undefined);
    }
    if (!selectedReleaseId && releaseRes.releases[0]) {
      setSelectedReleaseId(releaseRes.releases[0].releaseId);
    }
  }, [selectedReleaseId]);

  useEffect(() => {
    void refresh().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [refresh]);

  const runValidate = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await validateProposal({
        proposal: EXAMPLE_PROPOSAL,
        nextVersion,
        approvals: [],
      });
      setStages(result.stages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runProcessConverged = async () => {
    if (!evolveSession?.finalProposal) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await processProposal({
        proposal: evolveSession.finalProposal,
        nextVersion,
        approvals: [
          {
            reviewerId,
            decision: "approved",
            timestamp: new Date().toISOString(),
            justification: justification || "Process actor-critic converged proposal.",
          },
        ],
      });
      setStages(result.stages);
      if (result.release) setSelectedReleaseId(result.release.releaseId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runEvolve = async () => {
    setBusy(true);
    setError(undefined);
    setEvolveSession(undefined);
    try {
      const result = await evolveProposal({
        proposal: EVOLVE_SEED_PROPOSAL,
        nextVersion,
        maxRounds: 4,
        actorBackend: "hybrid",
        autoProcessOnConverge: false,
      });
      setEvolveSession(result.session);
      if (result.processResult?.stages) {
        setStages(result.processResult.stages);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runProcess = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await processProposal({
        proposal: EXAMPLE_PROPOSAL,
        nextVersion,
        approvals: [
          {
            reviewerId,
            decision: "approved",
            timestamp: new Date().toISOString(),
            justification: justification || "Supervised Tier A policy approval.",
          },
        ],
      });
      setStages(result.stages);
      if (result.release) setSelectedReleaseId(result.release.releaseId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runAdvance = async (targetStage: "canary" | "production") => {
    if (!selectedRelease) return;
    setBusy(true);
    setError(undefined);
    try {
      await advanceRelease(selectedRelease.releaseId, {
        targetStage,
        approval: {
          reviewerId,
          decision: "approved",
          justification: justification || `Advance to ${targetStage}`,
        },
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runRollback = async () => {
    if (!selectedRelease) return;
    setBusy(true);
    setError(undefined);
    try {
      await rollbackRelease(selectedRelease.releaseId, {
        approval: {
          reviewerId,
          decision: "approved",
          justification: justification || "Rollback supervised release",
        },
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runDoctrineForgeDemo = async () => {
    setBusy(true);
    setError(undefined);
    setForgeResult(undefined);
    setPassport(undefined);
    setPassportSummary(undefined);
    try {
      const { result } = await recordDoctrineDemoFailure("intel-interpreter");
      setForgeResult({
        fossil: result.fossil,
        forgedCount: result.forgedScenarios.length,
        counterexample: result.causalTrace.minimalCounterexample,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runBuildPassport = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const prod = agents.find((a) => a.id === "intel-interpreter")?.productionVersion ?? "1.0.0";
      const candidate = nextVersion;
      const fossilIds =
        forgeResult?.fossil?.fossilId != null
          ? [forgeResult.fossil.fossilId]
          : fossils.slice(0, 3).map((f) => f.fossilId);
      const result = await buildCapabilityPassport({
        agentId: "intel-interpreter",
        agentVersion: candidate,
        parentVersion: prod,
        rollbackTarget: prod,
        fossilIds,
      });
      setPassport(result.passport);
      setPassportSummary(result.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runRegisterEnvelope = async () => {
    if (!passport) return;
    setBusy(true);
    setError(undefined);
    try {
      await registerEnvelopeRoute(passport.passportId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Agent Evolution</h2>
          <p className={styles.subtitle}>
            Actor-critic evolution — agents propose revisions, deterministic critic scores
            policy/eval/shadow gates, humans promote. No self-deployment.
          </p>
        </div>
        <button type="button" className={styles.secondaryBtn} onClick={() => void refresh()} disabled={busy}>
          Refresh
        </button>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.card}>
        <h3>Doctrine Forge</h3>
        <p className={styles.meta}>
          Proof-carrying agent evolution — operational failures become fossils, forged adversarial
          worlds, and capability passports with machine-checkable evidence.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => void runDoctrineForgeDemo()}
            disabled={busy}
          >
            1. Record demo failure → forge scenarios
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void runBuildPassport()}
            disabled={busy || fossils.length === 0}
          >
            2. Build passport + tournament
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void runRegisterEnvelope()}
            disabled={busy || !passport}
          >
            3. Register mission envelope route
          </button>
        </div>
        {mutationBudget ? (
          <p className={styles.meta}>Mutation budget: {mutationBudget}</p>
        ) : null}
        {forgeResult?.counterexample ? (
          <div className={styles.actorNotes}>
            <strong>Minimal counterexample:</strong> {forgeResult.counterexample}
            {forgeResult.forgedCount != null ? (
              <span> · Forged {forgeResult.forgedCount} adversarial world(s)</span>
            ) : null}
          </div>
        ) : null}
        {passport ? (
          <div className={styles.passportBox}>
            <p className={styles.meta}>
              Passport {passport.passportId} · {passport.worldsSurvived}/{passport.worldsGenerated}{" "}
              worlds · sig {passport.signature.slice(0, 16)}…
            </p>
            <pre className={styles.passportSummary}>{passportSummary}</pre>
          </div>
        ) : null}
        {fossils.length > 0 ? (
          <ul className={styles.auditList}>
            {fossils.slice(0, 5).map((fossil) => (
              <li key={fossil.fossilId}>
                <span className={styles.auditType}>{fossil.failureClass}</span>
                <span>{fossil.scenarioRef}</span>
                <span>{fossil.derivedScenarioIds.length} derived scenarios</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h3>Registered agents</h3>
          <ul className={styles.list}>
            {agents.map((agent) => (
              <li key={agent.id}>
                <strong>{agent.id}</strong>
                <span>
                  versions: {agent.versions.join(", ") || "none"}
                  {agent.productionVersion ? ` · prod ${agent.productionVersion}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.card}>
          <h3>Releases</h3>
          <ul className={styles.list}>
            {releases.length === 0 ? (
              <li>No releases yet — process a supervised proposal below.</li>
            ) : (
              releases.map((release) => (
                <li key={release.releaseId}>
                  <button
                    type="button"
                    className={
                      release.releaseId === selectedReleaseId
                        ? styles.releaseActive
                        : styles.releaseBtn
                    }
                    onClick={() => setSelectedReleaseId(release.releaseId)}
                  >
                    {release.agentId} v{release.version} · {release.stage}
                    {release.rolledBackAt ? " · rolled back" : ""}
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      <section className={styles.card}>
        <h3>Proposal (Tier A — policy update)</h3>
        <p className={styles.objective}>{EXAMPLE_PROPOSAL.objective}</p>
        <div className={styles.metaRow}>
          <label>
            Next version
            <input
              value={nextVersion}
              onChange={(e) => setNextVersion(e.target.value)}
              className={styles.input}
            />
          </label>
          <label>
            Reviewer ID
            <input
              value={reviewerId}
              onChange={(e) => setReviewerId(e.target.value)}
              className={styles.input}
            />
          </label>
        </div>
        <label className={styles.fullWidth}>
          Justification
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            className={styles.textarea}
            rows={2}
            placeholder="Required for high-risk or production promotion"
          />
        </label>
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryBtn} onClick={() => void runValidate()} disabled={busy}>
            Validate only
          </button>
          <button type="button" className={styles.secondaryBtn} onClick={() => void runEvolve()} disabled={busy}>
            Evolve (actor-critic)
          </button>
          <button type="button" className={styles.primaryBtn} onClick={() => void runProcess()} disabled={busy}>
            Process + approve (shadow)
          </button>
        </div>
      </section>

      {evolveSession ? (
        <section className={styles.card}>
          <h3>Actor-critic session — {evolveSession.sessionId}</h3>
          <p className={styles.meta}>
            Status: <strong>{evolveSession.status}</strong> · Backend: {evolveSession.actorBackend} ·{" "}
            {evolveSession.summary}
          </p>
          <ol className={styles.roundList}>
            {evolveSession.rounds.map((round) => (
              <li key={round.round} className={styles.roundItem}>
                <div className={styles.roundHeader}>
                  Round {round.round} · critic score {(round.critic.score * 100).toFixed(0)}% ·{" "}
                  {round.critic.passed ? "passed" : "blocked"}
                </div>
                {round.critic.findings.length > 0 ? (
                  <ul className={styles.findingList}>
                    {round.critic.findings.map((finding, idx) => (
                      <li
                        key={`${finding.code}-${idx}`}
                        className={
                          finding.severity === "blocker"
                            ? styles.findingBlocker
                            : styles.findingWarning
                        }
                      >
                        <span className={styles.findingCode}>{finding.code}</span>
                        {finding.message}
                        {finding.remediation ? (
                          <span className={styles.remediation}> → {finding.remediation}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {round.actor ? (
                  <div className={styles.actorNotes}>
                    Actor ({round.actor.backend}):{" "}
                    {round.actor.revised
                      ? round.actor.notes.join(" ")
                      : round.actor.stallReason ?? "no revision"}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          {evolveSession.finalProposal ? (
            <div className={styles.actions}>
              <p className={styles.meta}>
                Converged proposal:{" "}
                {(evolveSession.finalProposal as { proposalId?: string }).proposalId}
              </p>
              {evolveSession.status === "converged" ? (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => void runProcessConverged()}
                  disabled={busy}
                >
                  Process converged proposal (shadow)
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {selectedRelease ? (
        <section className={styles.card}>
          <h3>Release actions — {selectedRelease.releaseId}</h3>
          <p className={styles.meta}>
            Stage: <strong>{selectedRelease.stage}</strong> · Eval suites:{" "}
            {selectedRelease.evaluationRuns.map((run) => `${run.suite}:${run.passed ? "pass" : "fail"}`).join(", ")}
          </p>
          <div className={styles.actions}>
            {selectedRelease.stage === "shadow" ? (
              <button type="button" className={styles.primaryBtn} onClick={() => void runAdvance("canary")} disabled={busy}>
                Approve for canary
              </button>
            ) : null}
            {selectedRelease.stage === "canary" ? (
              <button type="button" className={styles.primaryBtn} onClick={() => void runAdvance("production")} disabled={busy}>
                Promote to production
              </button>
            ) : null}
            {!selectedRelease.rolledBackAt ? (
              <button type="button" className={styles.dangerBtn} onClick={() => void runRollback()} disabled={busy}>
                Roll back
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {stages.length > 0 ? (
        <section className={styles.card}>
          <h3>Pipeline stages</h3>
          <ol className={styles.stageList}>
            {stages.map((stage, index) => (
              <li key={`${stage.stage}-${index}`} className={styles.stageItem}>
                {stageLabel(stage)}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className={styles.card}>
        <h3>Audit trail (recent)</h3>
        <ul className={styles.auditList}>
          {audit.map((event) => (
            <li key={event.id}>
              <span className={styles.auditType}>{event.type}</span>
              <span>{new Date(event.timestamp).toLocaleString()}</span>
              {event.proposalId ? <span>proposal {event.proposalId}</span> : null}
              {event.releaseId ? <span>release {event.releaseId}</span> : null}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
