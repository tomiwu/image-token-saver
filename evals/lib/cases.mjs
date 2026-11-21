/**
 * Answer keys for the eval images. The written keys are in
 * evals/answer-key.md (buggy-01) and evals/layout-keys.md (the rest).
 * An item that matches no seeded bug is a false positive.
 */
import {
  mentionsCutoff,
  normalize,
  scoreOutput,
  splitItems,
} from "./score.mjs";

const has = (text, pattern) => pattern.test(text);

const clipped = (n) =>
  mentionsCutoff(n) || has(n, /(?:off|beyond|past) the (?:\w+ )?edge|outside/);

const LAYOUT_BUGS = {
  "layout-form": [
    {
      id: "a",
      test: (n) => has(n, /email/) && has(n, /overlap|collid|on top of|covers/),
    },
    { id: "b", test: (n) => has(n, /svae/) },
    {
      id: "c",
      test: (n) => has(n, /product updates|receive product/) && clipped(n),
    },
  ],
  "layout-table": [
    {
      id: "a",
      test: (n) => has(n, /inv-1003/) && has(n, /duplicat|twice|repeat|same/),
    },
    { id: "b", test: (n) => has(n, /2026-13-45|13-45|month 13/) },
    {
      id: "c",
      test: (n) => has(n, /total|amount/) && clipped(n),
    },
  ],
  "layout-chat": [
    { id: "a", test: (n) => has(n, /27\s*[:.]\s*15/) },
    {
      id: "b",
      test: (n) => has(n, /bubble|message/) && clipped(n),
    },
    { id: "c", test: (n) => has(n, /avatar/) && has(n, /overlap/) },
  ],
};

export const CASES = {
  "buggy-01": { total: 4 },
  clean: { total: 0 },
  "layout-form": { total: 3 },
  "layout-table": { total: 3 },
  "layout-chat": { total: 3 },
};

export function caseTotal(caseId) {
  if (!CASES[caseId]) {
    throw new Error(`Unknown case ${caseId}`);
  }
  return CASES[caseId].total;
}

function scoreNegative(text) {
  const items = splitItems(text);
  return {
    found: {},
    foundCount: 0,
    total: 0,
    falsePositives: items.length,
    falsePositiveItems: items,
    sawImage: true,
  };
}

function scoreLayout(caseId, text) {
  const bugs = LAYOUT_BUGS[caseId];
  const hits = (item) => bugs.filter((bug) => bug.test(normalize(item)));
  const found = Object.fromEntries(
    bugs.map((bug) => [bug.id, bug.test(normalize(text))]),
  );
  const unmatched = splitItems(text).filter((item) => hits(item).length === 0);
  return {
    found,
    foundCount: Object.values(found).filter(Boolean).length,
    total: bugs.length,
    falsePositives: unmatched.length,
    falsePositiveItems: unmatched,
    sawImage: true,
  };
}

export function scoreCase(caseId, text) {
  caseTotal(caseId);
  if (caseId === "buggy-01") {
    return scoreOutput(text);
  }
  if (caseId === "clean") {
    return scoreNegative(text);
  }
  return scoreLayout(caseId, text);
}
