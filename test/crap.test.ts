import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CRAP_THRESHOLD,
  analyzeSource,
  crapScore,
  exitCodeFor,
  findViolations,
  formatTable,
  parseLcov,
  scoreFile,
} from "../scripts/crap-core.ts";

test("crapScore: untested complexity 1 gives 2", () => {
  assert.equal(crapScore(1, 0), 2);
});

test("crapScore: full coverage gives the complexity", () => {
  assert.equal(crapScore(10, 1), 10);
});

test("crapScore: complexity 5 with half coverage", () => {
  assert.equal(crapScore(5, 0.5), 25 * 0.125 + 5);
});

test("the threshold is 6", () => {
  assert.equal(CRAP_THRESHOLD, 6);
});

test("findViolations: a score equal to the threshold fails", () => {
  const rows = [
    { file: "a.ts", name: "ok", complexity: 1, coverage: 1, crap: 5.99 },
    { file: "a.ts", name: "bad", complexity: 2, coverage: 0, crap: 6 },
  ];
  assert.deepEqual(
    findViolations(rows).map((row) => row.name),
    ["bad"],
  );
});

test("exitCodeFor: 1 with violations, 0 without", () => {
  assert.equal(exitCodeFor([]), 0);
  assert.equal(
    exitCodeFor([
      { file: "a.ts", name: "f", complexity: 9, coverage: 0, crap: 90 },
    ]),
    1,
  );
});

const COMPLEX = `
export function tangled(a: number, b: number): number {
  let total = 0;
  if (a > 0 && b > 0) {
    for (let i = 0; i < a; i++) {
      total += i % 2 === 0 ? i : b || 1;
    }
  } else if (a < 0) {
    total = b ?? 0;
  }
  switch (a) {
    case 1:
      total++;
      break;
    case 2:
      total--;
      break;
    default:
      break;
  }
  return total;
}
export const simple = (x: number) => x + 1;
class Box {
  get value(): number {
    return 1;
  }
  run(items: number[]): number {
    return items.map((item) => (item > 1 ? item : 0)).length;
  }
}
`;

test("analyzeSource: counts cyclomatic complexity", () => {
  const found = analyzeSource("x.ts", COMPLEX);
  const byName = new Map(found.map((fn) => [fn.name, fn]));
  assert.equal(byName.get("tangled")?.complexity, 10);
  assert.equal(byName.get("simple")?.complexity, 1);
  assert.equal(byName.get("Box.value")?.complexity, 1);
  assert.equal(byName.get("Box.run")?.complexity, 1);
  assert.equal(byName.get("<anonymous>@29")?.complexity, 2);
});

test("parseLcov: reads executable lines for each file", () => {
  const lcov = "SF:/p/a.ts\nDA:1,3\nDA:2,0\nend_of_record\n";
  const map = parseLcov(lcov);
  assert.deepEqual(
    [...(map.get("/p/a.ts") ?? new Map())],
    [
      [1, 3],
      [2, 0],
    ],
  );
});

test("scoreFile: a complex untested function fails the gate", () => {
  const rows = scoreFile("x.ts", COMPLEX, new Map());
  const bad = findViolations(rows);
  assert.ok(bad.some((row) => row.name === "tangled"));
  assert.equal(exitCodeFor(bad), 1);
});

test("scoreFile: full coverage lowers the score", () => {
  const lines = new Map<number, number>();
  for (let line = 1; line <= 30; line++) lines.set(line, 1);
  const rows = scoreFile("x.ts", COMPLEX, lines);
  const tangled = rows.find((row) => row.name === "tangled");
  assert.equal(tangled?.coverage, 1);
  assert.equal(tangled?.crap, 10);
});

test("scoreFile: partial coverage uses covered executable lines", () => {
  const src =
    "function f(a: number) {\n  if (a) {\n    return 1;\n  }\n  return 2;\n}\n";
  const lines = new Map([
    [2, 1],
    [3, 0],
    [5, 1],
  ]);
  const [row] = scoreFile("y.ts", src, lines);
  assert.ok(row);
  assert.equal(row.complexity, 2);
  assert.ok(Math.abs(row.coverage - 2 / 3) < 1e-9);
});

test("formatTable: prints a header and one line for each function", () => {
  const text = formatTable([
    { file: "a.ts", name: "f", complexity: 2, coverage: 0.5, crap: 2.5 },
  ]);
  const lines = text.split("\n");
  assert.equal(lines.length, 2);
  assert.match(
    lines[0] ?? "",
    /file\s+function\s+complexity\s+coverage\s+CRAP/,
  );
  assert.match(lines[1] ?? "", /a\.ts\s+f\s+2\s+50\.0%\s+2\.50/);
});

test("analyzeSource: names constructors, variables, and anonymous functions", () => {
  const src = [
    "class A {",
    "  constructor() {}",
    "}",
    "const f = function () {};",
    "export default function () {}",
    "",
  ].join("\n");
  const names = analyzeSource("n.ts", src).map((fn) => fn.name);
  assert.deepEqual(names, ["A.constructor", "f", "<anonymous>@5"]);
});
