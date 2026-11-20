import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("package.json pins the stack versions", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    engines?: { node?: string };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  assert.equal(pkg.engines?.node, "24.22.3");
  assert.equal(
    pkg.devDependencies?.["@typescript/native"],
    "npm:typescript@7.0.2",
  );
  assert.equal(pkg.dependencies?.["@modelcontextprotocol/sdk"], "1.32.2");
  assert.equal(pkg.dependencies?.sharp, "0.35.5");
  assert.equal(pkg.devDependencies?.prettier, "3.10.1");
  assert.equal(pkg.devDependencies?.eslint, "10.15.0");
});
