import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PolicyChange } from "../../src/types/proposal";
import { loadRegistryAgent, registryRoot } from "./registry";

type PolicyDocument = {
  agentId?: string;
  version?: string;
  rules?: string[];
  thresholds?: Record<string, number>;
  [key: string]: unknown;
};

export async function applyPolicyVersion(
  repoRoot: string,
  agentId: string,
  baseVersion: string,
  nextVersion: string,
  changes: PolicyChange[]
): Promise<string[]> {
  const baseDir = join(registryRoot(repoRoot), agentId, baseVersion);
  const nextDir = join(registryRoot(repoRoot), agentId, nextVersion);

  await cp(baseDir, nextDir, { recursive: true });

  const written: string[] = [];

  for (const change of changes) {
    const prefix = `policies/agents/${agentId}/`;
    if (!change.path.startsWith(prefix)) {
      throw new Error(`Policy change path outside agent scope: ${change.path}`);
    }
    const relative = change.path.slice(prefix.length);
    const absPath = join(nextDir, "policies", relative);

    let doc: PolicyDocument = {};
    try {
      doc = JSON.parse(await readFile(absPath, "utf8")) as PolicyDocument;
    } catch {
      await mkdir(dirname(absPath), { recursive: true });
    }

    doc.agentId = agentId;
    doc.version = nextVersion;

    if (change.operation === "add-rule" && change.rule) {
      const rules = doc.rules ?? [];
      if (!rules.includes(change.rule)) {
        rules.push(change.rule);
      }
      doc.rules = rules;
    } else if (change.operation === "remove-rule" && change.rule) {
      doc.rules = (doc.rules ?? []).filter((rule) => rule !== change.rule);
    } else if (change.operation === "replace-rule" && change.rule && change.key) {
      const rules = doc.rules ?? [];
      const idx = rules.findIndex((rule) => rule.startsWith(change.key!));
      if (idx >= 0) rules[idx] = change.rule;
      else rules.push(change.rule);
      doc.rules = rules;
    } else if (change.operation === "set-threshold" && change.key) {
      doc.thresholds = { ...(doc.thresholds ?? {}), [change.key]: Number(change.value) };
    } else {
      throw new Error(`Unsupported policy operation: ${change.operation}`);
    }

    await writeFile(absPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    written.push(join("registry", "agents", agentId, nextVersion, "policies", relative));
  }

  const manifestPath = join(nextDir, "manifest.json");
  const manifest = await loadRegistryAgent(repoRoot, agentId, baseVersion);
  manifest.version = nextVersion;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  written.push(join("registry", "agents", agentId, nextVersion, "manifest.json"));

  return written;
}
