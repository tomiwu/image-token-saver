import assert from "node:assert/strict";
import { test } from "node:test";
import { baselineMarkdown, passRateMarkdown, tabulate } from "./report.mjs";

function row(caseId, scale, run, output, prompt) {
  return {
    provider: { label: "claude-code" },
    vars: { case_id: caseId, scale, run },
    response: {
      output,
      tokenUsage: prompt ? { prompt, total: prompt + 10 } : undefined,
      metadata: { model: "model-x" },
    },
  };
}

test("the pass-rate table reports passed runs, model id and CLI version", () => {
  const cells = tabulate([
    row("clean", "clean", 1, "NONE"),
    row("clean", "clean", 2, "1. A button is cut off."),
    row("clean", "clean", 3, "NONE"),
  ]);
  const text = passRateMarkdown(cells, { cliVersions: { claude: "9.9.9" } });
  assert.match(text, /2 of 3 runs passed/);
  assert.match(text, /model-x/);
  assert.match(text, /CLI version, claude: 9\.9\.9/);
});

test("the baseline section labels measured usage and the tool cost", () => {
  const cells = tabulate([
    row("buggy-01", "full", 1, "NONE", 3000),
    row("buggy-01", "full-no-tool", 1, "NONE", 2400),
  ]);
  const text = baselineMarkdown(cells);
  assert.match(text, /2400 measured/);
  assert.match(text, /fixed tool cost \(difference\) \| 600 measured/);
});

test("the baseline section does not invent a number without usage", () => {
  const cells = tabulate([row("buggy-01", "full-no-tool", 1, "NONE")]);
  assert.match(baselineMarkdown(cells), /no measured usage/);
});
