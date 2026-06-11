import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LineageTrustRecord } from "../../src/types/doctrine";

export type LineageTrustStore = {
  get: (agentId: string) => Promise<LineageTrustRecord | undefined>;
  save: (record: LineageTrustRecord) => Promise<void>;
  list: () => Promise<LineageTrustRecord[]>;
};

export function createInMemoryLineageTrustStore(
  initial: LineageTrustRecord[] = []
): LineageTrustStore {
  const records = new Map(initial.map((r) => [r.agentId, r]));
  return {
    async get(agentId) {
      return records.get(agentId);
    },
    async save(record) {
      records.set(record.agentId, record);
    },
    async list() {
      return [...records.values()];
    },
  };
}

export function createFileLineageTrustStore(dataDir: string): LineageTrustStore {
  const filePath = join(dataDir, "lineage-trust.json");
  let memory = createInMemoryLineageTrustStore();

  async function hydrate() {
    try {
      const raw = await readFile(filePath, "utf8");
      memory = createInMemoryLineageTrustStore(JSON.parse(raw) as LineageTrustRecord[]);
    } catch {
      memory = createInMemoryLineageTrustStore();
    }
  }

  async function persist() {
    await mkdir(dataDir, { recursive: true });
    await writeFile(filePath, `${JSON.stringify(await memory.list(), null, 2)}\n`, "utf8");
  }

  return {
    async get(agentId) {
      await hydrate();
      return memory.get(agentId);
    },
    async save(record) {
      await hydrate();
      await memory.save(record);
      await persist();
    },
    async list() {
      await hydrate();
      return memory.list();
    },
  };
}
