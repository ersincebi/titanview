import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE_PARAMS, deriveCandles } from '../../chart/chartTypes';
import type { Candle } from '../../types/market';
import { executeScript, ScriptCompileError, type RunOptions } from '../runtime';

function makeCandles(count = 30, base = 100): Candle[] {
  const out: Candle[] = [];
  let p = base;
  for (let i = 0; i < count; i++) {
    const o = p;
    const delta = Math.sin(i * 0.45) * 2.5 + (i % 3 === 0 ? 1.2 : -0.6);
    p = Math.max(10, p + delta);
    out.push({
      time: 1_700_000_000 + i * 3600,
      open: Number(o.toFixed(4)),
      high: Number((Math.max(o, p) + 0.8).toFixed(4)),
      low: Number((Math.min(o, p) - 0.8).toFixed(4)),
      close: Number(p.toFixed(4)),
      volume: 1000 + i * 50,
    });
  }
  return out;
}

function runV6(body: string, candles = makeCandles(10), opts: RunOptions = {}) {
  const res = executeScript(`//@version=6\nindicator("p17", overlay=false)\n${body}`, candles, opts);
  expect(res.error, res.error).toBeUndefined();
  expect(res.ok).toBe(true);
  return res;
}

function plotVals(res: ReturnType<typeof executeScript>, idx = 0): number[] {
  return res.plots[idx].data.map((p) => p.value);
}

function lastVal(res: ReturnType<typeof executeScript>, idx = 0): number {
  const d = res.plots[idx].data;
  return d[d.length - 1].value;
}

function expectFail(code: string, pattern: RegExp, candles = makeCandles(5)) {
  const res = executeScript(code, candles);
  expect(res.ok, `Expected failure matching ${pattern}, got ok`).toBe(false);
  expect(res.error).toMatch(pattern);
  return res;
}

// ============================================================================
// 1. UDT `type`
// ============================================================================
describe('Faz 17 — UDT type', () => {
  it('supports fields, defaults, positional/named .new(), reference semantics, and .copy()', () => {
    const r = runV6(`
type PivotPoint
    int x
    float y = 10.5
    bool active
    string tag = "P"
    array<float> hist = array.new<float>()

p1 = PivotPoint.new(bar_index)
p1.hist.push(close)
p2 = PivotPoint.new(x = bar_index + 1, y = 20.0, active = true)
p2.hist.push(open)

// Reference semantics vs shallow copy
alias = p2
alias.y := 30.0
alias.y += 5.0

cloned = p2.copy()
cloned.y := 99.0
cloned.hist.push(high) // shallow copy shares nested array!

cloned2 = PivotPoint.copy(p1)
cloned2.x := 777

plot(p1.y, title="defY")
plot(p1.active ? 1 : 0, title="defBool")
plot(p2.y, title="mutatedY")
plot(cloned.y, title="clonedY")
plot(p2.hist.size(), title="sharedHist")
plot(p1.hist.size(), title="ownHist")
plot(p1.x, title="origX")
plot(cloned2.x, title="cloned2X")
`);
    expect(lastVal(r, 0)).toBeCloseTo(10.5, 6);
    expect(lastVal(r, 1)).toBe(0); // bool default = false
    expect(lastVal(r, 2)).toBe(35); // 30 + 5 via alias
    expect(lastVal(r, 3)).toBe(99); // independent primitive field
    expect(lastVal(r, 4)).toBe(2); // shallow copy shares array ref
    expect(lastVal(r, 5)).toBe(1); // default array.new<float>() created per instance
    expect(lastVal(r, 6)).toBe(9); // bar_index of last bar (0..9)
    expect(lastVal(r, 7)).toBe(777);
  });

  it('supports nested UDTs, self-referential UDTs, chained writes, and series history [1]', () => {
    const c = makeCandles(12);
    const r = runV6(`
type Vec2
    float x = 0.0
    float y = 0.0

type Box2D
    Vec2 origin = Vec2.new(1.0, 2.0)
    float scale = 1.0

type Node
    float val
    Node next = na

b = Box2D.new()
b.origin.x := 5.0
b.origin.y += 8.0

// Nested mutation through array.get()
arr = array.new<Box2D>()
arr.push(Box2D.new(Vec2.new(3.0, 4.0), 2.0))
arr.get(0).origin.x *= 10.0

// Self-referential linked list
var Node head = na
head := Node.new(close, head)
prevClose = not na(head.next) ? head.next.val : na

// Historical object reference via [1]
snap = Vec2.new(close, high)
prevSnapX = not na(snap[1]) ? snap[1].x : na

plot(b.origin.x + b.origin.y, title="nested")
plot(arr.get(0).origin.x, title="arrNested")
plot(prevClose, title="linkedPrev")
plot(prevSnapX, title="histObj")
`, c);
    expect(lastVal(r, 0)).toBe(15); // 5 + (2 + 8)
    expect(lastVal(r, 1)).toBe(30); // 3 * 10
    expect(lastVal(r, 2)).toBeCloseTo(c[10].close, 6);
    expect(lastVal(r, 3)).toBeCloseTo(c[10].close, 6);
  });

  it('handles na UDT objects: na(), copy(na)==na, v6 short-circuit, and Standart error on na field access', () => {
    const r = runV6(`
type Item
    float price = 1.0

Item empty = na
Item c1 = empty.copy()
Item c2 = Item.copy(empty)
safe = not na(empty) and empty.price > 0
plot(na(empty) ? 1 : 0, title="isNa")
plot(na(c1) and na(c2) ? 1 : 0, title="copyNa")
plot(safe ? 1 : 0, title="shortCircuit")
`);
    expect(lastVal(r, 0)).toBe(1);
    expect(lastVal(r, 1)).toBe(1);
    expect(lastVal(r, 2)).toBe(0);

    // Reading field on na object throws Standart runtime error
    expectFail(
      `//@version=6\nindicator("t")\ntype Item\n    float price\nItem x = na\nplot(x.price)`,
      /Cannot access the 'price' field of an undefined object\. The object is na\./
    );

    // Writing field on na object throws Standart runtime error
    expectFail(
      `//@version=6\nindicator("t")\ntype Item\n    float price\nItem x = na\nx.price := 5.0\nplot(1)`,
      /Cannot access the 'price' field of an undefined object\. The object is na\./
    );

    // Using '=' instead of ':=' on field is rejected
    expectFail(
      `//@version=6\nindicator("t")\ntype Item\n    float price = 1.0\nx = Item.new()\nx.price = 2.0\nplot(1)`,
      /Cannot use '=' to modify field 'price'; use ':=' instead/
    );

    // Accessing unknown field is a compile error
    expectFail(
      `//@version=6\nindicator("t")\ntype Item\n    float price = 1.0\nx = Item.new()\nplot(x.nope)`,
      /The 'Item' type does not have a field named 'nope'/
    );
  });
});

