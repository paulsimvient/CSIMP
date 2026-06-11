import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EnvelopeRouteRecord } from "../../src/types/doctrine";

export type EnvelopeRouteStore = {
  get: (agentId: string) => Promise<EnvelopeRouteRecord | undefined>;
  save: (record: EnvelopeRouteRecord) => Promise<void>;
  list: () => Promise<EnvelopeRouteRecord[]>;
};

export function createInMemoryEnvelopeRouteStore(
  initial: EnvelopeRouteRecord[] = []
): EnvelopeRouteStore {
  const routes = new Map(initial.map((r) => [r.agentId, r]));
  return {
    async get(agentId) {
      return routes.get(agentId);
    },
    async save(record) {
      routes.set(record.agentId, record);
    },
    async list() {
      return [...routes.values()];
    },
  };
}

export function createFileEnvelopeRouteStore(dataDir: string): EnvelopeRouteStore {
  const filePath = join(dataDir, "envelope-routes.json");
  let memory = createInMemoryEnvelopeRouteStore();

  async function hydrate() {
    try {
      const raw = await readFile(filePath, "utf8");
      memory = createInMemoryEnvelopeRouteStore(JSON.parse(raw) as EnvelopeRouteRecord[]);
    } catch {
      memory = createInMemoryEnvelopeRouteStore();
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
