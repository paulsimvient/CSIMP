import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyChangedFiles } from "./applyPatch";

describe("applyChangedFiles", () => {
  it("writes full-file patches to workspace", async () => {
    const repoRoot = join(import.meta.dirname, "../../..");
    const workspace = await mkdtemp(join(tmpdir(), "patch-ws-"));
    try {
      const written = await applyChangedFiles(workspace, repoRoot, [
        {
          path: "CoAgenticModel/src/agents/intelInterpreter/patch-test.txt",
          patch: "patched-content\n",
          reason: "test",
        },
      ]);
      expect(written).toHaveLength(1);
      const content = await readFile(
        join(workspace, "CoAgenticModel/src/agents/intelInterpreter/patch-test.txt"),
        "utf8"
      );
      expect(content).toBe("patched-content\n");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