// ============================================================================
// 2. `method`
// ============================================================================
describe('Faz 17 — method (UDT & built-in types, overloading, chaining)', () => {
  it('supports methods on UDTs with defaults, named args, chaining, and direct call form', () => {
    const r = runV6(`
type Point
    float x = 0.0
    float y = 0.0

method translate(Point this, float dx = 1.0, float dy = 2.0) =>
    this.x += dx
    this.y += dy
    this

method distSq(Point self) =>
    self.x * self.x + self.y * self.y

p = Point.new(1.0, 2.0)
p.translate(dx = 2.0).translate(dy = 1.0) // x: 1+2+1 = 4, y: 2+2+1 = 5 (wait: 2nd call dx default 1, dy=1 -> x=4, y=5)
d1 = p.distSq()
d2 = distSq(p)
plot(p.x, title="x")
plot(p.y, title="y")
plot(d1, title="d1")
plot(d2, title="d2")
`);
    expect(lastVal(r, 0)).toBe(4);
    expect(lastVal(r, 1)).toBe(5);
    expect(lastVal(r, 2)).toBe(41);
    expect(lastVal(r, 3)).toBe(41);
  });

  it('reproduces TitanScript overloaded methods on built-in types (int vs float, na receivers, arrays, strings, ta)', () => {
    const c = makeCandles(20);
    const r = runV6(`
method typeCode(int this) =>
    na(this) ? 10 : 1

method typeCode(float this) =>
    na(this) ? 20 : 2

method typeCode(string this) =>
    str.length(this)

method describe(array<int> this) =>
    this.sum() * 10

method describe(array<float> this) =>
    this.sum() * 100

method smoothed(float this, simple int len) =>
    ta.ema(this, len)

int iVal = 7
float fVal = 7.0
int iNa = na
float fNa = na

ai = array.from(1, 2, 3)
af = array.from(1.0, 2.0, 3.0)
parts = "a,b,c".split(",")

plot(iVal.typeCode(), title="i")
plot(fVal.typeCode(), title="f")
plot(iNa.typeCode(), title="iNa")
plot(fNa.typeCode(), title="fNa")
plot("hello".typeCode(), title="s")
plot(ai.describe(), title="ai")
plot(af.describe(), title="af")
plot(parts.size(), title="split")
plot(close.smoothed(5), title="emaClose")
plot(open.smoothed(5), title="emaOpen")
`, c);
    expect(lastVal(r, 0)).toBe(1);
    expect(lastVal(r, 1)).toBe(2);
    expect(lastVal(r, 2)).toBe(10);
    expect(lastVal(r, 3)).toBe(20);
    expect(lastVal(r, 4)).toBe(5);
    expect(lastVal(r, 5)).toBe(60);
    expect(lastVal(r, 6)).toBe(600);
    expect(lastVal(r, 7)).toBe(3);
    // Independent ta.ema states per call site
    expect(lastVal(r, 8)).not.toBeCloseTo(lastVal(r, 9), 4);
  });

  it('rejects invalid method definitions (missing param / missing type / duplicate overload)', () => {
    expectFail(
      `//@version=6\nindicator("t")\nmethod bad() => 1\nplot(1)`,
      /must have at least one parameter/
    );
    expectFail(
      `//@version=6\nindicator("t")\nmethod bad(this) => 1\nplot(1)`,
      /first parameter of method 'bad' must specify a type/
    );
    expectFail(
      `//@version=6\nindicator("t")\nmethod dup(int this) => this\nmethod dup(int self) => self + 1\nplot(1)`,
      /Method 'dup' is already defined for type 'int'/
    );
  });
});

// ============================================================================
// 3. `enum` & `input.enum`
// ============================================================================
describe('Faz 17 — enum & input.enum', () => {
  it('supports enum definitions, titles, str.tostring, switch, methods, input.enum & overrides', () => {
    const code = `//@version=6
indicator("enum demo")
enum MaType
    sma = "Simple MA"
    ema = "Exponential MA"
    wma

method factor(MaType this) =>
    switch this
        MaType.sma => 1
        MaType.ema => 2
        MaType.wma => 3

selected = input.enum(MaType.ema, title="MA Type", options=[MaType.sma, MaType.ema, MaType.wma])
len = switch selected
    MaType.sma => 5
    MaType.ema => 8
    MaType.wma => 10

// len has qualifier 'input int' so ta.ema accepts it!
val = ta.ema(close, len)
var t = table.new(position.top_right, 1, 2)
if barstate.islast
    table.cell(t, 0, 0, str.tostring(selected))
    table.cell(t, 0, 1, str.tostring(MaType.wma))

plot(selected.factor(), title="factor")
plot(selected == MaType.ema ? 1 : 0, title="isEma")
plot(val, title="val")
`;
    const c = makeCandles(20);
    const r = executeScript(code, c);
    expect(r.error).toBeUndefined();
    expect(r.inputs).toEqual([
      {
        title: 'MA Type',
        type: 'enum',
        defval: 'Exponential MA',
        options: ['Simple MA', 'Exponential MA', 'wma'],
      },
    ]);
    expect(lastVal(r, 0)).toBe(2);
    expect(lastVal(r, 1)).toBe(1);
    expect(r.drawings!.tables[0].cells.find((x) => x.row === 0)!.text).toBe('Exponential MA');
    expect(r.drawings!.tables[0].cells.find((x) => x.row === 1)!.text).toBe('wma');

    // Override input.enum by title
    const rOvTitle = executeScript(code, c, { inputOverrides: { 'MA Type': 'Simple MA' } });
    expect(rOvTitle.error).toBeUndefined();
    expect(lastVal(rOvTitle, 0)).toBe(1);
    expect(lastVal(rOvTitle, 1)).toBe(0);

    // Override input.enum by member name
    const rOvMember = executeScript(code, c, { inputOverrides: { 'MA Type': 'wma' } });
    expect(rOvMember.error).toBeUndefined();
    expect(lastVal(rOvMember, 0)).toBe(3);
  });

  it('rejects comparing different enum types, unknown enum fields, and bad input.enum', () => {
    expectFail(
      `//@version=6\nindicator("t")\nenum A\n    x\nenum B\n    y\nplot(A.x == B.y ? 1 : 0)`,
      /Cannot call 'operator =='/
    );
    expectFail(
      `//@version=6\nindicator("t")\nenum A\n    x\nplot(A.missing == A.x ? 1 : 0)`,
      /The 'A' enum does not have a field named 'missing'/
    );
    expectFail(
      `//@version=6\nindicator("t")\nenum A\n    x = 123\nplot(1)`,
      /title of an enum field must be a 'const string' literal/
    );
    expectFail(
      `//@version=6\nindicator("t")\nx = input.enum("not_enum", "Bad")\nplot(1)`,
      /Cannot call 'input\.enum' with argument 'defval'/
    );
    expectFail(
      `//@version=6\nindicator("t")\nenum A\n    x\nenum B\n    y\nv = input.enum(A.x, "M", options=[A.x, B.y])\nplot(1)`,
      /all 'options' elements must be of enum type 'A'/
    );
  });
});

