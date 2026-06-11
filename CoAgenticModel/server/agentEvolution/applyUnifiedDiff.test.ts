import { describe, expect, it } from "vitest";
import {
  applyMultiFileUnifiedDiff,
  applyUnifiedDiff,
  expandMultiFilePatches,
  isMultiFileUnifiedDiff,
  isUnifiedDiff,
  parseUnifiedDiffSections,
} from "./applyUnifiedDiff";

describe("applyUnifiedDiff", () => {
  it("detects unified diff patches", () => {
    expect(isUnifiedDiff("--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-x\n+y")).toBe(true);
    expect(isUnifiedDiff("export const x = 1;")).toBe(false);
  });

  it("applies a single hunk", () => {
    const base = "line1\nline2\nline3\n";
    const patch = `--- a/file.ts
+++ b/file.ts
@@ -2,1 +2,1 @@
-line2
+line2-updated
`;
    expect(applyUnifiedDiff(base, patch)).toBe("line1\nline2-updated\nline3\n");
  });

  it("applies multiple hunks in one file", () => {
    const base = "alpha\nbeta\ngamma\ndelta\n";
    const patch = `--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,2 @@
-alpha
+ALPHA
 beta
@@ -3,2 +3,2 @@
 gamma
-delta
+DELTA
`;
    expect(applyUnifiedDiff(base, patch)).toBe("ALPHA\nbeta\ngamma\nDELTA\n");
  });

  it("creates a new file from /dev/null", () => {
    const patch = `--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
`;
    expect(applyUnifiedDiff("", patch)).toBe("export const x = 1;\nexport const y = 2;\n");
  });

  it("parses and applies multi-file diff bundles", () => {
    const patch = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1 +1 @@
-old
+new
diff --git a/bar.ts b/bar.ts
--- a/bar.ts
+++ b/bar.ts
@@ -1 +1 @@
-a
+b
`;
    expect(isMultiFileUnifiedDiff(patch)).toBe(true);
    const sections = parseUnifiedDiffSections(patch);
    expect(sections).toHaveLength(2);

    const result = applyMultiFileUnifiedDiff(
      { "foo.ts": "old\n", "bar.ts": "a\n" },
      patch
    );
    expect(result["foo.ts"]).toBe("new\n");
    expect(result["bar.ts"]).toBe("b\n");
  });

  it("expands multi-file patches into per-file changedFiles", () => {
    const patch = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-x
+y
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-1
+2
`;
    const expanded = expandMultiFilePatches([
      { path: "bundle.patch", patch, reason: "combined" },
    ]);
    expect(expanded).toHaveLength(2);
    expect(expanded[0]?.path).toBe("a.ts");
    expect(expanded[1]?.path).toBe("b.ts");
  });

  it("ignores \\ No newline at end of file markers", () => {
    const base = "keep\n";
    const patch = `--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,2 @@
 keep
+added
\\ No newline at end of file
`;
    expect(applyUnifiedDiff(base, patch)).toBe("keep\nadded\n");
  });
});
