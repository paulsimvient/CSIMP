import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DoctrineFossil } from "../../src/types/doctrine";

export type FossilStore = {
  list: () => Promise<DoctrineFossil[]>;
  get: (fossilId: string) => Promise<DoctrineFossil | undefined>;
  save: (fossil: DoctrineFossil) => Promise<void>;
};

export function createInMemoryFossilStore(initial: DoctrineFossil[] = []): FossilStore {
  const fossils = new Map(initial.map((f) => [f.fossilId, f]));
  return {
    async list() {
      return [...fossils.values()].sort((a, b) =>
        b.firstObservedAt.localeCompare(a.firstObservedAt)
      );
    },
    async get(id) {
      return fossils.get(id);
    },
    async save(fossil) {
      fossils.set(fossil.fossilId, fossil);
    },
  };
}

export function createFileFossilStore(dataDir: string): FossilStore {
  const filePath = join(dataDir, "fossils.json");
  let memory = createInMemoryFossilStore();

  async function hydrate() {
    try {
      const raw = await readFile(filePath, "utf8");
      memory = createInMemoryFossilStore(JSON.parse(raw) as DoctrineFossil[]);
    } catch {
      memory = createInMemoryFossilStore();
    }
  }

  async function persist() {
    await mkdir(dataDir, { recursive: true });
    await writeFile(filePath, `${JSON.stringify(await memory.list(), null, 2)}\n`, "utf8");
  }

  return {
    async list() {
      await hydrate();
      return memory.list();
    },
    async get(id) {
      await hydrate();
      return memory.get(id);
    },
    async save(fossil) {
      await hydrate();
      await memory.save(fossil);
      await persist();
    },
  };
}
