/**
 * Build REPORT.md, results-table.html, and summary.png from promptfoo
 * results.json and/or the raw CLI records. Token counts are labelled
 * measured when the CLI reported usage, otherwise estimate (and only for
 * models that have an official formula in this repo's CLI).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { scoreOutput } from "./score.mjs";

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

export const SCALE_ORDER = [
  "full",
  "0.75",
  "0.5",
  "0.34",
  "0.25",
  "max-side-512",
];

export const ESTIMATE_BY_PROVIDER = {
  "claude-code": "estimate_claude",
  "gpt-5.2": "estimate_gpt52",
  "gemini-3.1-pro": "estimate_gemini",
};

function providerLabel(row) {
  return row.provider?.label || row.provider?.id || row.providerId || "unknown";
}

function resultRows(data) {
  if (Array.isArray(data?.results?.results)) {
    return data.results.results;
  }
  if (Array.isArray(data?.results)) {
    return data.results;
  }
  return [];
}

function estimateFor(provider, vars) {
  const key = ESTIMATE_BY_PROVIDER[provider];
  if (!key) {
    return undefined;
  }
  const value = vars?.[key];
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function tokenCell(measured, estimate) {
  if (typeof measured === "number") {
    return { text: `${measured} measured`, kind: "measured", value: measured };
  }
  if (typeof estimate === "number") {
    return { text: `${estimate} estimate`, kind: "estimate", value: estimate };
  }
  return {
    text: "no measured usage; no official formula in this CLI",
    kind: "none",
    value: undefined,
  };
}

export function tabulate(rows) {
  const cells = [];
  for (const row of rows) {
    const provider = providerLabel(row);
    const vars = row.vars || row.testCase?.vars || {};
    const scale = String(vars.scale ?? "");
    const output =
      row.response?.output || row.output || row.response?.text || "";
    const error = row.error || row.response?.error;
    const usage = row.response?.tokenUsage || row.tokenUsage;
    const measured = typeof usage?.total === "number" ? usage.total : undefined;
    const score = scoreOutput(output || "");
    cells.push({
      provider,
      scale,
      width: vars.width,
      height: vars.height,
      output,
      error,
      score,
      tokens: tokenCell(measured, estimateFor(provider, vars)),
      measuredPrompt: usage?.prompt,
      measuredCompletion: usage?.completion,
      reused: row.response?.metadata?.reused === true,
      model: row.response?.metadata?.model,
      sawImage: score.sawImage,
    });
  }
  return cells;
}

const SCALE_AREA = {
  full: 1872 * 1404,
  0.75: 1404 * 1053,
  0.5: 936 * 702,
  0.34: 636 * 477,
  "max-side-512": 512 * 384,
  0.25: 468 * 351,
};

function smallestFullDetect(cells, provider) {
  const hits = cells.filter(
    (c) => c.provider === provider && c.score.foundCount === 4 && c.sawImage,
  );
  if (hits.length === 0) {
    return "none";
  }
  hits.sort((a, b) => (SCALE_AREA[a.scale] || 0) - (SCALE_AREA[b.scale] || 0));
  return hits[0].scale;
}

function providersIn(cells) {
  return [...new Set(cells.map((c) => c.provider))];
}

function markdownTable(cells) {
  const providers = providersIn(cells);
  const lines = [];
  lines.push(
    "| Model | Scale | Size | Bugs found | A | B | C | D | FP | Tokens | Image received |",
  );
  lines.push(
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const provider of providers) {
    for (const scale of SCALE_ORDER) {
      const cell = cells.find(
        (c) => c.provider === provider && c.scale === scale,
      );
      if (!cell) continue;
      const size =
        cell.width && cell.height ? `${cell.width}×${cell.height}` : "?";
      const yn = (v) => (v ? "yes" : "no");
      const found =
        cell.sawImage || cell.score.foundCount
          ? `${cell.score.foundCount}/4`
          : "n/a";
      lines.push(
        `| ${provider} | ${scale} | ${size} | ${found} | ${yn(cell.score.found.a)} | ${yn(cell.score.found.b)} | ${yn(cell.score.found.c)} | ${yn(cell.score.found.d)} | ${cell.score.falsePositives} | ${cell.tokens.text} | ${yn(cell.sawImage)} |`,
      );
    }
  }
  return lines.join("\n");
}

function htmlTable(cells) {
  const providers = providersIn(cells);
  const rows = [];
  for (const provider of providers) {
    for (const scale of SCALE_ORDER) {
      const cell = cells.find(
        (c) => c.provider === provider && c.scale === scale,
      );
      if (!cell) continue;
      const yn = (v) => (v ? "yes" : "no");
      const size =
        cell.width && cell.height ? `${cell.width}×${cell.height}` : "?";
      rows.push(`<tr>
        <td>${provider}</td><td>${scale}</td><td>${size}</td>
        <td>${cell.score.foundCount}/4</td>
        <td>${yn(cell.score.found.a)}</td><td>${yn(cell.score.found.b)}</td>
        <td>${yn(cell.score.found.c)}</td><td>${yn(cell.score.found.d)}</td>
        <td>${cell.score.falsePositives}</td>
        <td>${cell.tokens.text}</td>
        <td>${yn(cell.sawImage)}</td>
      </tr>`);
    }
  }
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>buggy-01 eval</title>
<style>
  body { font-family: sans-serif; margin: 24px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #f4f4f4; }
</style></head><body>
<h1>buggy-01 eval</h1>
<table>
<thead><tr>
  <th>Model</th><th>Scale</th><th>Size</th><th>Bugs found</th>
  <th>A</th><th>B</th><th>C</th><th>D</th><th>FP</th><th>Tokens</th><th>Image received</th>
</tr></thead>
<tbody>
${rows.join("\n")}
</tbody></table>
</body></html>
`;
}

export function renderReport(cells, meta = {}) {
  const providers = providersIn(cells);
  const lines = [];
  lines.push("# buggy-01 eval report");
  lines.push("");
  lines.push(`Generated: ${warsawStamp(meta.generatedAt)}`);
  if (meta.framework) lines.push(`Framework: ${meta.framework}`);
  if (meta.command) lines.push(`Run command: \`${meta.command}\``);
  if (meta.headSha) lines.push(`Repo head: \`${meta.headSha}\``);
  lines.push("");
  lines.push(
    "Scores are deterministic (javascript/regex against the answer key). An optional llm-rubric grader exists in the config but is off by default and was not used for these numbers.",
  );
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push(markdownTable(cells));
  lines.push("");
  lines.push("## Smallest scale that still finds all 4 bugs");
  lines.push("");
  for (const provider of providers) {
    const smallest = smallestFullDetect(cells, provider);
    lines.push(`- ${provider}: ${smallest}`);
    const misses = cells.filter(
      (c) =>
        c.provider === provider &&
        c.sawImage &&
        c.score.foundCount < 4 &&
        (SCALE_AREA[c.scale] || 0) > (SCALE_AREA[smallest] || 0),
    );
    for (const miss of misses) {
      const missing = ["a", "b", "c", "d"].filter((k) => !miss.score.found[k]);
      lines.push(
        `  - ${miss.scale} is larger (${miss.width}×${miss.height}) but missed ${missing.map((k) => k.toUpperCase()).join(", ")}`,
      );
    }
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- `tokens_before` estimates come from `node src/cli.ts estimate` (official vendor formulas). They are labelled **estimate**.",
  );
  lines.push(
    "- When a subscription CLI returns usage in its JSON, that count is labelled **measured**.",
  );
  lines.push(
    "- Grok and Composer have no official formula in this CLI. If the CLI did not report usage, the token cell says so. No number is invented.",
  );
  lines.push(
    "- Gemini 3 formula tokens do not change with pixel size (media_resolution). GPT-4o tokens follow 512 px tiles, so some shrinks do not change the count.",
  );
  lines.push(
    "- Claude 0.75 (1404×1053) still estimates 1564: the official `resized_size()` path stays at the standard cap.",
  );
  lines.push("- Raw answers are under `$EVALS_IMAGE_DIR/raw/`.");
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

export async function writeSummaryPng(cells, outPath) {
  const payload = JSON.stringify(
    cells.map((c) => ({
      provider: c.provider,
      scale: c.scale,
      found: c.score.foundCount,
    })),
  );
  const code = `
import json, sys
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

cells = json.load(sys.stdin)
order = ["full", "0.75", "0.5", "0.34", "0.25", "max-side-512"]
providers = []
for c in cells:
    if c["provider"] not in providers:
        providers.append(c["provider"])
x = list(range(len(order)))
width = 0.15 if len(providers) else 0.2
fig, ax = plt.subplots(figsize=(11, 5))
for i, provider in enumerate(providers):
    ys = []
    for scale in order:
        hit = next((c for c in cells if c["provider"]==provider and c["scale"]==scale), None)
        ys.append(hit["found"] if hit else 0)
    offset = (i - (len(providers)-1)/2) * width
    ax.bar([xi+offset for xi in x], ys, width=width, label=provider)
ax.set_xticks(x)
ax.set_xticklabels(order)
ax.set_ylim(0, 4.2)
ax.set_ylabel("Bugs found (out of 4)")
ax.set_xlabel("Scale")
ax.set_title("buggy-01: bugs found by model and scale")
ax.legend(loc="upper right", fontsize=8)
ax.axhline(4, color="#888", linewidth=0.8, linestyle="--")
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
    child.stdout.on("data", (c) => {
      stdout += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.on("close", (status) => {
      if (status === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `python exit ${status}`));
    });
    child.stdin.end(payload);
  });
}

export async function writeReports(resultsPath, outDir, meta) {
  const data = JSON.parse(await readFile(resultsPath, "utf8"));
  const cells = tabulate(resultRows(data));
  const report = renderReport(cells, meta);
  const reportPath = join(outDir, "REPORT.md");
  const htmlPath = join(outDir, "results-table.html");
  const pngPath = join(outDir, "summary.png");
  await writeFile(reportPath, report);
  await writeFile(htmlPath, htmlTable(cells));
  await writeSummaryPng(cells, pngPath);
  return { reportPath, htmlPath, pngPath, cells };
}