// ============================================================================
// 4. `map.*` tamamı
// ============================================================================
describe('Faz 17 — map.* complete', () => {
  it('implements all 11 map.* functions with exact TitanScript insertion order and return values', () => {
    const r = runV6(`
m = map.new<string, int>()
prevNew = map.put(m, "a", 10)
map.put(m, "b", 20)
prevOld = m.put("a", 100) // overwrite preserves "a" first in insertion order, returns 10
map.put(m, "c", 30)

m2 = map.new<string, int>()
m2.put("b", 200)
m2.put("d", 40)
m.put_all(m2) // order: a(100), b(200), c(30), d(40)

copied = m.copy()
copied.put("e", 50)

removed = m.remove("c")
removedMissing = m.remove("zzz")

keysJoined = m.keys().join(",")
valsSum = m.values().sum()
hasA = m.contains("a")
hasC = m.contains("c")
gotB = m.get("b")
gotMiss = m.get("zzz")
szBefore = m.size()
m.clear()
szAfter = m.size()

map<string, int> naMap = na
naCopy = naMap.copy()

var tbl = table.new(position.top_right, 1, 2)
if barstate.islast
    table.cell(tbl, 0, 0, keysJoined)
    table.cell(tbl, 0, 1, str.tostring(copied))

plot(na(prevNew) ? 1 : 0, title="prevNewNa")
plot(prevOld, title="prevOld")
plot(removed, title="removed")
plot(na(removedMissing) ? 1 : 0, title="remMissNa")
plot(valsSum, title="valsSum")
plot(hasA and not hasC ? 1 : 0, title="contains")
plot(gotB, title="gotB")
plot(na(gotMiss) ? 1 : 0, title="gotMissNa")
plot(szBefore, title="szBefore")
plot(szAfter, title="szAfter")
plot(copied.size(), title="copiedSz")
plot(na(naCopy) ? 1 : 0, title="naCopy")
`);
    expect(lastVal(r, 0)).toBe(1);
    expect(lastVal(r, 1)).toBe(10);
    expect(lastVal(r, 2)).toBe(30);
    expect(lastVal(r, 3)).toBe(1);
    expect(lastVal(r, 4)).toBe(340); // 100 + 200 + 40
    expect(lastVal(r, 5)).toBe(1);
    expect(lastVal(r, 6)).toBe(200);
    expect(lastVal(r, 7)).toBe(1);
    expect(lastVal(r, 8)).toBe(3);
    expect(lastVal(r, 9)).toBe(0);
    expect(lastVal(r, 10)).toBe(5);
    expect(lastVal(r, 11)).toBe(1);
    expect(r.drawings!.tables[0].cells.find((x) => x.row === 0)!.text).toBe('a,b,d');
    expect(r.drawings!.tables[0].cells.find((x) => x.row === 1)!.text).toBe('{a: 100, b: 200, c: 30, d: 40, e: 50}');
  });

  it('supports enum keys and UDT values inside map<Enum, UDT>', () => {
    const r = runV6(`
enum Bucket
    lo
    hi

type Stat
    float sum = 0.0
    int count = 0

var stats = map.new<Bucket, Stat>()
if barstate.isfirst
    stats.put(Bucket.lo, Stat.new())
    stats.put(Bucket.hi, Stat.new())

key = close >= open ? Bucket.hi : Bucket.lo
st = stats.get(key)
st.sum += close
st.count += 1

plot(stats.get(Bucket.hi).count + stats.get(Bucket.lo).count, title="total")
`, makeCandles(15));
    expect(lastVal(r, 0)).toBe(15);
  });
});

