// image-token-saver Sandcastle loop: implement -> review -> check -> PR.
// Do not merge. Do not push to main. Do not set branch protection from this loop.

import * as sandcastle from "@ai-hero/sandcastle";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

const MAX_ITERATIONS = Number(process.env.MAX_ITERATIONS ?? "10");
const MAX_FIX_ATTEMPTS = Number(process.env.MAX_FIX_ATTEMPTS ?? "3");
const IMAGE = process.env.SANDCASTLE_IMAGE ?? "localhost/sandcastle:image-token-saver";
const TEMPLATE = process.env.SANDCASTLE_TEMPLATE ?? "/workspace/image-token-saver-loop/template";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5";
const REVIEWER_MODEL = process.env.REVIEWER_MODEL ?? "composer-2.5-fast";
const REVIEWER_CLAUDE_MODEL = process.env.REVIEWER_CLAUDE_MODEL ?? "claude-opus-5-5";
const LIMIT_ERROR = /credit|quota|usage limit|rate limit|payment|out of (fast )?requests|insufficient/i;
const LABEL = "Sandcastle";
const SKIP = new Set((process.env.SKIP_ISSUES ?? "").split(",").filter(Boolean).map(Number));

function sandboxRuntime() {
  return podman({ imageName: IMAGE, userns: "keep-id" });
}

type RunOptions = Omit<Parameters<sandcastle.Sandbox["run"]>[0], "agent">;

