/**
 * Pass-rate helpers for repeated eval runs. A run passes when the model
 * found every seeded bug and reported no false positive.
 */

export function runPassed(cell) {
  if (cell.error || !String(cell.output || "").trim()) {
    return false;
  }
  const { foundCount, total, falsePositives } = cell.score;
  return foundCount === total && falsePositives === 0;
}

export function passRate(cells) {
  const passed = cells.filter(runPassed).length;
  const total = cells.length;
  return { passed, total, text: `${passed} of ${total} runs` };
}

export function groupByCase(cells) {
  const groups = new Map();
  for (const cell of cells) {
    const key = `${cell.provider}\u0000${cell.caseId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        provider: cell.provider,
        caseId: cell.caseId,
        cells: [],
      });
    }
    groups.get(key).cells.push(cell);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    rate: passRate(group.cells),
  }));
}

export function toolOverhead(withTool, withoutTool) {
  if (typeof withTool !== "number" || typeof withoutTool !== "number") {
    return undefined;
  }
  return withTool - withoutTool;
}
