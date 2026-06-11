import type { ChangedFile } from "../../src/types/proposal";

type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

export type FileDiffSection = {
  oldPath: string;
  newPath: string;
  hunks: Hunk[];
  isNewFile: boolean;
  isDeletedFile: boolean;
};

function parseHunkHeader(header: string): Pick<Hunk, "oldStart" | "oldLines" | "newStart" | "newLines"> {
  const match = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) {
    throw new Error(`Invalid hunk header: ${header}`);
  }
  return {
    oldStart: Number(match[1]),
    oldLines: match[2] ? Number(match[2]) : 1,
    newStart: Number(match[3]),
    newLines: match[4] ? Number(match[4]) : 1,
  };
}

function stripPathPrefix(path: string): string {
  return path.replace(/^(?:a|b)\//, "").trim();
}

function parseHunksFromLines(
  lines: string[],
  startIndex: number
): { hunks: Hunk[]; nextIndex: number } {
  let i = startIndex;
  const hunks: Hunk[] = [];

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("diff --git ") || (line.startsWith("--- ") && hunks.length > 0)) {
      break;
    }
    if (!line.startsWith("@@")) {
      i += 1;
      continue;
    }

    const header = parseHunkHeader(line);
    i += 1;
    const hunkLines: string[] = [];

    while (i < lines.length) {
      const current = lines[i]!;
      if (
        current.startsWith("@@") ||
        current.startsWith("diff --git ") ||
        (current.startsWith("--- ") && hunkLines.length > 0)
      ) {
        break;
      }
      if (current.startsWith("\\ No newline")) {
        i += 1;
        continue;
      }
      if (current.startsWith(" ") || current.startsWith("+") || current.startsWith("-")) {
        hunkLines.push(current);
      }
      i += 1;
    }

    hunks.push({ ...header, lines: hunkLines });
  }

  return { hunks, nextIndex: i };
}

/** Parse one or more file sections from a unified diff (single- or multi-file). */
export function parseUnifiedDiffSections(patch: string): FileDiffSection[] {
  const normalized = patch.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const sections: FileDiffSection[] = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i]!.startsWith("diff --git ")) {
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith("--- ") && !lines[i]!.startsWith("@@")) {
        i += 1;
      }
    }

    if (i >= lines.length) break;

    if (!lines[i]!.startsWith("--- ")) {
      i += 1;
      continue;
    }

    const oldPathRaw = lines[i]!.slice(4).trim();
    i += 1;
    if (i >= lines.length || !lines[i]!.startsWith("+++ ")) {
      throw new Error(`Missing +++ line after --- ${oldPathRaw}`);
    }
    const newPathRaw = lines[i]!.slice(4).trim();
    i += 1;

    const isNewFile = oldPathRaw === "/dev/null";
    const isDeletedFile = newPathRaw === "/dev/null";
    const oldPath = isNewFile ? stripPathPrefix(newPathRaw) : stripPathPrefix(oldPathRaw);
    const newPath = isDeletedFile ? oldPath : stripPathPrefix(newPathRaw);

    const { hunks, nextIndex } = parseHunksFromLines(lines, i);
    i = nextIndex;

    if (hunks.length > 0 || isNewFile || isDeletedFile) {
      sections.push({ oldPath, newPath, hunks, isNewFile, isDeletedFile });
    }
  }

  if (sections.length === 0) {
    const { hunks } = parseHunksFromLines(lines, 0);
    if (hunks.length > 0) {
      sections.push({
        oldPath: "",
        newPath: "",
        hunks,
        isNewFile: false,
        isDeletedFile: false,
      });
    }
  }

  return sections;
}

