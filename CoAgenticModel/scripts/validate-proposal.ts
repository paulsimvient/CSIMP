#!/usr/bin/env tsx
/**
 * Validate a patch proposal JSON file against schema + policy (no filesystem writes).
 *
 * Usage:
 *   npm run evolution:validate-proposal -- examples/policy-proposal.json
 */

import { readFile } from "node:fs/promises";
import { AgentEvolutionPipeline } from "../server/agentEvolution/index.js";
import { join } from "node:path";

const proposalPath = process.argv[2];
if (!proposalPath) {
  console.error("Usage: npm run evolution:validate-proposal -- <proposal.json>");
  process.exit(1);
}

const raw = JSON.parse(await readFile(proposalPath, "utf8"));
const repoRoot = join(import.meta.dirname, "..");
const pipeline = new AgentEvolutionPipeline({ repoRoot, skipEvaluation: true });

const results = await pipeline.processProposal({
  rawProposal: raw,
  nextVersion: raw.nextVersion ?? "0.0.1",
  approvals: raw.approvals ?? [],
});

for (const step of results) {
  console.log(JSON.stringify(step, null, 2));
}

const failed = results.some(
  (step) =>
    ("ok" in step && step.ok === false) ||
    (step.stage === "promotion" && !step.ok)
);

process.exit(failed ? 1 : 0);
