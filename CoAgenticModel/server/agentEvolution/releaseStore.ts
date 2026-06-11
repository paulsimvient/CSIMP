import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentReleaseRecord } from "../../src/types/release";

export type ReleaseStore = {
  list: () => Promise<AgentReleaseRecord[]>;
  get: (releaseId: string) => Promise<AgentReleaseRecord | undefined>;
  save: (release: AgentReleaseRecord) => Promise<void>;
  update: (
    releaseId: string,
    updater: (current: AgentReleaseRecord) => AgentReleaseRecord
  ) => Promise<AgentReleaseRecord>;
};

export function createInMemoryReleaseStore(initial: AgentReleaseRecord[] = []): ReleaseStore {
  const releases = new Map<string, AgentReleaseRecord>(
    initial.map((release) => [release.releaseId, release])
  );

  return {
    async list() {
      return [...releases.values()].sort((a, b) =>
        (b.deployedAt ?? "").localeCompare(a.deployedAt ?? "")
      );
    },
    async get(releaseId) {
      return releases.get(releaseId);
    },
    async save(release) {
      releases.set(release.releaseId, release);
    },
    async update(releaseId, updater) {
      const current = releases.get(releaseId);
      if (!current) throw new Error(`Release not found: ${releaseId}`);
      const next = updater(current);
      releases.set(releaseId, next);
      return next;
    },
  };
}

export function createFileReleaseStore(dataDir: string): ReleaseStore {
  const filePath = join(dataDir, "releases.json");
  let memory = createInMemoryReleaseStore();

  async function hydrate() {
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as AgentReleaseRecord[];
      memory = createInMemoryReleaseStore(parsed);
    } catch {
      memory = createInMemoryReleaseStore();
    }
  }

  async function persist() {
    await mkdir(dataDir, { recursive: true });
    const all = await memory.list();
    await writeFile(filePath, `${JSON.stringify(all, null, 2)}\n`, "utf8");
  }

  return {
    async list() {
      await hydrate();
      return memory.list();
    },
    async get(releaseId) {
      await hydrate();
      return memory.get(releaseId);
    },
    async save(release) {
      await hydrate();
      await memory.save(release);
      await persist();
    },
    async update(releaseId, updater) {
      await hydrate();
      const next = await memory.update(releaseId, updater);
      await persist();
      return next;
    },
  };
}
