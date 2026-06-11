import { describe, expect, it } from "vitest";
import { runActorCriticLoop } from "./actorCriticLoop";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInMemoryAuditLog } from "./auditLog";

async function seedMinimalRegistry(root: string) {
  const policyDir = join(
    root,
    "CoAgenticModel",
    "registry",
    "agents",
    "intel-interpreter",
    "1.0.0",
    "policies"
  );
  await mkdir(policyDir, { recursive: true });
  await writeFile(
    join(policyDir, "attribution.json"),
    JSON.stringify(
      {
        agentId: "intel-interpreter",
        version: "1.0.0",
        rules: ["Do not infer attribution from a single degraded source."],
      },
      null,
      2
    )
  );
  await mkdir(join(root, "CoAgenticModel", "registry", "agents", "intel-interpreter", "1.0.0"), {
    recursive: true,
  });
  await writeFile(
    join(root, "CoAgenticModel", "registry", "agents", "intel-interpreter", "1.0.0", "manifest.json"),
    JSON.stringify({ id: "intel-interpreter", version: "1.0.0", role: "intel-interpreter" })
  );
}

describe("actor-critic loop", () => {
  it("converges when actor removes redundant policy and adds novel rule", async () => {
    const root = await mkdtemp(join(tmpdir(), "ac-loop-"));
    await seedMinimalRegistry(root);

    const session = await runActorCriticLoop(
      {
        rawProposal: {
          proposalId: "prop-loop-001",
          targetAgentId: "intel-interpreter",
          baseAgentVersion: "1.0.0",
          baseCommitSha: "7756912aa664",
          changeTier: "policy-update",
          objective: "Strengthen attribution corroboration after eval-run-188",
          evidenceRefs: ["eval-run-188"],
          changedFiles: [],
          testsAddedOrChanged: [],
          expectedBenefits: ["Better attribution discipline"],
          knownRisks: ["More conservative outputs"],
          requestedRiskClass: "low",
          policyChanges: [
            {
              path: "policies/agents/intel-interpreter/attribution.json",
              operation: "add-rule",
              rule: "Do not infer attribution from a single degraded source.",
            },
          ],
        },
        maxRounds: 4,
        actorBackend: "deterministic",
        skipEval: true,
        skipShadow: true,
      },
      { repoRoot: root, auditLog: createInMemoryAuditLog() }
    );

    expect(session.status).toBe("converged");
    expect(session.finalProposal).toBeDefined();
    expect(session.rounds.length).toBeGreaterThanOrEqual(1);
    expect(session.rounds[0]?.critic.passed).toBe(false);
    const lastRound = session.rounds.at(-1);
    expect(lastRound?.critic.passed).toBe(true);
  });
});
