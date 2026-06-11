#!/usr/bin/env tsx
import { join } from "node:path";
import { runAgentEvalSuite, type AgentEvalSuite } from "../server/agentEvolution/evalAgents.js";

const args = process.argv.slice(2);
function readFlag(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const agent = readFlag("--agent") ?? "intel-interpreter";
const suite = (readFlag("--suite") ?? "regression") as AgentEvalSuite;
const coda2Root = process.env.CODA2_ROOT ?? join(import.meta.dirname, "../..");

const result = await runAgentEvalSuite({ coda2Root, agentId: agent, suite });
console.log(JSON.stringify({ agent, suite, result }, null, 2));
process.exit(result.passed ? 0 : 1);
