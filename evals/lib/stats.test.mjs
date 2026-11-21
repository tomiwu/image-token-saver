import assert from "node:assert/strict";
import { test } from "node:test";
import { groupByCase, passRate, runPassed, toolOverhead } from "./stats.mjs";

const pass = {
  error: undefined,
  output: "x",
  score: { foundCount: 2, total: 2, falsePositives: 0 },
};
const missed = {
  ...pass,
  score: { foundCount: 1, total: 2, falsePositives: 0 },
};
const noisy = {
  ...pass,
  score: { foundCount: 2, total: 2, falsePositives: 1 },
};
const failed = { ...pass, error: "timeout" };

test("a run passes only with every bug found and no false positive", () => {
  assert.equal(runPassed(pass), true);
  assert.equal(runPassed(missed), false);
  assert.equal(runPassed(noisy), false);
  assert.equal(runPassed(failed), false);
});

test("a clean image run passes with zero found and zero false positives", () => {
  const clean = {
    output: "NONE",
    score: { foundCount: 0, total: 0, falsePositives: 0 },
  };
  assert.equal(runPassed(clean), true);
});

test("pass rate counts passed runs on a small fixed table", () => {
  const rate = passRate([pass, missed, pass, noisy, pass]);
  assert.equal(rate.passed, 3);
  assert.equal(rate.total, 5);
  assert.equal(rate.text, "3 of 5 runs");
});

test("pass rate of no runs is 0 of 0", () => {
  assert.equal(passRate([]).text, "0 of 0 runs");
});

test("groups cells by provider and case", () => {
  const cells = [
    { provider: "p", caseId: "a", ...pass },
    { provider: "p", caseId: "a", ...missed },
    { provider: "p", caseId: "b", ...pass },
  ];
  const groups = groupByCase(cells);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].caseId, "a");
  assert.equal(groups[0].rate.text, "1 of 2 runs");
});

test("tool overhead is the measured difference, or undefined", () => {
  assert.equal(toolOverhead(3000, 2400), 600);
  assert.equal(toolOverhead(undefined, 2400), undefined);
  assert.equal(toolOverhead(3000, undefined), undefined);
});
