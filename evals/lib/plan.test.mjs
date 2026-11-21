import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTests, parseRuns } from "./plan.mjs";

test("runs default to 3 and stay within 3 to 5", () => {
  assert.equal(parseRuns(undefined), 3);
  assert.equal(parseRuns("5"), 5);
  assert.throws(() => parseRuns("2"), /3 to 5/);
  assert.throws(() => parseRuns("6"), /3 to 5/);
  assert.throws(() => parseRuns("x"), /3 to 5/);
});

test("each case repeats for every run", () => {
  const tests = buildTests("/img", 4);
  const full = tests.filter((t) => t.vars.scale === "full");
  assert.deepEqual(
    full.map((t) => t.vars.run),
    [1, 2, 3, 4],
  );
});

test("the plan has a no-tool baseline, a clean case and three layouts", () => {
  const tests = buildTests("/img", 3);
  const ids = new Set(tests.map((t) => t.vars.case_id));
  assert.deepEqual([...ids].sort(), [
    "buggy-01",
    "clean",
    "layout-chat",
    "layout-form",
    "layout-table",
  ]);
  const baseline = tests.filter((t) => t.vars.scale === "full-no-tool");
  assert.equal(baseline.length, 3);
  assert.equal(baseline[0].vars.delivery, "inline");
  assert.ok(tests.every((t) => t.vars.image.startsWith("/img/")));
});
