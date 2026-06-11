import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type AuditEventType =
  | "proposal-received"
  | "proposal-rejected"
  | "policy-denied"
  | "evaluation-started"
  | "evaluation-completed"
  | "shadow-run"
  | "approval-recorded"
  | "promoted"
  | "rolled-back"
  | "actor-critic-started"
  | "critic-report"
  | "actor-revision"
  | "actor-critic-completed";

export type AuditEvent = {
  id: string;
  type: AuditEventType;
  timestamp: string;
  proposalId?: string;
  releaseId?: string;
  actorId?: string;
  detail: Record<string, unknown>;
};

export type AuditLog = {
  append: (event: Omit<AuditEvent, "id" | "timestamp">) => Promise<AuditEvent>;
  list: (filter?: { proposalId?: string; releaseId?: string }) => Promise<AuditEvent[]>;
};

export function createInMemoryAuditLog(): AuditLog {
  const events: AuditEvent[] = [];
  let seq = 0;

  return {
    async append(event) {
      const record: AuditEvent = {
        id: `audit-${++seq}`,
        timestamp: new Date().toISOString(),
        ...event,
      };
      events.push(record);
      return record;
    },
    async list(filter) {
      return events.filter((event) => {
        if (filter?.proposalId && event.proposalId !== filter.proposalId) return false;
        if (filter?.releaseId && event.releaseId !== filter.releaseId) return false;
        return true;
      });
    },
  };
}

export function createFileAuditLog(rootDir: string): AuditLog {
  const logPath = join(rootDir, "audit.jsonl");

  return {
    async append(event) {
      const record: AuditEvent = {
        id: createHash("sha256")
          .update(JSON.stringify(event) + Date.now())
          .digest("hex")
          .slice(0, 16),
        timestamp: new Date().toISOString(),
        ...event,
      };
      await mkdir(dirname(logPath), { recursive: true });
      await writeFile(logPath, `${JSON.stringify(record)}\n`, { flag: "a" });
      return record;
    },
    async list(filter) {
      try {
        const raw = await readFile(logPath, "utf8");
        const events = raw
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as AuditEvent);
        return events.filter((event) => {
          if (filter?.proposalId && event.proposalId !== filter.proposalId) return false;
          if (filter?.releaseId && event.releaseId !== filter.releaseId) return false;
          return true;
        });
      } catch {
        return [];
      }
    },
  };
}

export function hashPatchContent(changedFiles: Array<{ path: string; patch: string }>): string {
  const h = createHash("sha256");
  for (const file of [...changedFiles].sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(file.path);
    h.update("\0");
    h.update(file.patch);
    h.update("\0");
  }
  return h.digest("hex");
}