export function applyHunks(baseContent: string, hunks: Hunk[]): string {
  const result = baseContent.replace(/\r\n/g, "\n").split("\n");
  let lineOffset = 0;

  for (const hunk of hunks) {
    let index =
      hunk.oldLines === 0
        ? hunk.newStart - 1 + lineOffset
        : hunk.oldStart - 1 + lineOffset;
    for (const hunkLine of hunk.lines) {
      const prefix = hunkLine[0];
      const text = hunkLine.slice(1);
      if (prefix === " ") {
        if (result[index] !== text) {
          throw new Error(
            `Context mismatch at line ${index + 1}: expected "${text}", got "${result[index] ?? ""}"`
          );
        }
        index += 1;
      } else if (prefix === "-") {
        if (result[index] !== text) {
          throw new Error(
            `Removal mismatch at line ${index + 1}: expected "${text}", got "${result[index] ?? ""}"`
          );
        }
        result.splice(index, 1);
        lineOffset -= 1;
      } else if (prefix === "+") {
        result.splice(index, 0, text);
        index += 1;
        lineOffset += 1;
      }
    }
  }

  return result.join("\n");
}

/** Apply a single-file unified diff to base content. */
export function applyUnifiedDiff(baseContent: string, patch: string): string {
  const sections = parseUnifiedDiffSections(patch);
  if (sections.length === 0) {
    throw new Error("No hunks found in unified diff");
  }
  if (sections.length > 1) {
    throw new Error("Patch contains multiple files — use applyMultiFileUnifiedDiff");
  }

  const section = sections[0]!;
  if (section.isDeletedFile) {
    return "";
  }
  const base = section.isNewFile ? "" : baseContent;
  return applyHunks(base, section.hunks);
}

/** Apply a multi-file unified diff bundle against a map of path → content. */
export function applyMultiFileUnifiedDiff(
  baseFiles: Record<string, string>,
  patch: string
): Record<string, string> {
  const result = { ...baseFiles };
  const sections = parseUnifiedDiffSections(patch);

  for (const section of sections) {
    const path = section.newPath || section.oldPath;
    if (!path) continue;

    if (section.isDeletedFile) {
      delete result[path];
      continue;
    }

    const base = section.isNewFile ? "" : (result[path] ?? baseFiles[path] ?? "");
    result[path] = applyHunks(base, section.hunks);
  }

  return result;
}

export function sectionToPatch(section: FileDiffSection): string {
  const targetPath = section.newPath || section.oldPath;
  const oldPath = section.isNewFile ? "/dev/null" : `a/${targetPath}`;
  const newPath = section.isDeletedFile ? "/dev/null" : `b/${targetPath}`;
  const lines = [`--- ${oldPath}`, `+++ ${newPath}`];
  for (const hunk of section.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    lines.push(...hunk.lines);
  }
  return `${lines.join("\n")}\n`;
}

export function isMultiFileUnifiedDiff(patch: string): boolean {
  return parseUnifiedDiffSections(patch).length > 1;
}

export type DiffChangedFile = Pick<ChangedFile, "path" | "patch"> & { reason?: string };

/** Split a combined multi-file diff into per-file ChangedFile entries. */
export function expandMultiFilePatches(changedFiles: DiffChangedFile[]): ChangedFile[] {
  const expanded: ChangedFile[] = [];

  for (const file of changedFiles) {
    if (!isUnifiedDiff(file.patch) || !isMultiFileUnifiedDiff(file.patch)) {
      expanded.push({ path: file.path, patch: file.patch, reason: file.reason ?? "patch" });
      continue;
    }

    for (const section of parseUnifiedDiffSections(file.patch)) {
      const path = section.newPath || section.oldPath;
      if (!path || section.isDeletedFile) continue;
      expanded.push({
        path,
        patch: sectionToPatch(section),
        reason: file.reason ?? "multi-file diff section",
      });
    }
  }

  return expanded;
}

export function isUnifiedDiff(patch: string): boolean {
  const trimmed = patch.trimStart();
  return (
    trimmed.startsWith("--- ") ||
    trimmed.startsWith("diff ") ||
    trimmed.includes("\n@@ ")
  );
}
