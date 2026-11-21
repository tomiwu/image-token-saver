/**
 * Report helpers for the crop / diff / OCR / greyscale method eval.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { VARIANT_NOTES, VARIANT_ORDER, bugsLabel } from "./variants.mjs";

function warsawStamp(iso) {
  const date = iso ? new Date(iso) : new Date();
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  return `${text} CET, Europe/Warsaw`;
}

function yn(value) {
  return value ? "yes" : "no";
}

function sizeOf(cell) {
  if (cell.width && cell.height) {
    return `${cell.width}×${cell.height}`;
  }
  return "n/a";
}

function foundFlags(cell) {
  const flags = cell.score.found;
  return ["A", "B", "C", "D"]
    .map((id) => (flags[id.toLowerCase()] ? id : "·"))
    .join(" ");
}

function num(value) {
  return typeof value === "number" ? String(value) : "n/a";
}

function cellsFor(cells, scale) {
  return cells
    .filter((cell) => cell.scale === scale)
    .sort((a, b) => String(a.run).localeCompare(String(b.run)));
}

function mean(values) {
  if (!values.length) {
    return undefined;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function usageFor(usageRows, scale, run) {
  const want = String(run || "1");
  const exact = usageRows.find(
    (row) => String(row.scale) === String(scale) && String(row.run) === want,
  );
  if (exact) {
    return exact;
  }
  return undefined;
}

function methodsTable(cells, usageRows) {
  const lines = [
    "| Variant | Run | Size | Bugs inside | Found | A B C D | FP | Formula (standard / raw) | Input | Cache create | Cache read | Output | Measured total | Image received |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const scale of VARIANT_ORDER) {
    for (const cell of cellsFor(cells, scale)) {
      const usage = usageFor(usageRows, scale, cell.run);
      const noImage = cell.inputKind === "ocr" || cell.inputKind === "none";
      const standard = cell.estimateClaude ?? usage?.officialStandard;
      const raw = cell.estimateClaudeRaw ?? usage?.officialRaw;
      const formula =
        noImage || (standard === undefined && raw === undefined)
          ? "n/a (no image)"
          : `${num(standard)} / ${num(raw)}`;
      lines.push(
        `| ${scale} | ${cell.run} | ${sizeOf(cell)} | ${bugsLabel(scale)} | ${cell.score.foundCount}/4 | ${foundFlags(cell)} | ${cell.score.falsePositives} | ${formula} | ${num(usage?.input)} | ${num(usage?.cacheCreate)} | ${num(usage?.cacheRead)} | ${num(usage?.output)} | ${num(usage?.total ?? cell.tokens.value)} | ${yn(cell.sawImage)} |`,
      );
    }
  }
  return lines.join("\n");
}

function methodsHtml(cells, usageRows) {
  const rows = [];
  for (const scale of VARIANT_ORDER) {
    for (const cell of cellsFor(cells, scale)) {
      const usage = usageFor(usageRows, scale, cell.run);
      rows.push(`<tr>
        <td>${scale}</td><td>${cell.run}</td><td>${sizeOf(cell)}</td>
        <td>${bugsLabel(scale)}</td><td>${cell.score.foundCount}/4</td>
        <td>${foundFlags(cell)}</td><td>${cell.score.falsePositives}</td>
        <td>${num(cell.estimateClaude)}</td><td>${num(cell.estimateClaudeRaw)}</td>
        <td>${num(usage?.input)}</td><td>${num(usage?.cacheCreate)}</td>
        <td>${num(usage?.cacheRead)}</td><td>${num(usage?.output)}</td>
        <td>${num(usage?.total ?? cell.tokens.value)}</td>
        <td>${yn(cell.sawImage)}</td>
      </tr>`);
    }
  }
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>buggy-01 method eval</title>
<style>
  body { font-family: sans-serif; margin: 24px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #f4f4f4; }
</style></head><body>
<h1>buggy-01 method eval</h1>
<table>
<thead><tr>
  <th>Variant</th><th>Run</th><th>Size</th><th>Bugs inside</th><th>Found</th>
  <th>A B C D</th><th>FP</th><th>Formula standard</th><th>Formula raw</th>
  <th>Input</th><th>Cache create</th><th>Cache read</th><th>Output</th>
  <th>Measured total</th><th>Image received</th>
</tr></thead>
<tbody>
${rows.join("\n")}
</tbody></table>
</body></html>
`;
}

function coverageSection() {
  const lines = [
    "## Bugs inside each variant",
    "",
    "Coordinates are in the original 1872×1404 pixel space. See `evals/variants.md`.",
    "",
  ];
  for (const scale of VARIANT_ORDER) {
    lines.push(
      `- **${scale}**: bugs inside: ${bugsLabel(scale)}. ${VARIANT_NOTES[scale]}`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function totals(cells, usageRows, scale) {
  const group = cellsFor(cells, scale);
  const found = group.map((cell) => cell.score.foundCount);
  const fps = group.map((cell) => cell.score.falsePositives);
  const measured = group
    .map(
      (cell) =>
        usageFor(usageRows, scale, cell.run)?.total ?? cell.tokens.value,
    )
    .filter((value) => typeof value === "number");
  return {
    group,
    found,
    fps,
    measured,
    foundMean: mean(found),
    fpMean: mean(fps),
    measuredMean: mean(measured),
  };
}

function fmtMean(value, digits = 0) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  if (digits === 0 && Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(digits);
}

function foundList(cell) {
  return ["a", "b", "c", "d"]
    .filter((id) => cell.score.found[id])
    .map((id) => id.toUpperCase());
}

function conclusionLines(cells, usageRows) {
  const lines = ["## Main conclusions", ""];
  const full = totals(cells, usageRows, "full");
  const scale25 = totals(cells, usageRows, "0.25");
  const noImage = totals(cells, usageRows, "no-image");
  const grey = totals(cells, usageRows, "greyscale");
  const ocr = totals(cells, usageRows, "ocr-text");
  const diff = totals(cells, usageRows, "diff");
  const union = totals(cells, usageRows, "crop-union");
  const lessons = totals(cells, usageRows, "crop-lessons");
  const dzis = totals(cells, usageRows, "crop-dzis");
  const payment = totals(cells, usageRows, "crop-payment");

  if (full.group.length) {
    lines.push(
      `- Full-size baseline: bugs found ${full.found.join(" and ")} out of 4. False positives ${full.fps.join(" and ")}. Measured total tokens ${full.measured.join(" and ")} (mean ${fmtMean(full.measuredMean, 0)}). Official formula 1564 standard / 3417 raw.`,
    );
  }
  if (scale25.group.length) {
    lines.push(
      `- Scale 0.25 baseline: bugs found ${scale25.found.join(" and ")} out of 4. False positives ${scale25.fps.join(" and ")}. Measured total tokens ${scale25.measured.join(" and ")}. Official formula 221 standard / 221 raw.`,
    );
  }
  if (noImage.group.length) {
    lines.push(
      `- No-image text-only baseline: measured total tokens ${noImage.measured.join(" and ")} (mean ${fmtMean(noImage.measuredMean, 0)}). This value is the fixed CLI and prompt cost with no image.`,
    );
  }
  if (lessons.group.length) {
    const found = lessons.group.map(
      (cell) => foundList(cell).join("") || "none",
    );
    lines.push(
      `- Crop of the lesson list (bugs inside B, C, D): found ${lessons.found.join(" and ")}/4 (${found.join("; ")}). False positives ${lessons.fps.join(" and ")}. Measured tokens ${lessons.measured.join(" and ")}. Official formula 820. Bug A is outside this crop.`,
    );
  }
  if (dzis.group.length) {
    const found = dzis.group.map((cell) => foundList(cell).join("") || "none");
    lines.push(
      `- Crop of the Dziś region (bug inside A): found ${dzis.found.join(" and ")}/4 (${found.join("; ")}). False positives ${dzis.fps.join(" and ")}. Measured tokens ${dzis.measured.join(" and ")}. Official formula 150. Bugs B, C, and D are outside this crop.`,
    );
  }
  if (union.group.length) {
    lines.push(
      `- Union crop of all bug areas (1808×1284): found ${union.found.join(" and ")}/4. False positives ${union.fps.join(" and ")}. Measured tokens ${union.measured.join(" and ")}. Official formula 1551 standard / 2990 raw. The official standard count is only 13 tokens below the full-size count of 1564, because the bugs sit far apart.`,
    );
  }
  if (payment.group.length) {
    lines.push(
      `- Payment-card crop (no seeded bug inside): found ${payment.found.join(" and ")}/4. False positives ${payment.fps.join(" and ")}. Measured tokens ${payment.measured.join(" and ")}. Official formula 600. A found count of 0 is the correct result for this crop.`,
    );
  }
  if (diff.group.length) {
    lines.push(
      `- Diff against the clean start-panel sample (1524×1258 changed region, all four bugs inside): found ${diff.found.join(" and ")}/4. False positives ${diff.fps.join(" and ")}. Measured tokens ${diff.measured.join(" and ")}. Official formula 1548 standard / 2475 raw. The official standard count is only 16 tokens below the full-size count of 1564, because the bounding box of the four bugs is still large.`,
    );
  }
  if (grey.group.length && full.group.length) {
    const greyRead = usageFor(usageRows, "greyscale", "2")?.cacheRead;
    const fullRead = usageFor(usageRows, "full", "2")?.cacheRead;
    const cacheNote =
      typeof greyRead === "number" && typeof fullRead === "number"
        ? ` Cache-read tokens on run 2 were ${greyRead} for greyscale and ${fullRead} for the colour full-size image.`
        : "";
    lines.push(
      `- Greyscale at the same size: official formula tokens stay 1564 standard / 3417 raw (the formula uses size, not colour). Measured totals ${grey.measured.join(" and ")} versus full-size ${full.measured.join(" and ")}.${cacheNote} Bugs found ${grey.found.join(" and ")}/4. False positives ${grey.fps.join(" and ")}.`,
    );
  }
  if (ocr.group.length) {
    const details = ocr.group.map((cell) => {
      const found = foundList(cell);
      return `run ${cell.run} found ${found.join(", ") || "none"} (${cell.score.foundCount}/4), FP ${cell.score.falsePositives}`;
    });
    lines.push(
      `- OCR text with no image: ${details.join("; ")}. The OCR text includes 25:00 and two Matematyka rows, so data bugs B and D can be detected. Layout bugs A and C need pixels. A single full-page Tesseract pass mixed the two columns and missed 25:00; the eval sent column OCR (left panel, lesson list, payment card).`,
    );
  }
  lines.push(
    "- There is no structured layout JSON or data JSON in the existing sample sources. Those sources are PNG files only. That variant was not run.",
  );
  lines.push(
    "- Measured Claude tokens include the prompt, the image (when present), tools, cache, and the completion. They are not the official image-only formula.",
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderMethodsReport(cells, meta = {}) {
  const lines = [];
  lines.push("# buggy-01 method eval report");
  lines.push("");
  lines.push(`Generated: ${warsawStamp(meta.generatedAt)}`);
  if (meta.framework) lines.push(`Framework: ${meta.framework}`);
  if (meta.command) lines.push(`Run command: \`${meta.command}\``);
  if (meta.headSha) lines.push(`Repo head: \`${meta.headSha}\``);
  if (meta.issue) lines.push(`Issue: ${meta.issue}`);
  lines.push("");
  lines.push(
    "This report compares token-saving methods on the same buggy calendar screenshot and the same improved prompt. The provider is Claude Code only (`claude -p`). Each variant ran twice. Token counts come from the CLI usage JSON when present. Formula image tokens come from this repository's official estimator. This report does not invent numbers.",
  );
  lines.push("");
  lines.push(
    "The clean reference for the diff method is a copy of the original start-panel sample. The buggy image was made from that sample by adding the four seeded bugs. This process is deterministic.",
  );
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push(methodsTable(cells, meta.usageRows || []));
  lines.push("");
  lines.push(coverageSection());
  lines.push(conclusionLines(cells, meta.usageRows || []));
  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- Crop rectangles use `image-token-saver reduce --method crop --rect x,y,w,h`.",
  );
  lines.push(
    "- The diff image uses `image-token-saver reduce --method diff --prev clean.png`.",
  );
  lines.push(
    "- The greyscale image uses the same sharp pipeline as `greyscaleMethod` in this repository. The CLI has no `--method greyscale` flag yet.",
  );
  lines.push(
    "- OCR uses Tesseract 5 with `pol+eng` language data, installed on the machine.",
  );
  lines.push(
    "- Raw answers are in `$EVALS_IMAGE_DIR/raw/`, with one file per variant and run.",
  );
  lines.push("- Sample-derived images are not in git.");
  lines.push("");
  if (meta.notes) {
    for (const note of meta.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }
  lines.push("## Models");
  lines.push("");
  if (meta.ran) lines.push(`Ran: ${meta.ran.join(", ")}`);
  if (meta.skipped) lines.push(`Did not run: ${meta.skipped.join(", ")}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function writeMethodsSummaryPng(cells, usageRows, outPath) {
  const payload = JSON.stringify({
    order: VARIANT_ORDER,
    current: cells.map((cell) => ({
      scale: cell.scale,
      run: cell.run,
      found: cell.score.foundCount,
      fp: cell.score.falsePositives,
      tokens:
        usageFor(usageRows, cell.scale, cell.run)?.total ?? cell.tokens.value,
    })),
  });
  const code = `
import json, sys
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

data = json.load(sys.stdin)
order = data["order"]
cells = data["current"]
x = np.arange(len(order))
fig, axes = plt.subplots(1, 2, figsize=(14, 5.2))

def series(run, key):
    out = []
    for scale in order:
        hit = next((c for c in cells if c["scale"]==scale and str(c["run"])==str(run)), None)
        out.append(hit[key] if hit and hit[key] is not None else 0)
    return out

axes[0].bar(x-0.2, series(1, "found"), width=0.4, label="run 1")
axes[0].bar(x+0.2, series(2, "found"), width=0.4, label="run 2")
axes[0].set_xticks(x)
axes[0].set_xticklabels(order, rotation=35, ha="right")
axes[0].set_ylim(0, 4.2)
axes[0].set_ylabel("Bugs found (out of 4)")
axes[0].set_title("Bugs found")
axes[0].axhline(4, color="#888", linewidth=0.8, linestyle="--")
axes[0].legend(fontsize=8)

axes[1].bar(x-0.2, series(1, "tokens"), width=0.4, label="run 1")
axes[1].bar(x+0.2, series(2, "tokens"), width=0.4, label="run 2")
axes[1].set_xticks(x)
axes[1].set_xticklabels(order, rotation=35, ha="right")
axes[1].set_ylabel("Measured total tokens")
axes[1].set_title("Measured Claude tokens")
axes[1].legend(fontsize=8)
fig.suptitle("buggy-01 method eval: bugs found and measured tokens")
fig.tight_layout()
fig.savefig(sys.argv[1], dpi=140)
print("wrote", sys.argv[1])
`;
  await new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", code, outPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      if (status === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `python exit ${status}`));
    });
    child.stdin.end(payload);
  });
}

export async function writeMethodReports(cells, outDir, meta = {}) {
  const usageRows = meta.usageRows || [];
  const report = renderMethodsReport(cells, { ...meta, usageRows });
  const reportPath = join(outDir, "REPORT.md");
  const htmlPath = join(outDir, "results-table.html");
  const pngPath = join(outDir, "summary.png");
  await writeFile(reportPath, report);
  await writeFile(htmlPath, methodsHtml(cells, usageRows));
  await writeMethodsSummaryPng(cells, usageRows, pngPath);
  return { reportPath, htmlPath, pngPath, cells };
}
