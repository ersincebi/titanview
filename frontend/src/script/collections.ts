/**
 * Complete TitanScript `map.*` and `matrix.*` standard library implementations.
 */
import {
  ScriptArray,
  ScriptMap,
  ScriptMatrix,
  ScriptObject,
  ScriptRuntimeError,
  isNa,
  toNum,
} from './values';

export const COLLECTION_NOT_HANDLED = Symbol('collection-not-handled');

const EPS = 1e-12;

function defaultForType(typeName?: string): any {
  if (typeName === 'bool') return false;
  if (typeName === 'int' || typeName === 'float') return NaN;
  return null;
}

// ============================================================================
// map.* (all 11 TitanScript functions)
// ============================================================================

export const MAP_SIGS: Record<string, string[]> = {
  put: ['id', 'key', 'value'],
  put_all: ['id1', 'id2'],
  get: ['id', 'key'],
  contains: ['id', 'key'],
  remove: ['id', 'key'],
  clear: ['id'],
  size: ['id'],
  keys: ['id'],
  values: ['id'],
  copy: ['id'],
};

function requireMap(v: any, fn: string, line: number): ScriptMap {
  if (!(v instanceof ScriptMap)) {
    throw new ScriptRuntimeError(line, `map.${fn}: ilk argüman geçerli bir map olmalıdır.`);
  }
  return v;
}

export function mapCall(
  fn: string,
  a: any[],
  line: number,
  typeArgs?: string[]
): any {
  if (fn === 'new') {
    return new ScriptMap(typeArgs?.[0], typeArgs?.[1]);
  }
  if (fn === 'copy') {
    if (isNa(a[0])) return null;
    const m = requireMap(a[0], fn, line);
    const out = new ScriptMap(m.keyType, m.valueType);
    for (const [k, v] of m.items) out.items.set(k, v);
    return out;
  }
  const m = requireMap(a[0], fn, line);
  const naVal = m.valueType === 'int' || m.valueType === 'float' ? NaN : null;
  switch (fn) {
    case 'put': {
      const key = a[1];
      const val = a[2];
      const prev = m.items.has(key) ? m.items.get(key) : naVal;
      m.items.set(key, val);
      return prev;
    }
    case 'put_all': {
      const m2 = requireMap(a[1], fn, line);
      for (const [k, v] of m2.items) m.items.set(k, v);
      return null;
    }
    case 'get':
      return m.items.has(a[1]) ? m.items.get(a[1]) : naVal;
    case 'contains':
      return m.items.has(a[1]);
    case 'remove': {
      if (!m.items.has(a[1])) return naVal;
      const prev = m.items.get(a[1]);
      m.items.delete(a[1]);
      return prev;
    }
    case 'clear':
      m.items.clear();
      return null;
    case 'size':
      return m.items.size;
    case 'keys':
      return new ScriptArray([...m.items.keys()], m.keyType);
    case 'values':
      return new ScriptArray([...m.items.values()], m.valueType);
  }
  return COLLECTION_NOT_HANDLED;
}

// ============================================================================
// matrix.* (all TitanScript functions)
// ============================================================================

export const MATRIX_SIGS: Record<string, string[]> = {
  new: ['rows', 'columns', 'initial_value'],
  copy: ['id'],
  rows: ['id'],
  columns: ['id'],
  elements_count: ['id'],
  get: ['id', 'row', 'column'],
  set: ['id', 'row', 'column', 'value'],
  fill: ['id', 'value', 'from_row', 'to_row', 'from_column', 'to_column'],
  row: ['id', 'row'],
  col: ['id', 'column'],
  add_row: ['id', 'row', 'array_id'],
  add_col: ['id', 'column', 'array_id'],
  remove_row: ['id', 'row'],
  remove_col: ['id', 'column'],
  swap_rows: ['id', 'row1', 'row2'],
  swap_columns: ['id', 'column1', 'column2'],
  reverse: ['id'],
  reshape: ['id', 'rows', 'columns'],
  concat: ['id1', 'id2'],
  submatrix: ['id', 'from_row', 'to_row', 'from_column', 'to_column'],
  sort: ['id', 'column', 'order', 'sort_field'],
  min: ['id'],
  max: ['id'],
  avg: ['id'],
  median: ['id'],
  mode: ['id'],
  sum: ['id1', 'id2'],
  diff: ['id1', 'id2'],
  mult: ['id1', 'id2'],
  pow: ['id', 'power'],
  transpose: ['id'],
  trace: ['id'],
  det: ['id'],
  inv: ['id'],
  pinv: ['id'],
  rank: ['id'],
  eigenvalues: ['id'],
  eigenvectors: ['id'],
  kron: ['id1', 'id2'],
  is_square: ['id'],
  is_identity: ['id'],
  is_diagonal: ['id'],
  is_antidiagonal: ['id'],
  is_symmetric: ['id'],
  is_antisymmetric: ['id'],
  is_triangular: ['id'],
  is_stochastic: ['id'],
  is_binary: ['id'],
  is_zero: ['id'],
};

