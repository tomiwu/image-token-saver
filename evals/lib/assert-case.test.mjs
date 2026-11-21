import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCase } from "./assert-case.mjs";

test("the clean image passes both metrics on NONE", () => {
  assert.equal(assertCase("NONE", "clean", "case-bugs").pass, true);
  assert.equal(assertCase("NONE", "clean", "case-fp").pass, true);
});

test("the clean image fails the false-positive metric on a listed item", () => {
  assert.equal(
    assertCase("1. A button is cut off.", "clean", "case-fp").pass,
    false,
  );
});

test("a layout scores partial found as a fraction", () => {
  const result = assertCase(
    "1. The button says Svae.",
    "layout-form",
    "case-bugs",
  );
  assert.equal(result.pass, false);
  assert.ok(Math.abs(result.score - 1 / 3) < 1e-9);
});
