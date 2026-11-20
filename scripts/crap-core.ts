import ts from "typescript";

export const CRAP_THRESHOLD = 6;

export interface FunctionInfo {
  name: string;
  complexity: number;
  startLine: number;
  endLine: number;
}

export interface CrapRow {
  file: string;
  name: string;
  complexity: number;
  coverage: number;
  crap: number;
}

export type LineHits = Map<number, number>;

export function crapScore(complexity: number, coverage: number): number {
  return complexity ** 2 * (1 - coverage) ** 3 + complexity;
}

export function findViolations(rows: CrapRow[]): CrapRow[] {
  return rows.filter((row) => row.crap >= CRAP_THRESHOLD);
}

export function exitCodeFor(violations: CrapRow[]): number {
  return Number(violations.length > 0);
}

const BRANCH_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

const BRANCH_NODES = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
]);

function isBranch(node: ts.Node): boolean {
  if (BRANCH_NODES.has(node.kind)) return true;
  return (
    ts.isBinaryExpression(node) && BRANCH_OPERATORS.has(node.operatorToken.kind)
  );
}

const FUNCTION_NODES = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

function isFunctionNode(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return FUNCTION_NODES.has(node.kind);
}

function complexityOf(fn: ts.Node): number {
  let count = 1;
  const visit = (node: ts.Node): void => {
    if (isFunctionNode(node)) return;
    if (isBranch(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn, visit);
  return count;
}

function ownerName(fn: ts.Node): string | undefined {
  return ts.isClassLike(fn.parent) ? fn.parent.name?.getText() : undefined;
}

function declaredName(fn: ts.FunctionLikeDeclaration): string | undefined {
  if (ts.isConstructorDeclaration(fn)) return "constructor";
  if (ts.isVariableDeclaration(fn.parent)) return fn.parent.name.getText();
  return fn.name?.getText();
}

function nameOf(fn: ts.FunctionLikeDeclaration, line: number): string {
  const own = declaredName(fn);
  if (own === undefined) return `<anonymous>@${line}`;
  const owner = ownerName(fn);
  return owner === undefined ? own : `${owner}.${own}`;
}

export function analyzeSource(fileName: string, text: string): FunctionInfo[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const found: FunctionInfo[] = [];
  const visit = (node: ts.Node): void => {
    if (isFunctionNode(node)) {
      const start = source.getLineAndCharacterOfPosition(node.getStart(source));
      const end = source.getLineAndCharacterOfPosition(node.getEnd());
      found.push({
        name: nameOf(node, start.line + 1),
        complexity: complexityOf(node),
        startLine: start.line + 1,
        endLine: end.line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export function parseLcov(text: string): Map<string, LineHits> {
  const hitsByFile = new Map<string, LineHits>();
  let currentFile: LineHits | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      currentFile = new Map();
      hitsByFile.set(line.slice(3), currentFile);
      continue;
    }
    if (line.startsWith("DA:") && currentFile !== undefined) {
      const [number, hits] = line.slice(3).split(",");
      currentFile.set(Number(number), Number(hits));
    }
  }
  return hitsByFile;
}

function coverageOf(fn: FunctionInfo, hits: LineHits): number {
  let total = 0;
  let covered = 0;
  for (const [line, count] of hits) {
    if (line < fn.startLine || line > fn.endLine) continue;
    total += 1;
    covered += Number(count > 0);
  }
  return total === 0 ? 0 : covered / total;
}

export function scoreFile(
  file: string,
  text: string,
  hits: LineHits = new Map(),
): CrapRow[] {
  return analyzeSource(file, text).map((fn) => {
    const coverage = coverageOf(fn, hits);
    return {
      file,
      name: fn.name,
      complexity: fn.complexity,
      coverage,
      crap: crapScore(fn.complexity, coverage),
    };
  });
}

export function formatTable(rows: CrapRow[]): string {
  const cells = rows.map((row) => [
    row.file,
    row.name,
    String(row.complexity),
    `${(row.coverage * 100).toFixed(1)}%`,
    row.crap.toFixed(2),
  ]);
  const table = [
    ["file", "function", "complexity", "coverage", "CRAP"],
    ...cells,
  ];
  const widths = table[0]?.map((_, col) =>
    Math.max(...table.map((line) => line[col]?.length ?? 0)),
  );
  return table
    .map((line) =>
      line
        .map((cell, col) => cell.padEnd(widths?.[col] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
