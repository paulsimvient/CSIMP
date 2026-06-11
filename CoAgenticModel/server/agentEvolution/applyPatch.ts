import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChangedFile } from "../../src/types/proposal";
import {
  applyUnifiedDiff,
  expandMultiFilePatches,
  isUnifiedDiff,
} from "./applyUnifiedDiff";

async function readBaseFile(repoRoot: string, relativePath: string): Promise<string> {
  try {
    return await readFile(join(repoRoot, relativePath), "utf8");
  } catch {
    return "";
  }
}

async function seedBaseFile(
  workspaceRoot: string,
  repoRoot: string,
  relativePath: string
): Promise<void> {
  const dest = join(workspaceRoot, relativePath);
  await mkdir(dirname(dest), { recursive: true });
  try {
    await cp(join(repoRoot, relativePath), dest);
  } catch {
    // new file
  }
}

async function resolvePatchContent(repoRoot: string, file: ChangedFile): Promise<string> {
  const normalizedPath = file.path.replace(/\\/g, "/");
  if (!isUnifiedDiff(file.patch)) {
    return file.patch.endsWith("\n") ? file.patch : `${file.patch}\n`;
  }
  const base = await readBaseFile(repoRoot, normalizedPath);
  const patched = applyUnifiedDiff(base, file.patch);
  return patched.endsWith("\n") ? patched : `${patched}\n`;
}

/**
 * Apply agent-module file changes inside a workspace root.
 * Unified diffs are resolved against repoRoot as the base revision.
 */
export async function applyChangedFiles(
  workspaceRoot: string,
  repoRoot: string,
  changedFiles: ChangedFile[]
): Promise<string[]> {
  const written: string[] = [];
  const expanded = expandMultiFilePatches(changedFiles);

  for (const file of expanded) {
    const normalizedPath = file.path.replace(/\\/g, "/");
    await seedBaseFile(workspaceRoot, repoRoot, normalizedPath);
    const content = await resolvePatchContent(repoRoot, { ...file, path: normalizedPath });
    const targetPath = join(workspaceRoot, normalizedPath);
    await writeFile(targetPath, content, "utf8");
    written.push(normalizedPath);
  }

  return written;
}

/** Materialize approved agent-module patches into the CODA2 repo. */
export async function materializeAgentModulePatches(
  repoRoot: string,
  changedFiles: ChangedFile[]
): Promise<string[]> {
  return applyChangedFiles(repoRoot, repoRoot, changedFiles);
}
