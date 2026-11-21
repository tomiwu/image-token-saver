#!/usr/bin/env node
/**
 * One-command eval runner: npm run eval
 * Requires subscription CLIs (claude, agent). Not wired to CI or precommit.
 *
 * EVALS_SUITE=methods runs the crop / diff / OCR / greyscale comparison.
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeReports } from "./lib/report.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function envDir() {
  return process.env.EVALS_IMAGE_DIR || "/workspace/image-tokens/evals";
}

function selectedSuite() {
  const fromArg = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  return process.env.EVALS_SUITE || fromArg || "scales";
}

function configPath(suite) {
  if (suite === "methods") {
    return join(ROOT, "evals/promptfooconfig-methods.yaml");
  }
  return join(ROOT, "evals/promptfooconfig.yaml");
}

function sh(command, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd || ROOT,
      env: { ...process.env, ...opts.env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const ok = code === 0 || (opts.allowCodes || []).includes(code);
      if (ok) resolvePromise(code);
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

const SCALE_FILES = [
  "buggy-01.png",
  "buggy-01-key.png",
  "scales/full.png",
  "scales/scale-0.75.png",
  "scales/scale-0.5.png",
  "scales/scale-0.34.png",
  "scales/scale-0.25.png",
  "scales/max-side-512.png",
];

const METHOD_FILES = [
  "buggy-01.png",
  "buggy-01-key.png",
  "scales/full.png",
  "scales/scale-0.25.png",
  "clean.png",
  "variants/crop-lessons.png",
  "variants/crop-dzis.png",
  "variants/crop-union.png",
  "variants/crop-payment.png",
  "variants/diff.png",
  "variants/greyscale.png",
  "variants/ocr.txt",
  "variants/manifest.json",
];

async function requiredFiles(dir, files) {
  for (const rel of files) {
    try {
      await access(join(dir, rel));
    } catch {
      throw new Error(
        `Missing ${join(dir, rel)}. Build the uncommitted eval images first (see evals/README.md).`,
      );
    }
  }
}

async function ensureMethodFiles(dir) {
  try {
    await requiredFiles(dir, METHOD_FILES);
  } catch {
    console.log(
      "evals: missing method images; running evals/prepare-variants.mjs",
    );
    await sh("node", ["evals/prepare-variants.mjs"], {
      env: { EVALS_IMAGE_DIR: dir },
    });
    await requiredFiles(dir, METHOD_FILES);
  }
}

function selectedProviders() {
  const raw = process.env.EVALS_PROVIDERS || "";
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function filterProviderSection(yaml, allow) {
  if (allow.length === 0) {
    return yaml;
  }
  const start = yaml.indexOf("\nproviders:\n");
  const end = yaml.indexOf("\ndefaultTest:");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Could not find providers section in the config");
  }
  const head = yaml.slice(0, start + "\nproviders:\n".length);
  const tail = yaml.slice(end);
  const body = yaml.slice(start + "\nproviders:\n".length, end);
  const blocks = body.trimEnd().split(/\n(?= {2}- id:)/);
  const kept = [];
  for (const block of blocks) {
    const label = /(?:^|\n)\s+label:\s*(.+)/.exec(block)?.[1]?.trim();
    const cfgId = /config:\s*\n[\s\S]*?\n\s+id:\s*(.+)/
      .exec(block)?.[1]
      ?.trim();
    if (allow.includes(label) || allow.includes(cfgId)) {
      kept.push(block.endsWith("\n") ? block : `${block}\n`);
    }
  }
  if (kept.length === 0) {
    throw new Error(`No providers matched EVALS_PROVIDERS=${allow.join(",")}`);
  }
  return `${head}${kept.join("")}${tail}`;
}

function commandLabel(suite, allow) {
  const parts = [];
  if (suite === "methods") {
    parts.push("EVALS_SUITE=methods");
  }
  if (allow.length) {
    parts.push(`EVALS_PROVIDERS=${allow.join(",")}`);
  }
  parts.push("npm run eval");
  return parts.join(" ");
}

async function main() {
  const suite = selectedSuite();
  const imageDir = envDir();
  process.env.EVALS_IMAGE_DIR = imageDir;
  process.env.EVALS_WORKSPACE =
    process.env.EVALS_WORKSPACE || "/tmp/its-eval-ws";
  await mkdir(process.env.EVALS_WORKSPACE, { recursive: true });
  await mkdir(join(imageDir, "raw"), { recursive: true });
  if (suite === "methods") {
    await ensureMethodFiles(imageDir);
  } else {
    await requiredFiles(imageDir, SCALE_FILES);
  }

  const src = await readFile(configPath(suite), "utf8");
  const allow = selectedProviders();
  const resolved = filterProviderSection(
    src.replaceAll("{{env.EVALS_IMAGE_DIR}}", imageDir),
    allow,
  );
  const resolvedPath = join(ROOT, "evals/promptfooconfig.resolved.yaml");
  await writeFile(resolvedPath, resolved);
  if (allow.length) {
    console.log(`evals: providers ${allow.join(", ")}`);
  }
  console.log(`evals: suite ${suite}`);

  const resultsJson = join(
    imageDir,
    suite === "methods" ? "results-methods.json" : "results.json",
  );
  const resultsHtml = join(imageDir, "results.html");
  const repeat = process.env.EVALS_REPEAT || "1";

  const args = [
    "--yes",
    "promptfoo@0.126.0",
    "eval",
    "-c",
    resolvedPath,
    "-j",
    "1",
    "--repeat",
    repeat,
    "--no-share",
    "-o",
    resultsJson,
    "-o",
    resultsHtml,
  ];
  console.log(`evals: EVALS_IMAGE_DIR=${imageDir}`);
  console.log(`evals: npx ${args.join(" ")}`);
  const code = await sh("npx", args, {
    env: { EVALS_IMAGE_DIR: imageDir },
    allowCodes: [100],
  });
  console.log(`evals: promptfoo exited ${code}`);

  const configured = [
    "claude-code",
    "grok-4.7-high",
    "gpt-5.2",
    "gemini-3.1-pro",
    "composer-2.5",
  ];
  const ran = allow.length ? allow : configured;
  const meta = {
    generatedAt: new Date().toISOString(),
    framework:
      "promptfoo 0.126.0 (JavaScript provider; exec: cannot return tokenUsage)",
    command: commandLabel(suite, allow),
    suite,
    issue:
      suite === "methods"
        ? "https://github.com/tomiwu/image-token-saver/issues/36"
        : undefined,
    ran,
    skipped: configured.filter((name) => !ran.includes(name)),
    notes: [
      "Measured Claude Code tokens are the whole request (text, image, and tool use), not the official image-only formula from this repo's CLI.",
      "Cursor CLI models are in the scale-sweep config but need `agent login` on the machine. This methods run uses Claude Code only.",
    ],
  };
  const written = await writeReports(resultsJson, imageDir, meta);
  console.log(`evals: wrote ${written.reportPath}`);
  console.log(`evals: wrote ${written.htmlPath}`);
  console.log(`evals: wrote ${written.pngPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
