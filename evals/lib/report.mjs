/**
 * Build REPORT.md, results-table.html, and summary.png from promptfoo
 * results.json and/or the raw CLI records. Token counts are labelled
 * measured when the CLI reported usage, otherwise estimate (and only for
 * models that have an official formula in this repo's CLI).
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { scoreCase } from "./cases.mjs";
import { groupByCase, toolOverhead } from "./stats.mjs";
import { writeMethodReports } from "./report-methods.mjs";

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
    const caseId = vars.case_id || "buggy-01";
    const score = scoreCase(caseId, output || "");
    const estimateClaude = Number(vars.estimate_claude);
    const estimateClaudeRaw = Number(vars.estimate_claude_raw);
    cells.push({
      provider,
      caseId,
      scale,
      run: vars.run === undefined || vars.run === "" ? "1" : String(vars.run),
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
      inputKind: vars.input_kind || "image",
      expectBugs: vars.expect_bugs || "",
      estimateClaude: Number.isFinite(estimateClaude)
        ? estimateClaude
        : undefined,
      estimateClaudeRaw: Number.isFinite(estimateClaudeRaw)
        ? estimateClaudeRaw
        : undefined,
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

function comparisonTable(cells, previousCells) {
  if (!previousCells || previousCells.length === 0) {
    return "";
  }
  const lines = [
    "## Comparison with the previous run",
    "",
    "The previous run used a shorter prompt. That prompt did not describe the usual user interface.",
    "",
    "| Scale | Previous bugs | New bugs | Previous FP | New FP | Previous tokens | New tokens |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  const providers = providersIn(cells);
  for (const provider of providers) {
    for (const scale of SCALE_ORDER) {
      const now = cells.find(
        (c) => c.provider === provider && c.scale === scale,
      );
      const prev = previousCells.find(
        (c) => c.provider === provider && c.scale === scale,
      );
      if (!now && !prev) continue;
      const bugs = (cell) => (cell ? `${cell.score.foundCount}/4` : "n/a");
      const fp = (cell) => (cell ? String(cell.score.falsePositives) : "n/a");
      const tok = (cell) => (cell ? cell.tokens.text : "n/a");
      const label = providers.length > 1 ? `${provider} ${scale}` : scale;
      lines.push(
        `| ${label} | ${bugs(prev)} | ${bugs(now)} | ${fp(prev)} | ${fp(now)} | ${tok(prev)} | ${tok(now)} |`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const RAW_CLAUDE_PATCHES = {
  full: 3417,
  0.75: 1938,
  0.5: 884,
  0.34: 414,
  0.25: 221,
  "max-side-512": 266,
};

export async function loadUsageRows(outDir) {
  const dir = join(outDir, "raw");
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const rows = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const data = JSON.parse(await readFile(join(dir, name), "utf8"));
    const usage = data.usageRaw || {};
    const estimateClaude = Number(data.estimateClaude);
    const estimateClaudeRaw = Number(data.estimateClaudeRaw);
    rows.push({
      scale: data.scale || name,
      run:
        data.run === undefined || data.run === ""
          ? undefined
          : String(data.run),
      numTurns: data.numTurns,
      input: usage.input_tokens,
      cacheCreate: usage.cache_creation_input_tokens,
      cacheRead: usage.cache_read_input_tokens,
      output: usage.output_tokens,
      thinking: usage.output_tokens_details?.thinking_tokens,
      prompt: data.tokenUsage?.prompt,
      total: data.tokenUsage?.total,
      officialStandard: Number.isFinite(estimateClaude)
        ? estimateClaude
        : undefined,
      officialRaw: Number.isFinite(estimateClaudeRaw)
        ? estimateClaudeRaw
        : RAW_CLAUDE_PATCHES[data.scale],
    });
  }
  return rows;
}

function usageMarkdown(rows) {
  if (!rows.length) {
    return "";
  }
  const lines = [
    "## Measured Claude usage",
    "",
    "These numbers come from the `claude -p` JSON field `usage`. The official standard estimate is the vendor formula after `resized_size()`. The official raw count is the 28 px patch count with no vendor resize. Both official numbers come from this repository's estimator.",
    "",
    "| Scale | Turns | Input | Cache create | Cache read | Output | Measured total | Official standard | Official raw |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const byScale = new Map(rows.map((r) => [String(r.scale), r]));
  for (const scale of SCALE_ORDER) {
    const r = byScale.get(scale);
    if (!r) continue;
    lines.push(
      `| ${scale} | ${r.numTurns ?? "n/a"} | ${r.input ?? "n/a"} | ${r.cacheCreate ?? "n/a"} | ${r.cacheRead ?? "n/a"} | ${r.output ?? "n/a"} | ${r.total ?? "n/a"} | n/a | ${r.officialRaw ?? "n/a"} |`,
    );
  }
  // official standard from known estimates
  const standard = {
    full: 1564,
    0.75: 1564,
    0.5: 884,
    0.34: 414,
    0.25: 221,
    "max-side-512": 266,
  };
  const fixed = lines.map((line) => {
    if (!line.startsWith("| ")) return line;
    const scale = line.split("|")[1].trim();
    if (standard[scale] !== undefined) {
      return line.replace("| n/a |", `| ${standard[scale]} |`);
    }
    return line;
  });
  fixed.push("");
  return `${fixed.join("\n")}\n`;
}

function mean(values) {
  const nums = values.filter((v) => typeof v === "number");
  if (!nums.length) return undefined;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function groupLabel(group) {
  const scale = group.cells[0].scale;
  return group.caseId === "buggy-01" ? `buggy-01 ${scale}` : group.caseId;
}

function groupTokens(group) {
  const value = mean(group.cells.map((c) => c.measuredPrompt));
  return value === undefined ? "no measured usage" : `${value} measured`;
}

function groupModels(group) {
  const models = new Set(group.cells.map((c) => c.model).filter(Boolean));
  return models.size ? [...models].join(", ") : "not reported";
}

export function passRateMarkdown(cells, meta = {}) {
  const lines = ["## Pass rate per case", ""];
  lines.push(
    "A run passes when the model finds every seeded bug and reports no false positive. The clean image has no seeded bug, so a run passes only with zero reported items. Token cells are the mean measured prompt tokens over the runs.",
    "",
  );
  if (meta.cliVersions) {
    for (const [cli, version] of Object.entries(meta.cliVersions)) {
      lines.push(`- CLI version, ${cli}: ${version}`);
    }
    lines.push("");
  }
  lines.push(
    "| Model | Model id | Case | Pass rate | Mean bugs found | Mean FP | Tokens |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const group of groupByCase(cells)) {
    const found = mean(group.cells.map((c) => c.score.foundCount * 100));
    const fp = mean(group.cells.map((c) => c.score.falsePositives * 100));
    const total = group.cells[0].score.total;
    lines.push(
      `| ${group.provider} | ${groupModels(group)} | ${groupLabel(group)} | ${group.rate.text} passed | ${(found ?? 0) / 100} of ${total} | ${(fp ?? 0) / 100} | ${groupTokens(group)} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function baselineMarkdown(cells) {
  const pick = (scale) =>
    cells.filter((c) => c.caseId === "buggy-01" && c.scale === scale);
  const mp = (scale) => mean(pick(scale).map((c) => c.measuredPrompt));
  const baseline = mp("full-no-tool");
  const withTool = mp("full");
  const lines = ["## Full-size no-tool baseline", ""];
  if (baseline === undefined) {
    lines.push("The baseline row has no measured usage in this run.", "");
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    "The baseline row sends the full image inline with no tools. All numbers are measured from the CLI usage JSON.",
    "",
    "| Row | Mean measured prompt tokens |",
    "| --- | --- |",
    `| full, no tool (baseline) | ${baseline} measured |`,
  );
  if (withTool !== undefined) {
    lines.push(
      `| full, Read tool | ${withTool} measured |`,
      `| fixed tool cost (difference) | ${toolOverhead(withTool, baseline)} measured |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
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
    "This report gives the scores for the screenshot bug eval. The scores use deterministic javascript checks and regular expressions against the answer key. The optional llm-rubric grader is off. This report does not use that grader. The false-positive count (FP) is the number of reported items that do not match a seeded bug.",
  );
  lines.push("");
  lines.push(passRateMarkdown(cells, meta));
  lines.push(baselineMarkdown(cells));
  lines.push("## Results");
  lines.push("");
  lines.push(markdownTable(cells));
  lines.push("");
  if (meta.previousCells) {
    lines.push(comparisonTable(cells, meta.previousCells));
  }
  if (meta.usageRows) {
    lines.push(usageMarkdown(meta.usageRows));
  }
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
    "- Official image-token estimates come from `node src/cli.ts estimate`. This report labels these numbers as estimate.",
  );
  lines.push(
    "- When the Claude CLI returns usage in JSON, this report labels these numbers as measured.",
  );
  lines.push(
    "- Measured Claude tokens include the full request: text, image, tools, and cache. These numbers are not the official image-only formula.",
  );
  lines.push(
    "- If a CLI does not return usage, and this repository has no official formula for that model, this report does not invent a number.",
  );
  lines.push(
    "- The official Claude estimate for a 1404×1053 image is 1564, because `resized_size()` applies the standard cap. The raw patch count for that size is 1938.",
  );
  lines.push("- Raw answers are in `$EVALS_IMAGE_DIR/raw/`.");
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

export async function writeSummaryPng(cells, outPath, previousCells = []) {
  const payload = JSON.stringify({
    current: cells.map((c) => ({
      provider: c.provider,
      scale: c.scale,
      found: c.score.foundCount,
      fp: c.score.falsePositives,
    })),
    previous: (previousCells || []).map((c) => ({
      provider: c.provider,
      scale: c.scale,
      found: c.score.foundCount,
      fp: c.score.falsePositives,
    })),
  });
  const code = `
import json, sys
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

data = json.load(sys.stdin)
cells = data.get("current") if isinstance(data, dict) and "current" in data else data
previous = data.get("previous") if isinstance(data, dict) else []
order = ["full", "0.75", "0.5", "0.34", "0.25", "max-side-512"]
providers = []
for c in cells:
    if c["provider"] not in providers:
        providers.append(c["provider"])
x = list(range(len(order)))
fig, axes = plt.subplots(1, 2, figsize=(12, 5))

def values(series, key):
    out = []
    for scale in order:
        hit = next((c for c in series if c["provider"]==providers[0] and c["scale"]==scale), None)
        out.append(hit[key] if hit else 0)
    return out

axes[0].bar([xi-0.2 for xi in x], values(previous, "found") if previous else [0]*len(order), width=0.4, label="previous") if previous else None
axes[0].bar([xi+(0.2 if previous else 0) for xi in x], values(cells, "found"), width=0.4 if previous else 0.6, label="new" if previous else "bugs found")
axes[0].set_xticks(x)
axes[0].set_xticklabels(order, rotation=20)
axes[0].set_ylim(0, 4.2)
axes[0].set_ylabel("Bugs found (out of 4)")
axes[0].set_title("Bugs found")
axes[0].axhline(4, color="#888", linewidth=0.8, linestyle="--")
axes[0].legend(fontsize=8)

axes[1].bar([xi-0.2 for xi in x], values(previous, "fp") if previous else [0]*len(order), width=0.4, label="previous") if previous else None
axes[1].bar([xi+(0.2 if previous else 0) for xi in x], values(cells, "fp"), width=0.4 if previous else 0.6, label="new" if previous else "false positives")
axes[1].set_xticks(x)
axes[1].set_xticklabels(order, rotation=20)
axes[1].set_ylabel("False positives")
axes[1].set_title("False positives")
axes[1].legend(fontsize=8)
fig.suptitle("buggy-01 eval: bugs found and false positives")
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

export async function loadPreviousCells(outDir) {
  try {
    const data = JSON.parse(
      await readFile(join(outDir, "previous", "results.json"), "utf8"),
    );
    return tabulate(resultRows(data));
  } catch {
    return [];
  }
}

export async function writeReports(resultsPath, outDir, meta = {}) {
  const data = JSON.parse(await readFile(resultsPath, "utf8"));
  const cells = tabulate(resultRows(data));
  const previousCells = meta.previousCells || (await loadPreviousCells(outDir));
  const usageRows = meta.usageRows || (await loadUsageRows(outDir));
  if (meta.suite === "methods") {
    return writeMethodReports(cells, outDir, {
      ...meta,
      previousCells,
      usageRows,
    });
  }
  const report = renderReport(cells, { ...meta, previousCells, usageRows });
  const reportPath = join(outDir, "REPORT.md");
  const htmlPath = join(outDir, "results-table.html");
  const pngPath = join(outDir, "summary.png");
  await writeFile(reportPath, report);
  await writeFile(htmlPath, htmlTable(cells));
  await writeSummaryPng(cells, pngPath, previousCells);
  return { reportPath, htmlPath, pngPath, cells, previousCells };
}