function requireMatrix(v: any, fn: string, line: number): ScriptMatrix {
  if (!(v instanceof ScriptMatrix)) {
    throw new ScriptRuntimeError(line, `matrix.${fn}: argüman geçerli bir matrix olmalıdır.`);
  }
  return v;
}

function checkRow(m: ScriptMatrix, r: unknown, fn: string, line: number, allowEnd = false): number {
  const k = toNum(r);
  const max = allowEnd ? m.rows : m.rows - 1;
  if (!Number.isInteger(k) || k < 0 || k > max) {
    throw new ScriptRuntimeError(line, `matrix.${fn}: satır indeksi ${k} sınır dışı (satır sayısı ${m.rows}).`);
  }
  return k;
}

function checkCol(m: ScriptMatrix, c: unknown, fn: string, line: number, allowEnd = false): number {
  const k = toNum(c);
  const max = allowEnd ? m.cols : m.cols - 1;
  if (!Number.isInteger(k) || k < 0 || k > max) {
    throw new ScriptRuntimeError(line, `matrix.${fn}: sütun indeksi ${k} sınır dışı (sütun sayısı ${m.cols}).`);
  }
  return k;
}

function requireSquare(m: ScriptMatrix, fn: string, line: number): number {
  if (m.rows === 0 || m.rows !== m.cols) {
    throw new ScriptRuntimeError(
      line,
      `matrix.${fn}: kare ve boş olmayan bir matris bekleniyor (${m.rows}x${m.cols}).`
    );
  }
  return m.rows;
}

function toNumMatrix(m: ScriptMatrix): number[][] {
  return m.data.map((row) => row.map((v) => toNum(v)));
}

function fromNumMatrix(data: number[][], elemType = 'float'): ScriptMatrix {
  const rows = data.length;
  const cols = rows > 0 ? data[0].length : 0;
  const out = new ScriptMatrix(0, cols, NaN, elemType);
  out.data = data.map((r) => [...r]);
  return out;
}

function nonNaNums(m: ScriptMatrix): number[] {
  const out: number[] = [];
  for (const row of m.data) {
    for (const v of row) {
      const n = toNum(v);
      if (!Number.isNaN(n)) out.push(n);
    }
  }
  return out;
}

function compareValues(a: any, b: any): number {
  const na = isNa(a);
  const nb = isNa(b);
  if (na && nb) return 0;
  if (na) return 1;
  if (nb) return -1;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return toNum(a) - toNum(b);
}

// ---------------------------------------------------------------- linear algebra

function matMulRaw(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const k = A[0]?.length ?? 0;
  const n = B[0]?.length ?? 0;
  const C: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let p = 0; p < k; p++) {
      const aip = A[i][p];
      if (aip === 0) continue;
      for (let j = 0; j < n; j++) C[i][j] += aip * B[p][j];
    }
  }
  return C;
}

function identityRaw(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

function detRaw(A: number[][]): number {
  const n = A.length;
  const M = A.map((r) => [...r]);
  let sign = 1;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > maxVal) {
        maxVal = v;
        pivot = r;
      }
    }
    if (Number.isNaN(maxVal)) return NaN;
    if (maxVal < EPS) return 0;
    if (pivot !== col) {
      [M[col], M[pivot]] = [M[pivot], M[col]];
      sign = -sign;
    }
    const diag = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / diag;
      for (let c = col; c < n; c++) M[r][c] -= f * M[col][c];
    }
  }
  let d = sign;
  for (let i = 0; i < n; i++) d *= M[i][i];
  return Math.abs(d) < EPS ? 0 : d;
}

function invRaw(A: number[][]): number[][] | null {
  const n = A.length;
  const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > maxVal) {
        maxVal = v;
        pivot = r;
      }
    }
    if (!Number.isFinite(maxVal) || maxVal < EPS) return null;
    if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];
    const diag = M[col][col];
    for (let c = 0; c < 2 * n; c++) M[col][c] /= diag;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = 0; c < 2 * n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((r) => r.slice(n));
}

function rankRaw(A: number[][]): number {
  const rows = A.length;
  const cols = rows > 0 ? A[0].length : 0;
  if (rows === 0 || cols === 0) return 0;
  const M = A.map((r) => [...r]);
  let rank = 0;
  for (let col = 0; col < cols && rank < rows; col++) {
    let pivot = rank;
    let maxVal = Math.abs(M[rank][col]);
    for (let r = rank + 1; r < rows; r++) {
      const v = Math.abs(M[r][col]);
      if (v > maxVal) {
        maxVal = v;
        pivot = r;
      }
    }
    if (!Number.isFinite(maxVal) || maxVal < 1e-10) continue;
    if (pivot !== rank) [M[rank], M[pivot]] = [M[pivot], M[rank]];
    const diag = M[rank][col];
    for (let r = rank + 1; r < rows; r++) {
      const f = M[r][col] / diag;
      for (let c = col; c < cols; c++) M[r][c] -= f * M[rank][c];
    }
    rank++;
  }
  return rank;
}