// ============================================================================
// 5. `matrix.*` tamamı (TitanScript reference + linear algebra golden tests)
// ============================================================================
describe('Faz 17 — matrix.* complete', () => {
  it('supports creation, get/set, fill, row/col, add/remove, swap, reverse, reshape, concat, submatrix, sort', () => {
    const r = runV6(`
m = matrix.new<float>(2, 2, 0.0)
m.set(0, 0, 1.0)
m.set(0, 1, 2.0)
m.set(1, 0, 3.0)
m.set(1, 1, 4.0)

// copy & reverse (varsayılan: reverses both rows AND columns -> [[4,3],[2,1]])
rev = m.copy()
rev.reverse()

// add_row / add_col / remove_row / remove_col
m.add_row(2, array.from(5.0, 6.0)) // 3x2
m.add_col(2, array.from(7.0, 8.0, 9.0)) // 3x3
sub = m.submatrix(0, 2, 1, 3) // [[2, 7], [4, 8]]
rmRow = m.remove_row(2) // [5, 6, 9]
rmCol = m.remove_col(2) // [7, 8] -> back to 2x2 [[1,2],[3,4]]

// swap_rows & swap_columns
sw = m.copy()
sw.swap_rows(0, 1) // [[3,4],[1,2]]
sw.swap_columns(0, 1) // [[4,3],[2,1]]

// reshape & concat & fill
sh = m.copy()
sh.reshape(1, 4) // [[1,2,3,4]]
m2 = matrix.new<float>(1, 4, 10.0)
sh.concat(m2) // 2x4
sh.fill(99.0, 1, 2, 2, 4) // row 1 cols 2..3 = 99

// sort descending by column 1
so = matrix.new<float>(0, 0)
so.add_row(0, array.from(1.0, 50.0))
so.add_row(1, array.from(2.0, 10.0))
so.add_row(2, array.from(3.0, 90.0))
so.sort(1, order.descending)

// sort UDT matrix by sort_field
type Rec
    string name
    float score
um = matrix.new<Rec>(2, 1)
um.set(0, 0, Rec.new("b", 5.0))
um.set(1, 0, Rec.new("a", 20.0))
matrix.sort(um, column=0, order=order.descending, sort_field="score")

plot(rev.get(0, 0) * 10 + rev.get(1, 1), title="rev") // 4*10+1 = 41
plot(sub.get(0, 0) + sub.get(1, 1), title="sub") // 2 + 8 = 10
plot(rmRow.sum(), title="rmRow") // 20
plot(rmCol.sum(), title="rmCol") // 15
plot(sw.get(0, 0), title="sw") // 4
plot(sh.rows() * 10 + sh.columns(), title="shDim") // 24
plot(sh.elements_count(), title="shElems") // 8
plot(sh.get(1, 3), title="filled") // 99
plot(so.get(0, 0), title="sortedTopId") // 3
plot(um.get(0, 0).score, title="udtSorted") // 20
plot(m.row(1).sum(), title="rowSum") // 7
plot(m.col(1).sum(), title="colSum") // 6
`);
    expect(lastVal(r, 0)).toBe(41);
    expect(lastVal(r, 1)).toBe(10);
    expect(lastVal(r, 2)).toBe(20);
    expect(lastVal(r, 3)).toBe(15);
    expect(lastVal(r, 4)).toBe(4);
    expect(lastVal(r, 5)).toBe(24);
    expect(lastVal(r, 6)).toBe(8);
    expect(lastVal(r, 7)).toBe(99);
    expect(lastVal(r, 8)).toBe(3);
    expect(lastVal(r, 9)).toBe(20);
    expect(lastVal(r, 10)).toBe(7);
    expect(lastVal(r, 11)).toBe(6);
  });

  it('computes matrix statistics (min, max, avg, median, mode) and all 10 matrix.is_* predicates', () => {
    const r = runV6(`
// Stats: [1, 2, 2, 3, 3, 5] -> min=1, max=5, avg=16/6, median=2.5, mode=2 (tie broken by smallest)
st = matrix.new<float>(2, 3)
st.set(0, 0, 1), st.set(0, 1, 2), st.set(0, 2, 2)
st.set(1, 0, 3), st.set(1, 1, 3), st.set(1, 2, 5)

// Predicates
id2 = matrix.new<float>(2, 2, 0.0)
id2.set(0, 0, 1), id2.set(1, 1, 1)

anti = matrix.new<float>(2, 2, 0.0)
anti.set(0, 1, 5), anti.set(1, 0, -5)

antiDiag = matrix.new<float>(2, 2, 0.0)
antiDiag.set(0, 1, 3), antiDiag.set(1, 0, 7)

tri = matrix.new<float>(2, 2, 0.0)
tri.set(0, 0, 1), tri.set(0, 1, 2), tri.set(1, 1, 3)

stoch = matrix.new<float>(2, 2, 0.0)
stoch.set(0, 0, 0.3), stoch.set(0, 1, 0.7)
stoch.set(1, 0, 0.6), stoch.set(1, 1, 0.4)

z = matrix.new<float>(2, 2, 0.0)

plot(st.min(), title="min")
plot(st.max(), title="max")
plot(st.avg(), title="avg")
plot(st.median(), title="med")
plot(st.mode(), title="mode")
plot(id2.is_square() and not st.is_square() ? 1 : 0, title="square")
plot(id2.is_identity() and not tri.is_identity() ? 1 : 0, title="ident")
plot(id2.is_diagonal() and not tri.is_diagonal() ? 1 : 0, title="diag")
plot(antiDiag.is_antidiagonal() and not id2.is_antidiagonal() ? 1 : 0, title="antidiag")
plot(id2.is_symmetric() and not tri.is_symmetric() ? 1 : 0, title="sym")
plot(anti.is_antisymmetric() and not id2.is_antisymmetric() ? 1 : 0, title="antisym")
plot(tri.is_triangular() and not stoch.is_triangular() ? 1 : 0, title="tri")
plot(stoch.is_stochastic() and not tri.is_stochastic() ? 1 : 0, title="stoch")
plot(id2.is_binary() and not tri.is_binary() ? 1 : 0, title="bin")
plot(z.is_zero() and not id2.is_zero() ? 1 : 0, title="zero")
`);
    expect(lastVal(r, 0)).toBe(1);
    expect(lastVal(r, 1)).toBe(5);
    expect(lastVal(r, 2)).toBeCloseTo(16 / 6, 6);
    expect(lastVal(r, 3)).toBe(2.5);
    expect(lastVal(r, 4)).toBe(2);
    for (let i = 5; i <= 14; i++) expect(lastVal(r, i), `predicate #${i}`).toBe(1);
  });

  it('matches golden linear algebra values: sum, diff, mult, pow, transpose, trace, det, inv, pinv, rank, eigen, kron', () => {
    const r = runV6(`
A = matrix.new<float>(2, 2)
A.set(0, 0, 4), A.set(0, 1, 7)
A.set(1, 0, 2), A.set(1, 1, 6)
// det(A) = 24 - 14 = 10, trace(A) = 10, A^-1 = [[0.6, -0.7], [-0.2, 0.4]]

B = matrix.new<float>(2, 2)
B.set(0, 0, 1), B.set(0, 1, 2)
B.set(1, 0, 3), B.set(1, 1, 4)

sumAB = matrix.sum(A, B)       // [[5,9],[5,10]]
sumSc = matrix.sum(B, 10)      // [[11,12],[13,14]]
diffAB = matrix.diff(A, B)     // [[3,5],[-1,2]]
prodAB = matrix.mult(A, B)     // [[25,36],[20,28]]
vecRes = matrix.mult(A, array.from(1.0, 2.0)) // [18, 14]
scRes = matrix.mult(B, 3.0)    // [[3,6],[9,12]]

A2 = matrix.pow(A, 2)          // [[30, 70], [20, 50]]
A0 = matrix.pow(A, 0)          // I_2
Am1 = matrix.pow(A, -1)        // A^-1
AT = matrix.transpose(A)       // [[4,2],[7,6]]
Ainv = matrix.inv(A)
checkI = matrix.mult(A, Ainv)

// Rectangular + rank-deficient pinv (Moore-Penrose)
R = matrix.new<float>(2, 2)
R.set(0, 0, 1), R.set(0, 1, 2)
R.set(1, 0, 2), R.set(1, 1, 4) // rank = 1, R^+ = 1/25 * [[1,2],[2,4]]
Rp = matrix.pinv(R)
rec = matrix.mult(matrix.mult(R, Rp), R) // R * R^+ * R == R

// Rectangular 3x2 pinv
Rect = matrix.new<float>(3, 2)
Rect.set(0, 0, 1), Rect.set(0, 1, 0)
Rect.set(1, 0, 0), Rect.set(1, 1, 2)
Rect.set(2, 0, 0), Rect.set(2, 1, 0)
RectP = matrix.pinv(Rect) // [[1,0,0],[0,0.5,0]]

// Standart reference eigenvalues: [[2,4],[6,8]] -> 5 +/- sqrt(33)
E = matrix.new<float>(2, 2)
E.set(0, 0, 2), E.set(0, 1, 4)
E.set(1, 0, 6), E.set(1, 1, 8)
evals = E.eigenvalues()
evecs = E.eigenvectors()
// Verify E * v0 == lambda0 * v0
v0 = evecs.col(0)
Ev0 = matrix.mult(E, v0)
err0 = math.abs(Ev0.get(0) - evals.get(0) * v0.get(0)) + math.abs(Ev0.get(1) - evals.get(0) * v0.get(1))

// 3x3 non-symmetric triangular eigenvalues: diag = [2, 3, 4]
T3 = matrix.new<float>(3, 3, 0.0)
T3.set(0, 0, 2), T3.set(0, 1, 4), T3.set(0, 2, 6)
T3.set(1, 1, 3), T3.set(1, 2, 5)
T3.set(2, 2, 4)
t3Vals = T3.eigenvalues()

// Symmetric 3x3 eigenvalues: [[2,1,0],[1,2,1],[0,1,2]] -> 2+sqrt(2), 2, 2-sqrt(2)
S3 = matrix.new<float>(3, 3, 0.0)
S3.set(0, 0, 2), S3.set(0, 1, 1)
S3.set(1, 0, 1), S3.set(1, 1, 2), S3.set(1, 2, 1)
S3.set(2, 1, 1), S3.set(2, 2, 2)
s3Vals = S3.eigenvalues()

// Kronecker product: [[1,2],[3,4]] kron [[0,5],[6,7]] -> 4x4
K2 = matrix.new<float>(2, 2)
K2.set(0, 0, 0), K2.set(0, 1, 5)
K2.set(1, 0, 6), K2.set(1, 1, 7)
K = matrix.kron(B, K2)

plot(A.det(), title="det")
plot(A.trace(), title="trace")
plot(checkI.get(0, 0) + checkI.get(1, 1) - math.abs(checkI.get(0, 1)), title="invCheck")
plot(sumAB.get(1, 1) + sumSc.get(0, 0) + diffAB.get(0, 0), title="sumDiff") // 10+11+3 = 24
plot(prodAB.get(0, 0), title="prod") // 25
plot(vecRes.get(0) + vecRes.get(1), title="matVec") // 32
plot(scRes.get(1, 1), title="matSc") // 12
plot(A2.get(0, 1), title="pow2") // 70
plot(A0.is_identity() ? 1 : 0, title="pow0") // 1
plot(Am1.get(0, 0), title="powNeg1") // 0.6
plot(AT.get(0, 1), title="trans") // 2
plot(R.rank(), title="rank") // 1
plot(rec.get(1, 1), title="pinvRecon") // 4
plot(RectP.get(1, 1), title="rectPinv") // 0.5
plot(evals.get(0), title="eig0") // 5 + sqrt(33)
plot(evals.get(1), title="eig1") // 5 - sqrt(33)
plot(err0, title="eigVecErr") // ~0
plot(t3Vals.sum(), title="t3EigSum") // 9
plot(s3Vals.get(0), title="s3Eig0") // 2 + sqrt(2)
plot(K.get(3, 3), title="kron33") // 4*7 = 28
plot(K.get(2, 1), title="kron21") // 3*5 = 15
`);
    expect(lastVal(r, 0)).toBeCloseTo(10, 6);
    expect(lastVal(r, 1)).toBeCloseTo(10, 6);
    expect(lastVal(r, 2)).toBeCloseTo(2, 6);
    expect(lastVal(r, 3)).toBeCloseTo(24, 6);
    expect(lastVal(r, 4)).toBeCloseTo(25, 6);
    expect(lastVal(r, 5)).toBeCloseTo(32, 6);
    expect(lastVal(r, 6)).toBeCloseTo(12, 6);
    expect(lastVal(r, 7)).toBeCloseTo(70, 6);
    expect(lastVal(r, 8)).toBe(1);
    expect(lastVal(r, 9)).toBeCloseTo(0.6, 6);
    expect(lastVal(r, 10)).toBe(2);
    expect(lastVal(r, 11)).toBe(1);
    expect(lastVal(r, 12)).toBeCloseTo(4, 6);
    expect(lastVal(r, 13)).toBeCloseTo(0.5, 6);
    expect(lastVal(r, 14)).toBeCloseTo(5 + Math.sqrt(33), 6);
    expect(lastVal(r, 15)).toBeCloseTo(5 - Math.sqrt(33), 6);
    expect(lastVal(r, 16)).toBeLessThan(1e-8);
    expect(lastVal(r, 17)).toBeCloseTo(9, 5);
    expect(lastVal(r, 18)).toBeCloseTo(2 + Math.SQRT2, 6);
    expect(lastVal(r, 19)).toBe(28);
    expect(lastVal(r, 20)).toBe(15);

    // Singular matrix.inv() throws runtime error
    expectFail(
      `//@version=6\nindicator("t")\nm = matrix.new<float>(2, 2, 1.0)\ninv = m.inv()\nplot(1)`,
      /tekil|singular/i
    );
  });
});

