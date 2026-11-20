import { test } from "node:test";
import assert from "node:assert/strict";
import { PROJECT_NAME } from "../src/index.ts";

test("test runner works", () => {
  assert.equal(PROJECT_NAME, "image-token-saver");
});