/**
 * Moore-Penrose pseudoinverse via one-sided Jacobi SVD.
 * Works for all rectangular, square, and rank-deficient matrices.
 */
function pinvRaw(A: number[][]): number[][] {
  const m = A.length;
  const n = m > 0 ? A[0].length : 0;
  if (m === 0 || n === 0) return [];
  // If wide (m < n), compute pinv(A^T)^T so we always have rows >= cols
  if (m < n) {
    const AT: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => A[j][i]));
    const pAT = pinvRaw(AT);
    return Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => pAT[j][i]));
  }
  // One-sided Jacobi on columns of U (starts as A, size m x n, m >= n)
  const U = A.map((r) => [...r]);
  const V = identityRaw(n);
  for (let sweep = 0; sweep < 60; sweep++) {
    let converged = true;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        let a = 0;
        let b = 0;
        let c = 0;
        for (let i = 0; i < m; i++) {
          a += U[i][p] * U[i][p];
          b += U[i][q] * U[i][q];
          c += U[i][p] * U[i][q];
        }
        if (Math.abs(c) <= 1e-14 * Math.sqrt(a * b)) continue;
        converged = false;
        const zeta = (b - a) / (2 * c);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const cs = 1 / Math.sqrt(1 + t * t);
        const sn = cs * t;
        for (let i = 0; i < m; i++) {
          const up = U[i][p];
          const uq = U[i][q];
          U[i][p] = cs * up - sn * uq;
          U[i][q] = sn * up + cs * uq;
        }
        for (let i = 0; i < n; i++) {
          const vp = V[i][p];
          const vq = V[i][q];
          V[i][p] = cs * vp - sn * vq;
          V[i][q] = sn * vp + cs * vq;
        }
      }
    }
    if (converged) break;
  }
  const sigma = new Array<number>(n);
  let maxSig = 0;
  for (let j = 0; j < n; j++) {
    let norm = 0;
    for (let i = 0; i < m; i++) norm += U[i][j] * U[i][j];
    sigma[j] = Math.sqrt(norm);
    if (sigma[j] > maxSig) maxSig = sigma[j];
  }
  const tol = Math.max(m, n) * 1e-12 * maxSig;
  // A^+ = V * Sigma^+ * U_norm^T, where U_norm[:,j] = U[:,j] / sigma[j]
  // So (A^+)[r][c] = sum_j (sigma[j] > tol ? V[r][j] * U[c][j] / (sigma[j]^2) : 0)
  const out: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let j = 0; j < n; j++) {
    if (sigma[j] <= tol) continue;
    const invS2 = 1 / (sigma[j] * sigma[j]);
    for (let r = 0; r < n; r++) {
      const vr = V[r][j] * invS2;
      for (let c = 0; c < m; c++) out[r][c] += vr * U[c][j];
    }
  }
  return out;
}

function isSymmetricRaw(A: number[][]): boolean {
  const n = A.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(A[i][j] - A[j][i]) > 1e-12) return false;
    }
  }
  return true;
}

/** Symmetric Jacobi eigensolver: exact orthonormal eigenvectors and real eigenvalues. */
function symmetricEigen(A: number[][]): { values: number[]; vectors: number[][] } {
  const n = A.length;
  const D = A.map((r) => [...r]);
  const V = identityRaw(n);
  for (let iter = 0; iter < 100 * n * n; iter++) {
    let p = 0;
    let q = 1;
    let maxOff = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = Math.abs(D[i][j]);
        if (v > maxOff) {
          maxOff = v;
          p = i;
          q = j;
        }
      }
    }
    if (maxOff < 1e-13) break;
    const diff = D[q][q] - D[p][p];
    const t =
      Math.abs(D[p][q]) < 1e-30 * Math.abs(diff)
        ? D[p][q] / diff
        : (() => {
            const phi = diff / (2 * D[p][q]);
            return 1 / (Math.abs(phi) + Math.sqrt(phi * phi + 1)) * (phi < 0 ? -1 : 1);
          })();
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    const tau = s / (1 + c);
    const apq = D[p][q];
    D[p][p] -= t * apq;
    D[q][q] += t * apq;
    D[p][q] = 0;
    D[q][p] = 0;
    for (let r = 0; r < n; r++) {
      if (r === p || r === q) continue;
      const drp = D[r][p];
      const drq = D[r][q];
      D[r][p] = drp - s * (drq + tau * drp);
      D[p][r] = D[r][p];
      D[r][q] = drq + s * (drp - tau * drq);
      D[q][r] = D[r][q];
    }
    for (let r = 0; r < n; r++) {
      const vrp = V[r][p];
      const vrq = V[r][q];
      V[r][p] = vrp - s * (vrq + tau * vrp);
      V[r][q] = vrq + s * (vrp - tau * vrq);
    }
  }
  // Sort descending by eigenvalue for deterministic output
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => D[j][j] - D[i][i]);
  const values = order.map((i) => (Math.abs(D[i][i]) < 1e-13 ? 0 : D[i][i]));
  const vectors = Array.from({ length: n }, (_, r) => order.map((c) => V[r][c]));
  return { values, vectors };
}

