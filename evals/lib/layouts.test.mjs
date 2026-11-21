import assert from "node:assert/strict";
import { test } from "node:test";
import { LAYOUTS } from "./layouts.mjs";

test("each layout is deterministic SVG that holds its seeded text", () => {
  const seeds = { form: "Svae", table: "2026-13-45", chat: "27:15" };
  for (const [name, render] of Object.entries(LAYOUTS)) {
    assert.equal(render(), render());
    assert.ok(render().startsWith("<svg"));
    assert.ok(render().includes(seeds[name]));
  }
});

test("the table repeats INV-1003", () => {
  const count = LAYOUTS.table().split("INV-1003").length - 1;
  assert.equal(count, 2);
});
