import {
  CalibrationError,
  CORNER_NAMES,
  type Corners,
  type Point,
} from "./types.ts";

export type Matrix3 = number[];

function pivotRow(a: number[][], column: number): number {
  let best = column;
  for (let row = column + 1; row < a.length; row++) {
    if (Math.abs(a[row][column]) > Math.abs(a[best][column])) {
      best = row;
    }
  }
  return best;
}

function eliminate(a: number[][], column: number): void {
  const pivot = a[column];
  for (let row = column + 1; row < a.length; row++) {
    const factor = a[row][column] / pivot[column];
    for (let k = column; k < pivot.length; k++) {
      a[row][k] -= factor * pivot[k];
    }
  }
}

export function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let column = 0; column < n; column++) {
    const best = pivotRow(a, column);
    [a[column], a[best]] = [a[best], a[column]];
    if (Math.abs(a[column][column]) < 1e-12) {
      throw new CalibrationError("The corner points are degenerate.");
    }
    eliminate(a, column);
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row][n];
    for (let k = row + 1; k < n; k++) {
      sum -= a[row][k] * x[k];
    }
    x[row] = sum / a[row][row];
  }
  return x;
}

function equations(src: Point, dst: Point): [number[], number[]] {
  const [x, y] = src;
  const [u, v] = dst;
  return [
    [x, y, 1, 0, 0, 0, -u * x, -u * y],
    [0, 0, 0, x, y, 1, -v * x, -v * y],
  ];
}

export function homographyFromPoints(src: Point[], dst: Point[]): Matrix3 {
  const rows: number[][] = [];
  const rhs: number[] = [];
  src.forEach((point, i) => {
    const [first, second] = equations(point, dst[i]);
    rows.push(first, second);
    rhs.push(dst[i][0], dst[i][1]);
  });
  return [...solveLinear(rows, rhs), 1];
}

export function applyHomography(h: Matrix3, point: Point): Point {
  const [x, y] = point;
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export function invertHomography(h: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, i, j] = h;
  const cofactors = [
    e * j - f * i,
    c * i - b * j,
    b * f - c * e,
    f * g - d * j,
    a * j - c * g,
    c * d - a * f,
    d * i - e * g,
    b * g - a * i,
    a * e - b * d,
  ];
  const det = a * cofactors[0] + b * cofactors[3] + c * cofactors[6];
  if (Math.abs(det) < 1e-18) {
    throw new CalibrationError("The homography cannot be inverted.");
  }
  return cofactors.map((value) => value / det);
}

export function homographyToCorners(rect: Corners, corners: Corners): Matrix3 {
  return homographyFromPoints(
    CORNER_NAMES.map((name) => rect[name]),
    CORNER_NAMES.map((name) => corners[name]),
  );
}