/** General real eigensolver: symmetric Jacobi, closed-form 2x2, or Hessenberg + QR + nullspace. */
function generalEigen(A: number[][]): { values: number[]; vectors: number[][] } {
  const n = A.length;
  if (n === 1) return { values: [A[0][0]], vectors: [[1]] };
  if (isSymmetricRaw(A)) return symmetricEigen(A);
  if (n === 2) {
    const a = A[0][0], b = A[0][1], c = A[1][0], d = A[1][1];
    const tr = a + d;
    const det = a * d - b * c;
    const disc = tr * tr - 4 * det;
    if (disc < -1e-12) return { values: [NaN, NaN], vectors: [[NaN, NaN], [NaN, NaN]] };
    const sq = Math.sqrt(Math.max(0, disc));
    const l1 = (tr + sq) / 2;
    const l2 = (tr - sq) / 2;
    const eigVec = (lam: number): [number, number] => {
      if (Math.abs(b) > EPS) {
        const len = Math.hypot(b, lam - a);
        return [b / len, (lam - a) / len];
      }
      if (Math.abs(c) > EPS) {
        const len = Math.hypot(lam - d, c);
        return [(lam - d) / len, c / len];
      }
      return Math.abs(a - lam) <= Math.abs(d - lam) ? [1, 0] : [0, 1];
    };
    const v1 = eigVec(l1);
    const v2 = eigVec(l2);
    return { values: [l1, l2], vectors: [[v1[0], v2[0]], [v1[1], v2[1]]] };
  }
  // Reduce to upper Hessenberg via Householder reflections
  const H = A.map((r) => [...r]);
  for (let k = 0; k < n - 2; k++) {
    let norm = 0;
    for (let i = k + 1; i < n; i++) norm += H[i][k] * H[i][k];
    norm = Math.sqrt(norm);
    if (norm < EPS) continue;
    const sign = H[k + 1][k] >= 0 ? 1 : -1;
    const u0 = H[k + 1][k] + sign * norm;
    const u = new Array<number>(n - k - 1);
    u[0] = 1;
    let uNorm2 = 1;
    for (let i = 1; i < u.length; i++) {
      u[i] = H[k + 1 + i][k] / u0;
      uNorm2 += u[i] * u[i];
    }
    const beta = 2 / uNorm2;
    for (let j = k; j < n; j++) {
      let dot = 0;
      for (let i = 0; i < u.length; i++) dot += u[i] * H[k + 1 + i][j];
      for (let i = 0; i < u.length; i++) H[k + 1 + i][j] -= beta * dot * u[i];
    }
    for (let i = 0; i < n; i++) {
      let dot = 0;
      for (let j = 0; j < u.length; j++) dot += H[i][k + 1 + j] * u[j];
      for (let j = 0; j < u.length; j++) H[i][k + 1 + j] -= beta * dot * u[j];
    }
  }
  // Shifted QR iteration on Hessenberg matrix
  const values: number[] = [];
  let m = n;
  let guard = 0;
  while (m > 0 && guard++ < 500 * n) {
    if (m === 1) {
      values.push(H[0][0]);
      break;
    }
    if (Math.abs(H[m - 1][m - 2]) < 1e-12 * (Math.abs(H[m - 2][m - 2]) + Math.abs(H[m - 1][m - 1]) + 1)) {
      values.push(H[m - 1][m - 1]);
      m--;
      continue;
    }
    // Wilkinson shift from trailing 2x2 block
    const a = H[m - 2][m - 2], b = H[m - 2][m - 1], c = H[m - 1][m - 2], d = H[m - 1][m - 1];
    const disc = (a - d) * (a - d) + 4 * b * c;
    const shift =
      disc >= 0
        ? (() => {
            const tr = a + d;
            const sq = Math.sqrt(disc);
            const r1 = (tr + sq) / 2;
            const r2 = (tr - sq) / 2;
            return Math.abs(r1 - d) < Math.abs(r2 - d) ? r1 : r2;
          })()
        : d;
    for (let i = 0; i < m; i++) H[i][i] -= shift;
    // Givens QR step on m x m Hessenberg
    const cs = new Array<number>(m - 1);
    const sn = new Array<number>(m - 1);
    for (let i = 0; i < m - 1; i++) {
      const r = Math.hypot(H[i][i], H[i + 1][i]);
      if (r < 1e-30) {
        cs[i] = 1;
        sn[i] = 0;
        continue;
      }
      cs[i] = H[i][i] / r;
      sn[i] = H[i + 1][i] / r;
      for (let j = i; j < m; j++) {
        const t1 = cs[i] * H[i][j] + sn[i] * H[i + 1][j];
        const t2 = -sn[i] * H[i][j] + cs[i] * H[i + 1][j];
        H[i][j] = t1;
        H[i + 1][j] = t2;
      }
    }
    for (let i = 0; i < m - 1; i++) {
      for (let row = 0; row <= Math.min(i + 1, m - 1); row++) {
        const t1 = H[row][i] * cs[i] + H[row][i + 1] * sn[i];
        const t2 = -H[row][i] * sn[i] + H[row][i + 1] * cs[i];
        H[row][i] = t1;
        H[row][i + 1] = t2;
      }
    }
    for (let i = 0; i < m; i++) H[i][i] += shift;
  }
  while (values.length < n) values.push(NaN);
  values.sort((x, y) => y - x);
  // Solve (A - lam*I) v = 0 for each real eigenvalue via nullspace of RREF
  const vectors: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let k = 0; k < n; k++) {
    const lam = values[k];
    if (Number.isNaN(lam)) {
      for (let r = 0; r < n; r++) vectors[r][k] = NaN;
      continue;
    }
    const M = A.map((row, i) => row.map((v, j) => (i === j ? v - lam : v)));
    // Find eigenvector via Gaussian elimination to RREF + free variable
    const pivotCol: number[] = [];
    let r = 0;
    for (let col = 0; col < n && r < n; col++) {
      let piv = r;
      for (let i = r + 1; i < n; i++) if (Math.abs(M[i][col]) > Math.abs(M[piv][col])) piv = i;
      if (Math.abs(M[piv][col]) < 1e-9) continue;
      [M[r], M[piv]] = [M[piv], M[r]];
      const diag = M[r][col];
      for (let c = col; c < n; c++) M[r][c] /= diag;
      for (let i = 0; i < n; i++) {
        if (i === r) continue;
        const f = M[i][col];
        for (let c = col; c < n; c++) M[i][c] -= f * M[r][c];
      }
      pivotCol.push(col);
      r++;
    }
    const pivotSet = new Set(pivotCol);
    const freeCol = Array.from({ length: n }, (_, i) => i).find((c) => !pivotSet.has(c)) ?? n - 1;
    const vec = new Array<number>(n).fill(0);
    vec[freeCol] = 1;
    for (let i = 0; i < pivotCol.length; i++) vec[pivotCol[i]] = -M[i][freeCol];
    const norm = Math.hypot(...vec) || 1;
    for (let i = 0; i < n; i++) vectors[i][k] = vec[i] / norm;
  }
  return { values, vectors };
}

