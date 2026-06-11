#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentEvolutionService } from "../server/agentEvolution/service.js";

const proposalPath = process.argv[2];
if (!proposalPath) {
  console.error("Usage: npm run evolution:process-proposal -- <proposal.json>");
  process.exit(1);
}

const raw = JSON.parse(await readFile(proposalPath, "utf8"));
const coda2Root = process.env.CODA2_ROOT ?? join(import.meta.dirname, "../..");
const service = new AgentEvolutionService({ coda2Root });

const result = await service.processProposal({
  rawProposal: raw,
  nextVersion: raw.nextVersion ?? "0.0.1",
  approvals: raw.approvals ?? [],
});

console.log(JSON.stringify(result, null, 2));
process.exit(result.release ? 0 : 1);