// ============================================================================
// 6. `while` & `for...in`
// ============================================================================
describe('Faz 17 — while & for...in (array / matrix / map)', () => {
  it('supports while expression return values (0 iters -> na, normal, break, continue)', () => {
    const r = runV6(`
int i = 0
wRes = while i < 5
    i += 1
    if i == 3
        continue
    i * 10

int j = 0
wBreak = while j < 10
    j += 1
    if j == 4
        break
    j * 100

wZero = while false
    42

plot(wRes, title="wRes")
plot(wBreak, title="wBreak")
plot(na(wZero) ? 1 : 0, title="wZeroNa")
`);
    expect(lastVal(r, 0)).toBe(50);
    expect(lastVal(r, 1)).toBe(300);
    expect(lastVal(r, 2)).toBe(1);
  });

  it('supports for...in over array, matrix (row & [i, row]), and map ([k, v]) + expression values', () => {
    const r = runV6(`
// 1. Array: both forms
arr = array.from(10.0, 20.0, 30.0)
float arrSum = 0.0
for [idx, val] in arr
    arrSum += (idx + 1) * val // 1*10 + 2*20 + 3*30 = 140

// 2. Matrix: Standart reference rowWiseAvg + [rIdx, row]
method rowWiseAvg(matrix<float> m) =>
    res = array.new<float>()
    for row in m
        res.push(row.avg())
    res

mat = matrix.new<float>(0, 0)
mat.add_row(0, array.from(2.0, 4.0))
mat.add_row(1, array.from(10.0, 20.0))
avgs = mat.rowWiseAvg() // [3.0, 15.0]

float weightedRowSum = 0.0
for [rIdx, row] in mat
    weightedRowSum += (rIdx + 1) * row.sum() // 1*6 + 2*30 = 66

// 3. Map: [k, v] in insertion order + expression return value
mp = map.new<string, float>()
mp.put("a", 1.0)
mp.put("b", 2.0)
mp.put("c", 4.0)
float mapAcc = 0.0
lastKeyLen = for [k, v] in mp
    mapAcc += v
    str.length(k)

plot(arrSum, title="arrSum")
plot(avgs.get(0) + avgs.get(1), title="rowAvgs")
plot(weightedRowSum, title="wRowSum")
plot(mapAcc, title="mapAcc")
plot(lastKeyLen, title="lastKeyLen")
`);
    expect(lastVal(r, 0)).toBe(140);
    expect(lastVal(r, 1)).toBe(18);
    expect(lastVal(r, 2)).toBe(66);
    expect(lastVal(r, 3)).toBe(7);
    expect(lastVal(r, 4)).toBe(1);

    // Compile error: single variable with map in for...in
    expectFail(
      `//@version=6\nindicator("t")\nm = map.new<string, int>()\nfor x in m\n    plot(1)\nplot(1)`,
      /Cannot use a single loop variable with a 'map' in a 'for\.\.\.in' loop/
    );

    // Compile error: iterating over a scalar
    expectFail(
      `//@version=6\nindicator("t")\nx = 5\nfor v in x\n    plot(v)\nplot(1)`,
      /Cannot iterate over an expression of type 'const int'/
    );
  });
});

