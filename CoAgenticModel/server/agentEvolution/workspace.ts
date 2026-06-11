import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type WorkspaceConstraints = {
  readOnlyBase: boolean;
  noProductionCredentials: boolean;
  noUserSqlite: boolean;
  network: "none" | "npm-registry-only";
  maxDurationMs: number;
  maxDiskMb: number;
};

export const DEFAULT_WORKSPACE_CONSTRAINTS: WorkspaceConstraints = {
  readOnlyBase: true,
  noProductionCredentials: true,
  noUserSqlite: true,
  network: "npm-registry-only",
  maxDurationMs: 15 * 60_000,
  maxDiskMb: 2048,
};

export type IsolatedWorkspace = {
  id: string;
  rootDir: string;
  baseRepoRoot: string;
  constraints: WorkspaceConstraints;
  kind: "git-worktree" | "temp";
  dispose: () => Promise<void>;
};

function execGit(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: "pipe" });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git ${args.join(" ")} failed: ${stderr}`));
    });
  });
}

async function createGitWorktree(baseRepoRoot: string): Promise<IsolatedWorkspace> {
  const worktreesDir = join(baseRepoRoot, "CoAgenticModel", ".worktrees");
  await mkdir(worktreesDir, { recursive: true });
  const id = `ws-${Date.now()}`;
  const rootDir = join(worktreesDir, id);
  await execGit(["worktree", "add", "--detach", rootDir, "HEAD"], baseRepoRoot);

  return {
    id,
    rootDir,
    baseRepoRoot,
    constraints: DEFAULT_WORKSPACE_CONSTRAINTS,
    kind: "git-worktree",
    async dispose() {
      try {
        await execGit(["worktree", "remove", "--force", rootDir], baseRepoRoot);
      } catch {
        await rm(rootDir, { recursive: true, force: true });
      }
    },
  };
}

async function createTempWorkspace(baseRepoRoot: string): Promise<IsolatedWorkspace> {
  const rootDir = await mkdtemp(join(tmpdir(), "coagentic-ws-"));
  const id = rootDir.split("/").pop() ?? "ws-unknown";

  return {
    id,
    rootDir,
    baseRepoRoot,
    constraints: DEFAULT_WORKSPACE_CONSTRAINTS,
    kind: "temp",
    async dispose() {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

/**
 * Creates a disposable evaluation workspace (Git worktree when available).
 */
export async function createIsolatedWorkspace(
  baseRepoRoot: string,
  constraints: WorkspaceConstraints = DEFAULT_WORKSPACE_CONSTRAINTS
): Promise<IsolatedWorkspace> {
  try {
    const ws = await createGitWorktree(baseRepoRoot);
    return { ...ws, constraints };
  } catch {
    const ws = await createTempWorkspace(baseRepoRoot);
    return { ...ws, constraints };
  }
}

export function assertWorkspaceSafeEnv(): void {
  const blocked = ["LLM_API_KEY", "CYBER_LAB_HARNESS_URL", "VITE_CYBER_ALLOW_IN_PROCESS_LAB"];
  for (const key of blocked) {
    if (process.env[key]) {
      throw new Error(`Unsafe credential present in evaluator environment: ${key}`);
    }
  }
}
