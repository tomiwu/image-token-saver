import { scoreCase } from "./cases.mjs";

export function assertCase(output, caseId, metric) {
  const score = scoreCase(caseId, String(output || ""));
  if (metric === "case-fp") {
    const pass = score.falsePositives === 0;
    return {
      pass,
      score: pass ? 1 : 0,
      reason: pass
        ? "No false-positive items"
        : `${score.falsePositives} false-positive item(s)`,
    };
  }
  const pass = score.foundCount === score.total;
  return {
    pass,
    score: score.total ? score.foundCount / score.total : 1,
    reason: `Found ${score.foundCount} of ${score.total} seeded bugs`,
  };
}
