/**
 * Build uncommitted method-eval images under EVALS_IMAGE_DIR.
 * Uses the MVP CLI for crop and diff. Uses sharp for greyscale
 * in the same way as greyscaleMethod in src/methods/colour-depth.ts.
 * Uses tesseract for OCR. Does not write into git.
 */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { accessSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { CROP_RECTS, rectString } from "./lib/variants.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function envDir() {
  return process.env.EVALS_IMAGE_DIR || "/workspace/image-tokens/evals";
}

function samplePath() {
  return (
    process.env.EVALS_SAMPLE ||
    "/workspace/image-tokens/samples/00-start-panel.png"
  );
}

function sh(command, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd || ROOT,
      env: process.env,
      stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (opts.capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr, code });
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} exited ${code}${stderr ? `\n${stderr}` : ""}`,
        ),
      );
    });
  });
}

function mustExist(path, label) {
  try {
    accessSync(path);
  } catch {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

async function cliJson(args) {
  const ran = await sh("node", ["src/cli.ts", ...args, "--json"], {
    capture: true,
  });
  const text = ran.stdout.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`CLI produced no JSON for ${args.join(" ")}: ${text}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

async function estimateClaude(imagePath) {
  const body = await cliJson(["estimate", imagePath, "--model", "claude"]);
  return {
    tokensAfter: body.tokens_after ?? body.tokensAfter,
    tokensBefore: body.tokens_before ?? body.tokensBefore,
    width: body.width,
    height: body.height,
    raw: body,
  };
}

async function imageSize(imagePath) {
  const info = await sharp(imagePath).metadata();
  return { width: info.width, height: info.height };
}

async function rawPatchCount(width, height) {
  const ran = await sh(
    "node",
    [
      "--experimental-strip-types",
      "-e",
      `import { unreducedTokens } from ${JSON.stringify(`${ROOT}/src/resize.ts`)};
       import { estimateTokens } from ${JSON.stringify(`${ROOT}/src/estimators.ts`)};
       const raw = unreducedTokens(${width}, ${height}, "claude-standard");
       const standard = estimateTokens(${width}, ${height}, "claude-standard");
       process.stdout.write(JSON.stringify({ raw, standard }));`,
    ],
    { capture: true },
  );
  return JSON.parse(ran.stdout.trim());
}

async function reduceCrop(input, outPath, rect) {
  return cliJson([
    "reduce",
    input,
    "--model",
    "claude",
    "--method",
    "crop",
    "--rect",
    rectString(rect),
    "--out",
    outPath,
  ]);
}

async function reduceDiff(input, prev, outPath) {
  return cliJson([
    "reduce",
    input,
    "--model",
    "claude",
    "--method",
    "diff",
    "--prev",
    prev,
    "--out",
    outPath,
  ]);
}

async function writeGreyscale(input, outPath) {
  await sharp(input)
    .greyscale()
    .toColourspace("b-w")
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

function tess(args) {
  return sh("tesseract", args, { capture: true });
}

async function ocrPart(imagePath, psm) {
  const ran = await tess([
    imagePath,
    "stdout",
    "-l",
    "pol+eng",
    "--psm",
    String(psm),
  ]);
  return ran.stdout.trim();
}

async function writePartCrop(input, outPath, box) {
  await sharp(input)
    .extract({
      left: box.x,
      top: box.y,
      width: box.w,
      height: box.h,
    })
    .png()
    .toFile(outPath);
}

async function buildOcr(input, variantsDir) {
  const leftPath = join(variantsDir, "ocr-left.png");
  const lessonsPath = join(variantsDir, "ocr-lessons.png");
  const paymentPath = join(variantsDir, "ocr-payment.png");
  await writePartCrop(input, leftPath, { x: 0, y: 0, w: 700, h: 1404 });
  await writePartCrop(input, lessonsPath, CROP_RECTS["crop-lessons"]);
  await writePartCrop(input, paymentPath, CROP_RECTS["crop-payment"]);
  const left = await ocrPart(leftPath, 6);
  const lessons = await ocrPart(lessonsPath, 4);
  const payment = await ocrPart(paymentPath, 6);
  const fullPage = await ocrPart(input, 4);
  const combined = [
    "Left calendar panel:",
    left,
    "",
    "Lesson list:",
    lessons,
    "",
    "Payment card:",
    payment,
    "",
  ].join("\n");
  const outPath = join(variantsDir, "ocr.txt");
  await writeFile(outPath, `${combined}\n`);
  const fullPath = join(variantsDir, "ocr-fullpage.txt");
  await writeFile(fullPath, `${fullPage}\n`);
  return { outPath, fullPath, combined, fullPage };
}

async function describeImage(path) {
  const size = await imageSize(path);
  const estimate = await estimateClaude(path);
  const patches = await rawPatchCount(size.width, size.height);
  return {
    path,
    width: size.width,
    height: size.height,
    estimate_claude: patches.standard,
    estimate_claude_raw: patches.raw,
    cli_tokens_after: estimate.tokensAfter,
  };
}

async function main() {
  const imageDir = envDir();
  const input = join(imageDir, "buggy-01.png");
  const sample = samplePath();
  mustExist(input, "buggy image");
  mustExist(sample, "clean start-panel sample");
  const variantsDir = join(imageDir, "variants");
  await mkdir(variantsDir, { recursive: true });
  const cleanPath = join(imageDir, "clean.png");
  await copyFile(sample, cleanPath);

  const crops = {};
  for (const [name, rect] of Object.entries(CROP_RECTS)) {
    const outPath = join(variantsDir, `${name}.png`);
    const report = await reduceCrop(input, outPath, rect);
    crops[name] = {
      rect: rectString(rect),
      report,
      ...(await describeImage(outPath)),
    };
  }

  const diffPath = join(variantsDir, "diff.png");
  const diffReport = await reduceDiff(input, cleanPath, diffPath);
  const greyPath = join(variantsDir, "greyscale.png");
  await writeGreyscale(input, greyPath);
  const ocr = await buildOcr(input, variantsDir);

  const fullPath = join(imageDir, "scales/full.png");
  const scale25 = join(imageDir, "scales/scale-0.25.png");
  const manifest = {
    generatedFrom: {
      buggy: input,
      cleanSample: sample,
      note: "The clean reference is a copy of the original start-panel sample. The buggy image was made from that sample by adding the four seeded bugs. This is deterministic. No pixel was invented.",
    },
    clean: await describeImage(cleanPath),
    full: await describeImage(fullPath),
    0.25: await describeImage(scale25),
    crops,
    diff: { report: diffReport, ...(await describeImage(diffPath)) },
    greyscale: await describeImage(greyPath),
    ocr: {
      path: ocr.outPath,
      method:
        "Column OCR with tesseract pol+eng. Left panel psm 6, lesson list psm 4, payment card psm 6. A single full-page psm 4 pass mixed the columns and missed 25:00, so the eval sends the column text.",
      characterCount: ocr.combined.length,
      fullPagePath: ocr.fullPath,
      fullPageCharacterCount: ocr.fullPage.length,
    },
    structuredSource:
      "No layout JSON or data JSON is available in the existing sample sources. Those sources are PNG files only. This variant was not run.",
  };
  const manifestPath = join(variantsDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${manifestPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