export function matrixCall(
  fn: string,
  a: any[],
  line: number,
  typeArgs?: string[]
): any {
  if (fn === 'new') {
    const elemType = typeArgs?.[0];
    const rows = a[0] === undefined || isNa(a[0]) ? 0 : toNum(a[0]);
    const cols = a[1] === undefined || isNa(a[1]) ? 0 : toNum(a[1]);
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 0 || cols < 0) {
      throw new ScriptRuntimeError(line, `matrix.new: geçersiz boyut (${rows}x${cols}).`);
    }
    const init = a[2] === undefined ? defaultForType(elemType) : a[2];
    return new ScriptMatrix(rows, cols, init, elemType);
  }
  if (fn === 'copy') {
    if (isNa(a[0])) return null;
    const m = requireMatrix(a[0], fn, line);
    const out = new ScriptMatrix(0, m.cols, NaN, m.elemType);
    out.data = m.data.map((r) => [...r]);
    return out;
  }

  const m = requireMatrix(a[0], fn, line);

  switch (fn) {
    case 'rows':
      return m.rows;
    case 'columns':
      return m.cols;
    case 'elements_count':
      return m.rows * m.cols;

    case 'get': {
      const r = checkRow(m, a[1], fn, line);
      const c = checkCol(m, a[2], fn, line);
      return m.data[r][c];
    }
    case 'set': {
      const r = checkRow(m, a[1], fn, line);
      const c = checkCol(m, a[2], fn, line);
      m.data[r][c] = a[3];
      return null;
    }
    case 'fill': {
      const val = a[1];
      const fromR = a[2] === undefined || isNa(a[2]) ? 0 : toNum(a[2]);
      const toR = a[3] === undefined || isNa(a[3]) ? m.rows : toNum(a[3]);
      const fromC = a[4] === undefined || isNa(a[4]) ? 0 : toNum(a[4]);
      const toC = a[5] === undefined || isNa(a[5]) ? m.cols : toNum(a[5]);
      if (fromR < 0 || toR > m.rows || fromC < 0 || toC > m.cols || fromR > toR || fromC > toC) {
        throw new ScriptRuntimeError(line, `matrix.fill: geçersiz aralık [${fromR}:${toR}, ${fromC}:${toC}].`);
      }
      for (let r = fromR; r < toR; r++) {
        for (let c = fromC; c < toC; c++) m.data[r][c] = val;
      }
      return null;
    }
    case 'row': {
      const r = checkRow(m, a[1], fn, line);
      return new ScriptArray([...m.data[r]], m.elemType);
    }
    case 'col': {
      const c = checkCol(m, a[1], fn, line);
      return new ScriptArray(m.data.map((row) => row[c]), m.elemType);
    }
    case 'add_row': {
      const r = a[1] === undefined || isNa(a[1]) ? m.rows : checkRow(m, a[1], fn, line, true);
      const arrArg = a[2];
      if (arrArg instanceof ScriptArray) {
        if (m.rows === 0 && m.cols === 0) {
          m.cols = arrArg.items.length;
        } else if (arrArg.items.length !== m.cols) {
          throw new ScriptRuntimeError(
            line,
            `matrix.add_row: dizi uzunluğu (${arrArg.items.length}) sütun sayısıyla (${m.cols}) eşleşmiyor.`
          );
        }
        m.data.splice(r, 0, [...arrArg.items]);
      } else {
        const def = defaultForType(m.elemType);
        m.data.splice(r, 0, Array.from({ length: m.cols }, () => def));
      }
      return null;
    }
    case 'add_col': {
      const c = a[1] === undefined || isNa(a[1]) ? m.cols : checkCol(m, a[1], fn, line, true);
      const arrArg = a[2];
      if (arrArg instanceof ScriptArray) {
        if (m.rows === 0 && m.cols === 0) {
          m.data = arrArg.items.map((v) => [v]);
          m.cols = 1;
          return null;
        }
        if (arrArg.items.length !== m.rows) {
          throw new ScriptRuntimeError(
            line,
            `matrix.add_col: dizi uzunluğu (${arrArg.items.length}) satır sayısıyla (${m.rows}) eşleşmiyor.`
          );
        }
        for (let r = 0; r < m.rows; r++) m.data[r].splice(c, 0, arrArg.items[r]);
        m.cols++;
      } else {
        const def = defaultForType(m.elemType);
        for (let r = 0; r < m.rows; r++) m.data[r].splice(c, 0, def);
        m.cols++;
      }
      return null;
    }
    case 'remove_row': {
      if (m.rows === 0) throw new ScriptRuntimeError(line, 'matrix.remove_row: matris boş.');
      const r = a[1] === undefined || isNa(a[1]) ? m.rows - 1 : checkRow(m, a[1], fn, line);
      const removed = m.data.splice(r, 1)[0];
      if (m.data.length === 0) m.cols = 0;
      return new ScriptArray(removed, m.elemType);
    }
    case 'remove_col': {
      if (m.cols === 0) throw new ScriptRuntimeError(line, 'matrix.remove_col: matris boş.');
      const c = a[1] === undefined || isNa(a[1]) ? m.cols - 1 : checkCol(m, a[1], fn, line);
      const removed = m.data.map((row) => row.splice(c, 1)[0]);
      m.cols--;
      if (m.cols === 0) m.data = [];
      return new ScriptArray(removed, m.elemType);
    }
    case 'swap_rows': {
      const r1 = checkRow(m, a[1], fn, line);
      const r2 = checkRow(m, a[2], fn, line);
      [m.data[r1], m.data[r2]] = [m.data[r2], m.data[r1]];
      return null;
    }
    case 'swap_columns': {
      const c1 = checkCol(m, a[1], fn, line);
      const c2 = checkCol(m, a[2], fn, line);
      for (let r = 0; r < m.rows; r++) {
        [m.data[r][c1], m.data[r][c2]] = [m.data[r][c2], m.data[r][c1]];
      }
      return null;
    }
    case 'reverse': {
      m.data.reverse();
      for (const row of m.data) row.reverse();
      return null;
    }
    case 'reshape': {
      const newR = toNum(a[1]);
      const newC = toNum(a[2]);
      if (!Number.isInteger(newR) || !Number.isInteger(newC) || newR < 0 || newC < 0 || newR * newC !== m.rows * m.cols) {
        throw new ScriptRuntimeError(
          line,
          `matrix.reshape: ${m.rows}x${m.cols} matris ${newR}x${newC} biçimine dönüştürülemez.`
        );
      }
      const flat = m.data.flat();
      m.data = [];
      for (let r = 0; r < newR; r++) m.data.push(flat.slice(r * newC, (r + 1) * newC));
      m.cols = newC;
      return null;
    }
    case 'concat': {
      const m2 = requireMatrix(a[1], fn, line);
      if (m.rows === 0 && m.cols === 0) {
        m.cols = m2.cols;
      } else if (m2.rows > 0 && m.cols !== m2.cols) {
        throw new ScriptRuntimeError(
          line,
          `matrix.concat: sütun sayıları eşleşmiyor (${m.cols} != ${m2.cols}).`
        );
      }
      for (const row of m2.data) m.data.push([...row]);
      return m;
    }
    case 'submatrix': {
      const fromR = a[1] === undefined || isNa(a[1]) ? 0 : toNum(a[1]);
      const toR = a[2] === undefined || isNa(a[2]) ? m.rows : toNum(a[2]);
      const fromC = a[3] === undefined || isNa(a[3]) ? 0 : toNum(a[3]);
      const toC = a[4] === undefined || isNa(a[4]) ? m.cols : toNum(a[4]);
      if (fromR < 0 || toR > m.rows || fromC < 0 || toC > m.cols || fromR > toR || fromC > toC) {
        throw new ScriptRuntimeError(line, `matrix.submatrix: geçersiz alt matris aralığı.`);
      }
      const out = new ScriptMatrix(0, toC - fromC, NaN, m.elemType);
      for (let r = fromR; r < toR; r++) out.data.push(m.data[r].slice(fromC, toC));
      return out;
    }
    case 'sort': {
      if (m.rows <= 1) return null;
      const col = a[1] === undefined || isNa(a[1]) ? 0 : checkCol(m, a[1], fn, line);
      const desc = a[2] === 'order.descending';
      const field = typeof a[3] === 'string' ? a[3] : undefined;
      m.data.sort((r1, r2) => {
        const v1 = field && r1[col] instanceof ScriptObject ? r1[col].fields[field] : r1[col];
        const v2 = field && r2[col] instanceof ScriptObject ? r2[col].fields[field] : r2[col];
        const cmp = compareValues(v1, v2);
        return desc ? -cmp : cmp;
      });
      return null;
    }

    // ---- stats ----
    case 'min': {
      const nums = nonNaNums(m);
      return nums.length ? Math.min(...nums) : NaN;
    }
    case 'max': {
      const nums = nonNaNums(m);
      return nums.length ? Math.max(...nums) : NaN;
    }
    case 'avg': {
      const nums = nonNaNums(m);
      return nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : NaN;
    }
    case 'median': {
      const nums = nonNaNums(m).sort((x, y) => x - y);
      if (!nums.length) return NaN;
      const mid = Math.floor(nums.length / 2);
      return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    }
    case 'mode': {
      const nums = nonNaNums(m);
      if (!nums.length) return NaN;
      const freq = new Map<number, number>();
      let bestVal = nums[0];
      let bestCnt = 0;
      for (const x of nums) {
        const c = (freq.get(x) ?? 0) + 1;
        freq.set(x, c);
        if (c > bestCnt || (c === bestCnt && x < bestVal)) {
          bestCnt = c;
          bestVal = x;
        }
      }
      return bestVal;
    }

    // ---- predicates ----
    case 'is_square':
      return m.rows === m.cols;
    case 'is_zero': {
      if (m.rows === 0 || m.cols === 0) return false;
      return m.data.every((r) => r.every((v) => toNum(v) === 0));
    }
    case 'is_binary': {
      if (m.rows === 0 || m.cols === 0) return false;
      return m.data.every((r) => r.every((v) => { const x = toNum(v); return x === 0 || x === 1; }));
    }
    case 'is_identity': {
      if (m.rows === 0 || m.rows !== m.cols) return false;
      for (let i = 0; i < m.rows; i++) {
        for (let j = 0; j < m.cols; j++) {
          if (toNum(m.data[i][j]) !== (i === j ? 1 : 0)) return false;
        }
      }
      return true;
    }
    case 'is_diagonal': {
      if (m.rows === 0 || m.rows !== m.cols) return false;
      for (let i = 0; i < m.rows; i++) {
        for (let j = 0; j < m.cols; j++) {
          if (i !== j && toNum(m.data[i][j]) !== 0) return false;
        }
      }
      return true;
    }
    case 'is_antidiagonal': {
      if (m.rows === 0 || m.rows !== m.cols) return false;
      const n = m.rows;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i + j !== n - 1 && toNum(m.data[i][j]) !== 0) return false;
        }
      }
      return true;
    }
    case 'is_symmetric': {
      if (m.rows === 0 || m.rows !== m.cols) return false;
      for (let i = 0; i < m.rows; i++) {
        for (let j = i + 1; j < m.cols; j++) {
          const aij = toNum(m.data[i][j]);
          const aji = toNum(m.data[j][i]);
          if (Number.isNaN(aij) || Number.isNaN(aji) || aij !== aji) return false;
        }
      }
      return true;
    }
    case 'is_antisymmetric': {
      if (m.rows === 0 || m.rows !== m.cols) return false;
      for (let i = 0; i < m.rows; i++) {
        for (let j = i; j < m.cols; j++) {
          const aij = toNum(m.data[i][j]);
          const aji = toNum(m.data[j][i]);
          if (Number.isNaN(aij) || Number.isNaN(aji) || aij !== -aji) return false;
        }
      }
      return true;
    }
    case 'is_triangular': {
      if (m.rows === 0 || m.rows !== m.cols) return false;
      let upper = true;
      let lower = true;
      for (let i = 0; i < m.rows; i++) {
        for (let j = 0; j < m.cols; j++) {
          const v = toNum(m.data[i][j]);
          if (Number.isNaN(v)) return false;
          if (i > j && v !== 0) upper = false;
          if (i < j && v !== 0) lower = false;
        }
      }
      return upper || lower;
    }
    case 'is_stochastic': {
      if (m.rows === 0 || m.rows !== m.cols) return false;
      for (let i = 0; i < m.rows; i++) {
        let sum = 0;
        for (let j = 0; j < m.cols; j++) {
          const v = toNum(m.data[i][j]);
          if (!Number.isFinite(v) || v < 0) return false;
          sum += v;
        }
        if (Math.abs(sum - 1) > 1e-6) return false;
      }
      return true;
    }

    // ---- linear algebra ----
    case 'sum':
    case 'diff': {
      const sign = fn === 'sum' ? 1 : -1;
      const b = a[1];
      if (b instanceof ScriptMatrix) {
        if (m.rows !== b.rows || m.cols !== b.cols) {
          throw new ScriptRuntimeError(line, `matrix.${fn}: boyutlar eşleşmiyor (${m.rows}x${m.cols} vs ${b.rows}x${b.cols}).`);
        }
        const out = m.data.map((r, i) => r.map((v, j) => toNum(v) + sign * toNum(b.data[i][j])));
        return fromNumMatrix(out, m.elemType ?? 'float');
      }
      const sc = toNum(b);
      const out = m.data.map((r) => r.map((v) => toNum(v) + sign * sc));
      return fromNumMatrix(out, m.elemType ?? 'float');
    }
    case 'mult': {
      const b = a[1];
      if (b instanceof ScriptMatrix) {
        if (m.cols !== b.rows) {
          throw new ScriptRuntimeError(line, `matrix.mult: uyumsuz boyutlar (${m.rows}x${m.cols}) * (${b.rows}x${b.cols}).`);
        }
        return fromNumMatrix(matMulRaw(toNumMatrix(m), toNumMatrix(b)), 'float');
      }
      if (b instanceof ScriptArray) {
        if (m.cols !== b.items.length) {
          throw new ScriptRuntimeError(line, `matrix.mult: matris sütun sayısı (${m.cols}) dizi uzunluğuna (${b.items.length}) eşit olmalı.`);
        }
        const vec = b.items.map(toNum);
        const out = m.data.map((row) => row.reduce((s, v, j) => s + toNum(v) * vec[j], 0));
        return new ScriptArray(out, 'float');
      }
      const sc = toNum(b);
      return fromNumMatrix(m.data.map((r) => r.map((v) => toNum(v) * sc)), 'float');
    }
    case 'pow': {
      const n = requireSquare(m, fn, line);
      const p = toNum(a[1]);
      if (!Number.isInteger(p)) throw new ScriptRuntimeError(line, `matrix.pow: üs tam sayı olmalıdır.`);
      if (p === 0) return fromNumMatrix(identityRaw(n), 'float');
      let base = toNumMatrix(m);
      let exp = p;
      if (exp < 0) {
        const inv = invRaw(base);
        if (!inv) throw new ScriptRuntimeError(line, `matrix.pow: tekil matrisin negatif kuvveti hesaplanamaz.`);
        base = inv;
        exp = -exp;
      }
      let res = identityRaw(n);
      while (exp > 0) {
        if (exp & 1) res = matMulRaw(res, base);
        exp >>= 1;
        if (exp > 0) base = matMulRaw(base, base);
      }
      return fromNumMatrix(res, 'float');
    }
    case 'transpose': {
      const out = new ScriptMatrix(0, m.rows, NaN, m.elemType);
      out.data = Array.from({ length: m.cols }, (_, c) => Array.from({ length: m.rows }, (_, r) => m.data[r][c]));
      return out;
    }
    case 'trace': {
      const n = requireSquare(m, fn, line);
      let s = 0;
      for (let i = 0; i < n; i++) s += toNum(m.data[i][i]);
      return s;
    }
    case 'det': {
      requireSquare(m, fn, line);
      return detRaw(toNumMatrix(m));
    }
    case 'inv': {
      requireSquare(m, fn, line);
      const inv = invRaw(toNumMatrix(m));
      if (!inv) throw new ScriptRuntimeError(line, `matrix.inv: tekil (singular) matrisin tersi alınamaz.`);
      return fromNumMatrix(inv, 'float');
    }
    case 'pinv': {
      if (m.rows === 0 || m.cols === 0) return new ScriptMatrix(0, 0, NaN, 'float');
      return fromNumMatrix(pinvRaw(toNumMatrix(m)), 'float');
    }
    case 'rank':
      return rankRaw(toNumMatrix(m));
    case 'eigenvalues': {
      requireSquare(m, fn, line);
      const { values } = generalEigen(toNumMatrix(m));
      return new ScriptArray(values, 'float');
    }
    case 'eigenvectors': {
      requireSquare(m, fn, line);
      const { vectors } = generalEigen(toNumMatrix(m));
      return fromNumMatrix(vectors, 'float');
    }
    case 'kron': {
      const m2 = requireMatrix(a[1], fn, line);
      const outRows = m.rows * m2.rows;
      const outCols = m.cols * m2.cols;
      const data: number[][] = Array.from({ length: outRows }, () => new Array(outCols).fill(0));
      for (let i = 0; i < m.rows; i++) {
        for (let j = 0; j < m.cols; j++) {
          const aij = toNum(m.data[i][j]);
          for (let p = 0; p < m2.rows; p++) {
            for (let q = 0; q < m2.cols; q++) {
              data[i * m2.rows + p][j * m2.cols + q] = aij * toNum(m2.data[p][q]);
            }
          }
        }
      }
      return fromNumMatrix(data, 'float');
    }
  }
  return COLLECTION_NOT_HANDLED;
}