// ============================================================================
// 7. `varip`
// ============================================================================
describe('Faz 17 — varip intrabar persistence vs var rollback', () => {
  it('rolls back var (scalars, arrays, UDTs) across realtime ticks while varip persists', () => {
    const c = makeCandles(5);
    const r = runV6(
      `
type Counter
    int hits = 0

var int vScalar = 0
varip int vpScalar = 0
vScalar += 1
vpScalar += 1

var array<float> vArr = array.new<float>()
varip array<float> vpArr = array.new<float>()
vArr.push(close)
vpArr.push(close)

var Counter vObj = Counter.new(0)
varip Counter vpObj = Counter.new(0)
vObj.hits += 1
vpObj.hits += 1

varip int rtTicks = 0
if barstate.isrealtime
    rtTicks += 1

plot(vScalar, title="vScalar")
plot(vpScalar, title="vpScalar")
plot(vArr.size(), title="vArrSz")
plot(vpArr.size(), title="vpArrSz")
plot(vObj.hits, title="vObjHits")
plot(vpObj.hits, title="vpObjHits")
plot(rtTicks, title="rtTicks")
`,
      c,
      {
        intrabarUpdates: [
          { close: 101 },
          { close: 102 },
          { close: 103 },
          { close: 104 },
        ],
      }
    );
    // 4 historical bars (0..3) + 1 realtime bar (4) with 4 intrabar ticks:
    // var rolls back to bar 3's confirmed value (4) on every tick -> final value = 5
    // varip never rolls back -> 4 historical + 4 intrabar ticks = 8!
    expect(lastVal(r, 0)).toBe(5);
    expect(lastVal(r, 1)).toBe(8);
    expect(lastVal(r, 2)).toBe(5);
    expect(lastVal(r, 3)).toBe(8);
    expect(lastVal(r, 4)).toBe(5);
    expect(lastVal(r, 5)).toBe(8);
    expect(lastVal(r, 6)).toBe(4);
  });

  it('rejects varip in disallowed contexts (function, loop, drawing type, const)', () => {
    expectFail(
      `//@version=6\nindicator("t")\nf() =>\n    varip int x = 0\n    x\nplot(f())`,
      /Cannot use 'varip' inside a function or method/
    );
    expectFail(
      `//@version=6\nindicator("t")\nfor i = 0 to 3\n    varip int x = 0\nplot(1)`,
      /Cannot use 'varip' inside a loop/
    );
    expectFail(
      `//@version=6\nindicator("t")\nvarip line l = na\nplot(1)`,
      /Cannot use 'varip' with the 'line' type/
    );
    expectFail(
      `//@version=6\nindicator("t")\nvarip const int x = 1\nplot(x)`,
      /Cannot use the 'const' qualifier with 'varip'/
    );
  });
});

