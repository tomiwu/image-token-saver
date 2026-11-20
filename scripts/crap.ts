import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  exitCodeFor,
  findViolations,
  formatTable,
  parseLcov,
  scoreFile,
  type CrapRow,
} from "./crap-core.ts";

const ROOT = resolve(import.meta.dirname, "..");
const LCOV = join(ROOT, "coverage", "lcov.info");
const SOURCE_DIRS = ["src", "scripts"];

function listSources(dir: string): string[] {
  const full = join(ROOT, dir);
  return readdirSync(full, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(full, name));
}

function runCoverage(): void {
  mkdirSync(join(ROOT, "coverage"), { recursive: true });
  execFileSync(
    process.execPath,
    [
      "--test",
      "--experimental-test-coverage",
      "--test-reporter=lcov",
      `--test-reporter-destination=${LCOV}`,
      "test/*.test.ts",
    ],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] },
  );
}

function collectRows(): CrapRow[] {
  const coverage = parseLcov(readFileSync(LCOV, "utf8"));
  return SOURCE_DIRS.flatMap(listSources).flatMap((path) =>
    scoreFile(
      relative(ROOT, path),
      readFileSync(path, "utf8"),
      coverage.get(relative(ROOT, path)),
    ),
  );
}

runCoverage();
const rows = collectRows();
const violations = findViolations(rows);
console.log(formatTable(rows));
for (const row of violations) {
  console.error(`CRAP ${row.crap.toFixed(2)}: ${row.file} ${row.name}`);
}
process.exitCode = exitCodeFor(violations);
