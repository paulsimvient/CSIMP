import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DoctrineForgeService } from "./doctrineForgeService";

describe("DoctrineForgeService", () => {
  let dataDir: string;
  let service: DoctrineForgeService;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "doctrine-forge-"));
    service = new DoctrineForgeService({
      coda2Root: join(import.meta.dirname, "../../../.."),
      dataDir,
    });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("records demo failure, persists fossil, and forges scenarios", async () => {
    const result = await service.recordDemoFailure();
    expect(result.fossil.fossilId).toMatch(/^fossil-/);
    expect(result.forgedScenarios.length).toBeGreaterThan(0);
    expect(result.causalTrace.minimalCounterexample).toBeTruthy();

    const fossils = await service.listFossils();
    expect(fossils.some((f) => f.fossilId === result.fossil.fossilId)).toBe(true);
  });

  it("builds capability passport with replay results", async () => {
    const recorded = await service.recordDemoFailure();
    const { passport, summary, regressionRejected } = await service.buildPassport({
      agentId: "intel-interpreter",
      agentVersion: "1.4.0",
      parentVersion: "1.0.0",
      rollbackTarget: "1.0.0",
      fossilIds: [recorded.fossil.fossilId],
    });

    expect(passport.passportId).toMatch(/^passport-/);
    expect(passport.worldsGenerated).toBeGreaterThan(0);
    expect(passport.signature.length).toBeGreaterThan(16);
    expect(summary).toContain("survived");
    expect(regressionRejected).toBe(false);

    const loaded = await service.getPassport(passport.passportId);
    expect(loaded?.passportId).toBe(passport.passportId);
  });
});
