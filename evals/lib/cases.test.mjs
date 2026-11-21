import assert from "node:assert/strict";
import { test } from "node:test";
import { CASES, caseTotal, scoreCase } from "./cases.mjs";

test("a NONE answer on the clean image scores zero found and zero false positives", () => {
  const result = scoreCase("clean", "NONE");
  assert.equal(result.foundCount, 0);
  assert.equal(result.total, 0);
  assert.equal(result.falsePositives, 0);
});

test("any listed item on the clean image is a false positive", () => {
  const result = scoreCase(
    "clean",
    "1. The Dziś button is cut off at the bottom.\n2. The time is 25:00.",
  );
  assert.equal(result.foundCount, 0);
  assert.equal(result.falsePositives, 2);
});

test("buggy-01 keeps the four-bug scorer", () => {
  const result = scoreCase("buggy-01", "1. The first lesson starts at 25:00.");
  assert.equal(result.found.d, true);
  assert.equal(result.total, 4);
});

test("each new layout scores its seeded bugs", () => {
  const form = scoreCase(
    "layout-form",
    "1. The Email label overlaps its input box.\n2. The button says Svae.\n3. The label Receive product updates is cut off at the card edge.",
  );
  assert.equal(form.foundCount, 3);
  assert.equal(form.falsePositives, 0);
  const table = scoreCase(
    "layout-table",
    "1. INV-1003 is duplicated.\n2. The date 2026-13-45 is invalid.\n3. The Total column is cut off at the right edge.",
  );
  assert.equal(table.foundCount, 3);
  const chat = scoreCase(
    "layout-chat",
    "1. A message time is 27:15.\n2. A message bubble runs off the right edge.\n3. Two avatars overlap.",
  );
  assert.equal(chat.foundCount, 3);
});

test("an unrelated item on a layout is a false positive", () => {
  const result = scoreCase("layout-form", "1. The page title is too small.");
  assert.equal(result.foundCount, 0);
  assert.equal(result.falsePositives, 1);
});

test("every case has an answer key size", () => {
  for (const id of Object.keys(CASES)) {
    assert.equal(typeof caseTotal(id), "number");
  }
  assert.equal(caseTotal("clean"), 0);
});

test("an unknown case throws", () => {
  assert.throws(() => scoreCase("nope", "x"), /Unknown case/);
});
