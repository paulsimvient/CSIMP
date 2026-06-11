import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CapabilityPassport } from "../../src/types/doctrine";

export type PassportStore = {
  list: () => Promise<CapabilityPassport[]>;
  get: (passportId: string) => Promise<CapabilityPassport | undefined>;
  save: (passport: CapabilityPassport) => Promise<void>;
};

export function createInMemoryPassportStore(initial: CapabilityPassport[] = []): PassportStore {
  const passports = new Map(initial.map((p) => [p.passportId, p]));
  return {
    async list() {
      return [...passports.values()].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
    },
    async get(id) {
      return passports.get(id);
    },
    async save(passport) {
      passports.set(passport.passportId, passport);
    },
  };
}

export function createFilePassportStore(dataDir: string): PassportStore {
  const filePath = join(dataDir, "passports.json");
  let memory = createInMemoryPassportStore();

  async function hydrate() {
    try {
      const raw = await readFile(filePath, "utf8");
      memory = createInMemoryPassportStore(JSON.parse(raw) as CapabilityPassport[]);
    } catch {
      memory = createInMemoryPassportStore();
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
    async save(passport) {
      await hydrate();
      await memory.save(passport);
      await persist();
    },
  };
}