// ============================================================================
// 8. Type qualifiers (const / input / simple / series) & Standart compile errors
// ============================================================================
describe('Faz 17 — qualifiers (const/input/simple/series) & Standart compile errors', () => {
  it('accepts valid qualifier hierarchy const < input < simple < series', () => {
    const r = runV6(`
const string TITLE = "Const " + "Plot"
const int BASE = 4
input int IN_LEN = input.int(6, "Len")
simple int SIMP_LEN = BASE + IN_LEN
series float s = ta.ema(close, SIMP_LEN)

myEma(series float src, simple int len) =>
    ta.ema(src, len)

hline(50.0, "Mid", color=color.new(color.gray, 50))
plot(myEma(s, IN_LEN), title=TITLE)
`, makeCandles(30));
    expect(r.plots[0].title).toBe('Const Plot');
    expect(r.plots[0].data.length).toBeGreaterThan(0);
  });

  it('produces clear compile errors for qualifier and type violations', () => {
    // 1. ta.ema with series int length
    expectFail(
      `//@version=6\nindicator("t")\nlen = bar_index > 5 ? 10 : 20\nplot(ta.ema(close, len))`,
      /Cannot call 'ta\.ema' with argument 'length'='len'\. An argument of 'series int' type was used but a 'simple int' is expected\./
    );

    // 2. var promoted to series int via conditional reassignment -> rejected by ta.rsi
    expectFail(
      `//@version=6\nindicator("t")\nvar int len = 10\nif close > open\n    len := 14\nplot(ta.rsi(close, len))`,
      /Cannot call 'ta\.rsi' with argument 'length'='len'\. An argument of 'series int' type was used but a 'simple int' is expected\./
    );

    // 3. indicator title must be const string
    expectFail(
      `//@version=6\nindicator(str.tostring(close))\nplot(close)`,
      /Cannot call 'indicator' with argument 'title'=.*An argument of 'series string' type was used but a 'const string' is expected\./
    );

    // 4. plot title must be const string
    expectFail(
      `//@version=6\nindicator("t")\nplot(close, title=str.tostring(bar_index))`,
      /Cannot call 'plot' with argument 'title'=.*An argument of 'series string' type was used but a 'const string' is expected\./
    );

    // 5. hline price must be input float
    expectFail(
      `//@version=6\nindicator("t")\nhline(close)`,
      /Cannot call 'hline' with argument 'price'='close'\. An argument of 'series float' type was used but a 'input float' is expected\./
    );

    // 6. input.int defval must be const int
    expectFail(
      `//@version=6\nindicator("t")\nx = input.int(bar_index, "Bad")\nplot(x)`,
      /Cannot call 'input\.int' with argument 'defval'='bar_index'\. An argument of 'series int' type was used but a 'const int' is expected\./
    );

    // 7. Explicit const / input / simple variable qualifier violations & reassignment
    expectFail(
      `//@version=6\nindicator("t")\nconst int x = bar_index\nplot(x)`,
      /Cannot assign 'series int' to a variable of type 'const int'/
    );
    expectFail(
      `//@version=6\nindicator("t")\nconst int x = 5\nx := 6\nplot(x)`,
      /Cannot reassign a 'const' variable 'x'/
    );
    expectFail(
      `//@version=6\nindicator("t")\ninput int x = input.int(5)\nx := 6\nplot(x)`,
      /Cannot reassign a 'input' variable 'x'/
    );
    expectFail(
      `//@version=6\nindicator("t")\nsimple int x = bar_index\nplot(x)`,
      /Cannot assign 'series int' to a variable of type 'simple int'/
    );

    // 8. User-defined function/method parameter qualifier check
    expectFail(
      `//@version=6\nindicator("t")\nmyFn(simple int n) => ta.ema(close, n)\nplot(myFn(bar_index))`,
      /Cannot call 'myFn' with argument 'n'='bar_index'\. An argument of 'series int' type was used but a 'simple int' is expected\./
    );

    // 9. Type mismatch & v6 bool != na
    expectFail(
      `//@version=6\nindicator("t")\nint x = "hello"\nplot(x)`,
      /Cannot assign 'const string' to a variable of type 'const int'/
    );
    expectFail(
      `//@version=6\nindicator("t")\nbool b = na\nplot(b ? 1 : 0)`,
      /Cannot assign 'na' to a variable of type 'const bool'/
    );

    // Verify error class exported cleanly
    expect(new ScriptCompileError(1, 'msg').name).toBe('ScriptCompileError');
  });
});