function logHasLimitError(name?: string): boolean {
  try {
    const dir = ".sandcastle/logs";
    const files = readdirSync(dir)
      .filter((f) => name && f.endsWith(`-${name}.log`))
      .map((f) => join(dir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    return files.length > 0 && LIMIT_ERROR.test(readFileSync(files[0], "utf8").slice(-4000));
  } catch {
    return false;
  }
}

async function runWithAgent(
  sandbox: sandcastle.Sandbox,
  options: RunOptions,
  makeAgent: () => ReturnType<typeof sandcastle.claudeCode>,
  fallback?: () => ReturnType<typeof sandcastle.claudeCode>,
  fallbackLabel?: string,
) {
  try {
    const result = await sandbox.run({ ...options, agent: makeAgent() });
    return result;
  } catch (error) {
    const text = `${error}`;
    if (fallback && (LIMIT_ERROR.test(text) || logHasLimitError(options.name))) {
      console.log(`${fallbackLabel ?? "Agent"} failed (${text.slice(0, 200)}). Change agent and run again.`);
      return sandbox.run({ ...options, agent: fallback() });
    }
    throw error;
  }
}

async function runImplementer(sandbox: sandcastle.Sandbox, options: RunOptions) {
  return runWithAgent(sandbox, options, () => sandcastle.claudeCode(CLAUDE_MODEL));
}

async function runReviewerOrFixer(sandbox: sandcastle.Sandbox, options: RunOptions) {
  if (process.env.CURSOR_API_KEY) {
    try {
      const result = await sandbox.run({ ...options, agent: sandcastle.cursor(REVIEWER_MODEL) });
      if (!result.commits.length && logHasLimitError(options.name)) {
        throw new Error("cursor limit");
      }
      return result;
    } catch (error) {
      const text = `${error}`;
      if (LIMIT_ERROR.test(text) || logHasLimitError(options.name) || /print-mode prompt is \d+ bytes|max 122880/i.test(text)) {
        console.log(`Cursor reviewer failed (${text.slice(0, 240)}). Change to ${REVIEWER_CLAUDE_MODEL}.`);
        return sandbox.run({ ...options, agent: sandcastle.claudeCode(REVIEWER_CLAUDE_MODEL) });
      }
      throw error;
    }
  }
  return sandbox.run({ ...options, agent: sandcastle.claudeCode(REVIEWER_CLAUDE_MODEL) });
}

const hooks = {
  sandbox: {
    onSandboxReady: [
      { command: "node -v && npm -v && command -v claude && command -v gh && command -v prettier && command -v eslint && command -v tsc" },
    ],
  },
};

function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

interface Issue { number: number; title: string; body: string; labels: { name: string }[] }

const PRIORITY: Record<string, number> = {
  "priority: critical": 0, "priority: high": 1, "priority: medium": 2, "priority: low": 3,
};
function priority(issue: Issue): number {
  const values = issue.labels.map((l) => PRIORITY[l.name]).filter((v) => v !== undefined);
  return values.length ? Math.min(...values) : PRIORITY["priority: medium"];
}

function nextIssue(handled: Set<number>): Issue | undefined {
  const open: Issue[] = JSON.parse(
    sh("gh", ["issue", "list", "--state", "open", "--label", LABEL, "--limit", "100", "--json", "number,title,body,labels"]),
  );
  const openNumbers = new Set(open.map((i) => i.number).filter((n) => !handled.has(n)));
  open.splice(0, open.length, ...open.filter((i) => !handled.has(i.number) && !SKIP.has(i.number)));
  const ready = open.filter((i) => {
    const blockers = [...i.body.matchAll(/Blocked by\s+((?:#\d+[\s,and]*)+)/gi)]
      .flatMap((m) => [...m[1].matchAll(/#(\d+)/g)].map((n) => Number(n[1])));
    return blockers.every((b) => !openNumbers.has(b));
  });
  ready.sort((a, b) => priority(a) - priority(b) || a.number - b.number);
  if (open.length && !ready.length) console.log("All open issues are blocked.");
  return ready.find((i) => sh("gh", ["issue", "view", String(i.number), "--json", "state", "--jq", ".state"]) === "OPEN");
}

function restoreHostFiles() {
  if (!existsSync(TEMPLATE)) {
    console.log(`Host template missing: ${TEMPLATE}`);
    return;
  }
  const destSandcastle = ".sandcastle";
  mkdirSync(destSandcastle, { recursive: true });
  const envPath = join(destSandcastle, ".env");
  const hadEnv = existsSync(envPath);
  let envBackup: string | undefined;
  if (hadEnv) envBackup = readFileSync(envPath, "utf8");
  cpSync(join(TEMPLATE, ".sandcastle"), destSandcastle, { recursive: true });
  if (existsSync(join(destSandcastle, ".env"))) {
    // Template must not carry a secret .env. Remove a copied one.
    try { spawnSync("rm", ["-f", join(destSandcastle, ".env")]); } catch { /* ignore */ }
  }
  if (envBackup !== undefined) {
    // Write back without printing.
    spawnSync("bash", ["-lc", "cat > .sandcastle/.env && chmod 600 .sandcastle/.env"], { input: envBackup, encoding: "utf8" });
  }
  for (const rel of ["package.json", "package-lock.json", ".gitignore", "scripts/start-loop.sh"]) {
    const src = join(TEMPLATE, rel);
    if (existsSync(src)) {
      mkdirSync(join(".", rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "."), { recursive: true });
      cpSync(src, rel);
      if (rel.endsWith(".sh")) spawnSync("chmod", ["+x", rel]);
    }
  }
}

function bootstrapIssueBranch(branch: string) {
  sh("git", ["fetch", "origin", "main"]);
  sh("git", ["checkout", "-B", branch, "origin/main"]);
  restoreHostFiles();
  const paths = [
    ".sandcastle/Containerfile",
    ".sandcastle/.env.example",
    ".sandcastle/.gitignore",
    ".sandcastle/CODING_STANDARDS.md",
    ".sandcastle/implement-prompt.md",
    ".sandcastle/review-prompt.md",
    ".sandcastle/fix-prompt.md",
    ".sandcastle/main.mts",
    "package.json",
    ".gitignore",
    "scripts/start-loop.sh",
  ];
  if (existsSync("package-lock.json")) paths.push("package-lock.json");
  spawnSync("git", ["add", "--", ...paths], { stdio: "inherit" });
  const porcelain = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" }).stdout.trim();
  if (porcelain) {
    sh("git", ["commit", "-m", "RALPH: bootstrap non-secret Sandcastle files for the issue branch"]);
    console.log(`Bootstrapped non-secret Sandcastle files onto ${branch}.`);
  }
  // Sandcastle creates its own worktree for this branch. Leave the host
  // working tree on main, or git will refuse a second checkout of the same branch.
  sh("git", ["checkout", "-f", "main"]);
  restoreHostFiles();
}

async function runChecks(sandbox: sandcastle.Sandbox): Promise<{ ok: boolean; log: string }> {
  const hasPre = (await sandbox.exec("test -x scripts/precommit.sh")).exitCode === 0;
  if (hasPre) {
    const pre = await sandbox.exec("scripts/precommit.sh > /tmp/precommit.log 2>&1; rc=$?; tail -n 200 /tmp/precommit.log; exit $rc");
    return { ok: pre.exitCode === 0, log: `## scripts/precommit.sh\n${pre.stdout}\n` };
  }
  // Until issue #2 adds precommit, run any npm scripts that already exist. Do not skip a missing required tool after it is wired.
  let log = "## scripts/precommit.sh is missing\n";
  const pkgExists = (await sandbox.exec("test -f package.json")).exitCode === 0;
  if (!pkgExists) {
    return { ok: false, log: log + "package.json is also missing.\n" };
  }
  // Until issue #2 adds precommit, do not fail the skeleton only because format tools
  // have no project config yet. Issue #3 will wire the same checks as CI.
  log += "No precommit script yet. Local format/lint/typecheck/test run after that script exists.\n";
  return { ok: true, log };
}

const handled = new Set<number>();
console.log(`Implementer: claude ${CLAUDE_MODEL}`);
console.log(`Reviewer: ${process.env.CURSOR_API_KEY ? `cursor ${REVIEWER_MODEL}` : `claude ${REVIEWER_CLAUDE_MODEL}`}`);
console.log(`Image: ${IMAGE}`);

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  restoreHostFiles();
  sh("git", ["checkout", "-f", "main"]);
  spawnSync("git", ["pull", "--rebase", "origin", "main"], { stdio: "inherit" });
  restoreHostFiles();
  let issue = nextIssue(handled);
  if (!issue) {
    await new Promise((r) => setTimeout(r, 30_000));
    issue = nextIssue(handled);
  }
  if (!issue) { console.log("No ready issue. Stopping."); break; }
  if (handled.has(issue.number)) { console.log(`Issue #${issue.number} is already handled. Stopping.`); break; }
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS}: issue #${issue.number} ${issue.title} ===\n`);

  const existing = JSON.parse(sh("gh", ["pr", "list", "--state", "open", "--json", "url,headRefName"]))
    .find((p: { headRefName: string }) => p.headRefName.startsWith(`sandcastle/issue-${issue.number}-`));
  const localBranch = spawnSync(
    "git",
    ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", `refs/heads/sandcastle/issue-${issue.number}-*`],
    { encoding: "utf8" },
  ).stdout.trim().split("\n").filter(Boolean)[0];
  const branch: string = existing?.headRefName ?? localBranch ?? `sandcastle/issue-${issue.number}-${Date.now()}`;
  const args = { ISSUE: String(issue.number), BRANCH: branch };
  let passed = Boolean(existing);
  const resumeLocal = !existing && Boolean(localBranch);

  if (existing) {
    console.log(`Resume the open PR ${existing.url}.`);
    spawnSync("git", ["fetch", "origin", branch]);
    spawnSync("git", ["branch", "-f", branch, `origin/${branch}`]);
  } else {
    if (resumeLocal) {
      console.log(`Resume local branch ${branch} (no open PR yet). Skip the implementer.`);
      sh("git", ["checkout", "-f", "main"]);
      restoreHostFiles();
    } else {
      bootstrapIssueBranch(branch);
    }
    const sandbox = await sandcastle.createSandbox({ branch, sandbox: sandboxRuntime(), hooks });
    try {
      if (!resumeLocal) {
        const implement = await runImplementer(sandbox, {
          name: "implementer", maxIterations: 1,
          promptFile: "./.sandcastle/implement-prompt.md", promptArgs: args,
        });
        if (!implement.commits.length) { console.log(`No commits for #${issue.number}. Stopping.`); break; }
      }

      await runReviewerOrFixer(sandbox, {
        name: "reviewer", maxIterations: 1,
        promptFile: "./.sandcastle/review-prompt.md", promptArgs: args,
      });

      for (let attempt = 0; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
        const result = await runChecks(sandbox);
        if (result.ok) { passed = true; break; }
        console.log(`Checks failed for #${issue.number} (attempt ${attempt}).`);
        if (attempt === MAX_FIX_ATTEMPTS) break;
        await runReviewerOrFixer(sandbox, {
          name: `fixer-${attempt + 1}`, maxIterations: 1,
          promptFile: "./.sandcastle/fix-prompt.md",
          promptArgs: { ...args, CHECK_LOG: result.log.slice(-12000) },
        });
      }
    } finally {
      await sandbox.close();
    }
  }

  if (!passed) {
    console.log(`Issue #${issue.number} cannot pass the checks. Stopping the loop.`);
    sh("gh", ["issue", "comment", String(issue.number), "--body",
      `Sandcastle stopped. The checks failed after ${MAX_FIX_ATTEMPTS} fix attempts. Branch: \`${branch}\`. The loop did not merge.`]);
    sh("git", ["push", "-f", "origin", branch]);
    process.exitCode = 1;
    break;
  }

  if (!existing) sh("git", ["push", "-f", "origin", branch]);
  const url: string = existing ? existing.url : sh("gh", ["pr", "create", "--base", "main", "--head", branch,
    "--title", issue.title,
    "--body", `This PR implements #${issue.number}.\n\n${sh("git", ["log", "--reverse", "--format=%B", `main..${branch}`])}\n\nThe local checks pass.\n\nCloses #${issue.number}\n\nThe loop does not merge this PR.`]);
  console.log(`PR: ${url}`);
  console.log(`Do not merge. Do not set branch protection from this loop. Issue #${issue.number} stays open until a human merges.`);
  handled.add(issue.number);
}

console.log("\nAll done.");
