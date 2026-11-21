/**
 * Builds the promptfoo test list: every case, repeated for each run.
 * The no-tool baseline row sends the full image inline with no tools.
 */

export const MIN_RUNS = 3;
export const MAX_RUNS = 5;

export function parseRuns(raw) {
  const value = Number(raw ?? MIN_RUNS);
  if (!Number.isInteger(value) || value < MIN_RUNS || value > MAX_RUNS) {
    throw new Error(`EVALS_RUNS must be ${MIN_RUNS} to ${MAX_RUNS}`);
  }
  return value;
}

const LAYOUT_SIZE = { width: 1280, height: 800 };

export function baseCases(imageDir) {
  const scale = (name, file, width, height) => ({
    description: `buggy-01 ${name}`,
    vars: {
      case_id: "buggy-01",
      scale: name,
      width,
      height,
      image: `${imageDir}/scales/${file}.png`,
    },
  });
  return [
    scale("full", "full", 1872, 1404),
    scale("0.5", "scale-0.5", 936, 702),
    scale("0.25", "scale-0.25", 468, 351),
    {
      description: "buggy-01 full size, no tool (baseline)",
      vars: {
        case_id: "buggy-01",
        scale: "full-no-tool",
        width: 1872,
        height: 1404,
        image: `${imageDir}/scales/full.png`,
        delivery: "inline",
      },
    },
    {
      description: "clean start panel (negative case)",
      vars: {
        case_id: "clean",
        scale: "clean",
        width: 1872,
        height: 1404,
        image: `${imageDir}/clean.png`,
      },
    },
    ...["form", "table", "chat"].map((name) => ({
      description: `layout ${name}`,
      vars: {
        case_id: `layout-${name}`,
        scale: `layout-${name}`,
        ...LAYOUT_SIZE,
        image: `${imageDir}/layouts/${name}.png`,
        prompt_kind: "layout",
      },
    })),
  ];
}

const js = (metric, file, config) => ({
  type: "javascript",
  metric,
  value: `file://lib/${file}`,
  ...(config ? { config } : {}),
});

function assertionsFor(caseId) {
  if (caseId === "buggy-01") {
    return [
      js("saw-image", "assert-saw-image.cjs"),
      ...["a", "b", "c", "d"].map((id) =>
        js(`bug-${id}`, `assert-bug-${id}.cjs`),
      ),
      js("false-positives", "assert-false-positives.cjs"),
    ];
  }
  return [
    js("case-bugs", "assert-case.cjs", { metric: "case-bugs" }),
    js("case-fp", "assert-case.cjs", { metric: "case-fp" }),
  ];
}

export function buildTests(imageDir, runs) {
  const tests = [];
  for (const base of baseCases(imageDir)) {
    for (let run = 1; run <= runs; run += 1) {
      tests.push({
        description: `${base.description} run ${run}`,
        vars: { ...base.vars, run },
        assert: assertionsFor(base.vars.case_id),
      });
    }
  }
  return tests;
}