// ============================================================================
// 9. Faz 16 preservation: TitanScript runs on derived chart bars (Renko/Kagi/P&F)
// ============================================================================
describe('Faz 17 + Faz 16 — TitanScript on derived chart types (Renko, Kagi, P&F)', () => {
  const script = `//@version=6
indicator("Derived v6", overlay=true)
enum Dir
    up = "Up"
    dn = "Down"

type BrickState
    Dir dir = Dir.up
    int streak = 0

var BrickState st = BrickState.new()
var counts = map.new<Dir, int>()
if barstate.isfirst
    counts.put(Dir.up, 0)
    counts.put(Dir.dn, 0)

curDir = close >= open ? Dir.up : Dir.dn
if curDir == st.dir
    st.streak += 1
else
    st.dir := curDir
    st.streak := 1
counts.put(curDir, counts.get(curDir) + 1)

plot(st.streak, title="streak")
plot(counts.get(Dir.up) + counts.get(Dir.dn), title="seen")
`;

  it('executes TitanScript UDT/enum/map script on derived Renko, Kagi, and P&F bars', () => {
    const raw = makeCandles(120, 100);
    for (const style of ['renko', 'kagi', 'pnf'] as const) {
      const derived = deriveCandles(style, raw, {
        ...DEFAULT_STYLE_PARAMS,
        renko: { mode: 'fixed', atrLen: 14, box: 1.5 },
        kagi: { mode: 'fixed', atrLen: 14, value: 1.5 },
        pnf: { mode: 'fixed', atrLen: 14, box: 1.0, reversal: 2, source: 'close' },
      });
      expect(derived.length, `${style} should produce derived bars`).toBeGreaterThan(2);
      const res = executeScript(script, derived);
      expect(res.error, `${style}: ${res.error}`).toBeUndefined();
      // TitanScript saw EVERY derived bar (not raw bars) and aligned plot timestamps to derived bars
      expect(lastVal(res, 1)).toBe(derived.length);
      expect(plotVals(res, 0).length).toBe(derived.length);
      expect(res.plots[0].data[res.plots[0].data.length - 1].time).toBe(derived[derived.length - 1].time);
    }
  });
});

// ============================================================================
// 10. Corner cases & runtime/compile diagnostics
// ============================================================================
describe('Faz 17 — corner cases & error diagnostics', () => {
  it('covers wide pinv, empty/1x1/rotation matrices, add_col on 0x0, named collection args, and drawing methods', () => {
    const r = runV6(`
// Wide 2x3 matrix pinv: A * A^+ * A == A
W = matrix.new<float>(2, 3)
W.set(0, 0, 1), W.set(0, 1, 0), W.set(0, 2, 1)
W.set(1, 0, 0), W.set(1, 1, 2), W.set(1, 2, 0)
Wp = W.pinv()
Wrec = W.mult(Wp).mult(W)

// 0x0 matrix add_col + default add_row/add_col + remove_row/col to empty
M0 = matrix.new<float>(0, 0)
M0.add_col(0, array.from(10.0, 20.0)) // 2x1
M0.add_col() // 2x2 with na
M0.add_row() // 3x2 with na
M0.remove_row() // 2x2
M0.remove_col() // 2x1
M0.remove_col() // 0x0

// 1x1 eigen + 2x2 rotation matrix (complex eigenvalues -> na)
M1 = matrix.new<float>(1, 1, 7.0)
e1 = M1.eigenvalues()
Rot = matrix.new<float>(2, 2, 0.0)
Rot.set(0, 1, -1), Rot.set(1, 0, 1)
eRot = Rot.eigenvalues()

// Empty matrix stats & copy(na)
E0 = matrix.new<float>(0, 0)
matrix<float> naMat = na
cNa = naMat.copy()

// Named args on map & matrix
mp = map.new<string, int>()
map.put(id=mp, key="k", value=42)
gotK = map.get(id=mp, key="k")

// Method on drawing handle + UDT tostring + label method syntax
type Tag
    string name = "ok"
method isOk(bool this) => this ? 1 : 0
if barstate.islast
    lbl = label.new(bar_index, high, str.tostring(Tag.new()))
    lbl.set_text(str.tostring(M1))

plot(Wrec.get(0, 2), title="widePinv")
plot(M0.elements_count(), title="m0Empty")
plot(e1.get(0), title="eig1x1")
plot(na(eRot.get(0)) ? 1 : 0, title="rotComplex")
plot(na(E0.min()) and na(E0.median()) and na(E0.mode()) and na(cNa) ? 1 : 0, title="emptyStats")
plot(gotK, title="namedMap")
plot(true.isOk(), title="boolMethod")
`);
    expect(lastVal(r, 0)).toBeCloseTo(1, 6);
    expect(lastVal(r, 1)).toBe(0);
    expect(lastVal(r, 2)).toBeCloseTo(7, 6);
    expect(lastVal(r, 3)).toBe(1);
    expect(lastVal(r, 4)).toBe(1);
    expect(lastVal(r, 5)).toBe(42);
    expect(lastVal(r, 6)).toBe(1);
    expect(r.drawings!.labels[0].text).toBe('[7]');
  });

  it('reports clear errors on matrix bounds/dimensions, duplicate UDT/enum, and simple reassignment', () => {
    expectFail(
      `//@version=6\nindicator("t")\nm = matrix.new<float>(2, 2, 0.0)\nplot(m.get(5, 0))`,
      /satır indeksi 5 sınır dışı/
    );
    expectFail(
      `//@version=6\nindicator("t")\nm = matrix.new<float>(2, 3, 0.0)\nplot(m.det())`,
      /kare ve boş olmayan/
    );
    expectFail(
      `//@version=6\nindicator("t")\nm = matrix.new<float>(2, 2, 1.0)\nm.reshape(3, 3)\nplot(1)`,
      /dönüştürülemez/
    );
    expectFail(
      `//@version=6\nindicator("t")\nm1 = matrix.new<float>(2, 2, 1.0)\nm2 = matrix.new<float>(3, 3, 1.0)\nplot(m1.mult(m2).rows())`,
      /uyumsuz boyutlar/
    );
    expectFail(
      `//@version=6\nindicator("t")\ntype T\n    int a\ntype T\n    int b\nplot(1)`,
      /already declared/
    );
    expectFail(
      `//@version=6\nindicator("t")\nenum E\n    a\n    a\nplot(1)`,
      /Duplicate field 'a' in enum 'E'/
    );
    expectFail(
      `//@version=6\nindicator("t")\nsimple int s = 5\nif close > open\n    s := 6\nplot(s)`,
      /Cannot assign 'series int' to variable 's' of type 'simple int'/
    );
    expectFail(
      `//@version=6\nindicator("t")\narray<float> a = na\nfor x in a\n    plot(x)\nplot(1)`,
      /Cannot iterate over an 'na' collection/
    );
  });
});

