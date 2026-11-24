/**
 * Incremental (bar-by-bar) technical analysis. Every `ta.*` call-site owns one Stepper;
 * the VM feeds it the current bar's argument values and reads one result per bar.
 * Semantics follow TitanScript (SMA-seeded ema/rma, na propagation, na warm-up).
 */
import { ScriptArray, toNum } from './values';
import { parseTimeframeSeconds } from './lib';
import { getWasmCore, type WasmKind } from './wasmCore';

export interface BarCtx {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** milliseconds, like TitanScript `time` */
  time: number;
  index: number;
}

export interface TaEnv {
  bar(): BarCtx;
}

export type Stepper = (...args: any[]) => any;

const NA = NaN;
const isN = Number.isNaN;

/** Fixed window of the last `len` values (oldest first). */
class Win {
  buf: number[] = [];
  constructor(public len: number) {}
  push(v: number): void {
    this.buf.push(v);
    if (this.buf.length > this.len) this.buf.shift();
  }
  get full(): boolean {
    return this.buf.length >= this.len;
  }
  /** value `k` bars ago (0 = current) */
  at(k: number): number {
    const i = this.buf.length - 1 - k;
    return i >= 0 ? this.buf[i] : NA;
  }
}

function tsSma(): (v: number, len: number) => number {
  let w: Win | null = null;
  let sum = 0;
  let nas = 0;
  return (v, len) => {
    if (!w || w.len !== len) {
      w = new Win(len);
      sum = 0;
      nas = 0;
    }
    if (w.full) {
      const old = w.buf[0];
      if (isN(old)) nas--;
      else sum -= old;
    }
    w.push(v);
    if (isN(v)) nas++;
    else sum += v;
    if (!w.full || nas > 0) return NA;
    return sum / len;
  };
}

function tsEma(): (v: number, len: number) => number {
  const seed = sma();
  let prev = NA;
  return (v, len) => {
    const s = seed(v, len);
    const alpha = 2 / (len + 1);
    if (isN(prev)) prev = s;
    else prev = isN(v) ? NA : alpha * v + (1 - alpha) * prev;
    return prev;
  };
}

function tsRma(): (v: number, len: number) => number {
  const seed = sma();
  let prev = NA;
  return (v, len) => {
    const s = seed(v, len);
    const alpha = 1 / len;
    if (isN(prev)) prev = s;
    else prev = isN(v) ? NA : alpha * v + (1 - alpha) * prev;
    return prev;
  };
}

function tsWma(): (v: number, len: number) => number {
  let w: Win | null = null;
  return (v, len) => {
    if (!w || w.len !== len) w = new Win(len);
    w.push(v);
    if (!w.full) return NA;
    let s = 0;
    for (let j = 0; j < len; j++) {
      const x = w.buf[len - 1 - j];
      if (isN(x)) return NA;
      s += x * (len - j);
    }
    return s / ((len * (len + 1)) / 2);
  };
}

function trueRange(env: TaEnv): () => number {
  let prevClose = NA;
  return () => {
    const b = env.bar();
    const tr = isN(prevClose)
      ? b.high - b.low
      : Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
    prevClose = b.close;
    return tr;
  };
}

function tsHighest(): (v: number, len: number) => number {
  // TitanScript: partial windows during warm-up (no leading gap); na values are skipped
  let w: Win | null = null;
  return (v, len) => {
    if (!w || w.len !== len) w = new Win(len);
    w.push(v);
    let m = -Infinity;
    let any = false;
    for (const x of w.buf) {
      if (isN(x)) continue;
      any = true;
      if (x > m) m = x;
    }
    return any ? m : NA;
  };
}

function tsLowest(): (v: number, len: number) => number {
  // TitanScript: partial windows during warm-up (no leading gap); na values are skipped
  let w: Win | null = null;
  return (v, len) => {
    if (!w || w.len !== len) w = new Win(len);
    w.push(v);
    let m = Infinity;
    let any = false;
    for (const x of w.buf) {
      if (isN(x)) continue;
      any = true;
      if (x < m) m = x;
    }
    return any ? m : NA;
  };
}

function tsStdev(): (v: number, len: number, biased?: boolean) => number {
  let w: Win | null = null;
  return (v, len, biased = true) => {
    if (!w || w.len !== len) w = new Win(len);
    w.push(v);
    if (!w.full) return NA;
    let sum = 0;
    for (const x of w.buf) {
      if (isN(x)) return NA;
      sum += x;
    }
    const mean = sum / len;
    let sq = 0;
    for (const x of w.buf) sq += (x - mean) * (x - mean);
    return Math.sqrt(sq / (biased === false ? Math.max(1, len - 1) : len));
  };
}

/**
 * Faz 24: sıcak adımlayıcılar — Rust/WASM çekirdeği varsa onunla, yoksa TS ile (anlamları birebir aynı).
 * Geçersiz uzunluk (tam sayı < 1 / sonlu değil) TS adımlayıcıya düşer.
 */
function hot<S extends (...a: any[]) => number>(kind: WasmKind, ts: () => S): S {
  const wasm = getWasmCore();
  if (!wasm) return ts();
  const step = wasm.make(kind);
  let fb: S | null = null;
  return ((v: number, len: number, extra?: boolean | number) => {
    if (!(len >= 1) || !Number.isFinite(len)) {
      fb ??= ts();
      return fb(v, len, extra);
    }
    return step(v, len, extra);
  }) as unknown as S;
}
const sma = (): ((v: number, len: number) => number) => hot('sma', tsSma);
const ema = (): ((v: number, len: number) => number) => hot('ema', tsEma);
const rma = (): ((v: number, len: number) => number) => hot('rma', tsRma);
const wma = (): ((v: number, len: number) => number) => hot('wma', tsWma);
const highest = (): ((v: number, len: number) => number) => hot('highest', tsHighest);
const lowest = (): ((v: number, len: number) => number) => hot('lowest', tsLowest);
const stdev = (): ((v: number, len: number, biased?: boolean) => number) => hot('stdev', tsStdev);
const dev = (): ((v: number, len: number) => number) => hot('dev', tsDev);
const cci = (): ((v: number, len: number) => number) => hot('cci', tsCci);

function tsDev(): (src: number, len: number) => number {
  const m = tsSma();
  let w: Win | null = null;
  return (src: number, len: number) => {
    if (!w || w.len !== len) w = new Win(len);
    w.push(src);
    const mean = m(src, len);
    if (isN(mean)) return NA;
    let s = 0;
    for (const x of w.buf) s += Math.abs(x - mean);
    return s / len;
  };
}

function tsCci(): (src: number, len: number) => number {
  const m = tsSma();
  let w: Win | null = null;
  return (src: number, len: number) => {
    if (!w || w.len !== len) w = new Win(len);
    w.push(src);
    const mean = m(src, len);
    if (isN(mean)) return NA;
    let d = 0;
    for (const x of w.buf) d += Math.abs(x - mean);
    d /= len;
    return d === 0 ? 0 : (src - mean) / (0.015 * d);
  };
}

function change(): (v: number, len?: number) => number {
  let w: Win | null = null;
  return (v, len = 1) => {
    if (!w || w.len !== len + 1) w = new Win(len + 1);
    w.push(v);
    return w.full ? v - w.buf[0] : NA;
  };
}

function crossStep(mode: 'over' | 'under' | 'any'): (a: number, b: number) => boolean {
  let pa = NA;
  let pb = NA;
  return (a, b) => {
    let res = false;
    if (!isN(pa) && !isN(pb) && !isN(a) && !isN(b)) {
      const over = a > b && pa <= pb;
      const under = a < b && pa >= pb;
      res = mode === 'over' ? over : mode === 'under' ? under : over || under;
    }
    pa = a;
    pb = b;
    return res;
  };
}

function fixnan(): (v: number) => number {
  let last = NA;
  return (v) => {
    if (!isN(v)) last = v;
    return isN(v) ? last : v;
  };
}

function tsLinreg(): (v: number, len: number, offset?: number) => number {
  let w: Win | null = null;
  return (v, len, offset = 0) => {
    if (!w || w.len !== len) w = new Win(len);
    w.push(v);
    if (!w.full) return NA;
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < len; i++) {
      const y = w.buf[i];
      if (isN(y)) return NA;
      sx += i;
      sy += y;
      sxy += i * y;
      sxx += i * i;
    }
    const denom = len * sxx - sx * sx;
    const slope = denom === 0 ? 0 : (len * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / len;
    return intercept + slope * (len - 1 - offset);
  };
}
const linreg = (): ((v: number, len: number, offset?: number) => number) => hot('linreg', tsLinreg);

function pivot(kind: 'high' | 'low', env: TaEnv): (...a: any[]) => number {
  let w: Win | null = null;
  return (...args: any[]) => {
    let src: number;
    let left: number;
    let right: number;
    if (args.length >= 3) {
      src = args[0];
      left = args[1];
      right = args[2];
    } else {
      const b = env.bar();
      src = kind === 'high' ? b.high : b.low;
      left = args[0];
      right = args[1];
    }
    const size = left + right + 1;
    if (!w || w.len !== size) w = new Win(size);
    w.push(src);
    if (!w.full) return NA;
    const center = w.buf[left];
    if (isN(center)) return NA;
    for (let i = 0; i < size; i++) {
      if (i === left) continue;
      const x = w.buf[i];
      if (isN(x)) return NA;
      if (kind === 'high') {
        if (i < left ? x >= center : x > center) return NA;
      } else if (i < left ? x <= center : x < center) return NA;
    }
    return center;
  };
}

export const TA_SIGS: Record<string, string[]> = {
  sma: ['source', 'length'],
  ema: ['source', 'length'],
  rma: ['source', 'length'],
  wma: ['source', 'length'],
  vwma: ['source', 'length'],
  hma: ['source', 'length'],
  swma: ['source'],
  alma: ['series', 'length', 'offset', 'sigma', 'floor'],
  rsi: ['source', 'length'],
  atr: ['length'],
  tr: ['handle_na'],
  stdev: ['source', 'length', 'biased'],
  variance: ['source', 'length', 'biased'],
  dev: ['source', 'length'],
  highest: ['source', 'length'],
  lowest: ['source', 'length'],
  highestbars: ['source', 'length'],
  lowestbars: ['source', 'length'],
  range: ['source', 'length'],
  median: ['source', 'length'],
  mode: ['source', 'length'],
  max: ['source'],
  min: ['source'],
  crossover: ['source1', 'source2'],
  crossunder: ['source1', 'source2'],
  cross: ['source1', 'source2'],
  change: ['source', 'length'],
  mom: ['source', 'length'],
  roc: ['source', 'length'],
  cum: ['source'],
  sum: ['source', 'length'],
  barssince: ['condition'],
  valuewhen: ['condition', 'source', 'occurrence'],
  pivothigh: ['source', 'leftbars', 'rightbars'],
  pivotlow: ['source', 'leftbars', 'rightbars'],
  pivot_point_levels: ['type', 'anchor', 'developing'],
  macd: ['source', 'fastlen', 'slowlen', 'siglen'],
  bb: ['series', 'length', 'mult'],
  bbw: ['series', 'length', 'mult'],
  stoch: ['source', 'high', 'low', 'length'],
  supertrend: ['factor', 'atrPeriod'],
  vwap: ['source'],
  mfi: ['series', 'length'],
  linreg: ['source', 'length', 'offset'],
  dmi: ['diLength', 'adxSmoothing'],
  cci: ['source', 'length'],
  rising: ['source', 'length'],
  falling: ['source', 'length'],
  fixnan: ['source'],
  kc: ['series', 'length', 'mult', 'useTrueRange'],
  kcw: ['series', 'length', 'mult', 'useTrueRange'],
  wpr: ['length'],
  tsi: ['source', 'short_length', 'long_length'],
  sar: ['start', 'inc', 'max'],
  cog: ['source', 'length'],
  percentrank: ['source', 'length'],
  percentile_linear_interpolation: ['source', 'length', 'percentage'],
  percentile_nearest_rank: ['source', 'length', 'percentage'],
  correlation: ['source1', 'source2', 'length'],
  rci: ['source', 'length'],
  obv: [],
  pvt: [],
  accdist: [],
  iii: [],
  nvi: [],
  pvi: [],
  wad: [],
  wvad: [],
  cmo: ['source', 'length'],
};

/** Functions whose omitted first arg means a built-in series. */
export const TA_DEFAULT_SRC: Record<string, string> = {
  vwap: 'hlc3',
};

export const TA_FACTORIES: Record<string, (env: TaEnv) => Stepper> = {
  sma: () => sma(),
  ema: () => ema(),
  rma: () => rma(),
  wma: () => wma(),
  vwma: (env) => {
    const a = sma();
    const b = sma();
    return (src: number, len: number) => {
      const v = env.bar().volume;
      return a(src * v, len) / b(v, len);
    };
  },
  hma: () => {
    const w1 = wma();
    const w2 = wma();
    const w3 = wma();
    return (src: number, len: number) => {
      const half = Math.max(1, Math.floor(len / 2));
      const sq = Math.max(1, Math.round(Math.sqrt(len)));
      return w3(2 * w1(src, half) - w2(src, len), sq);
    };
  },
  swma: () => {
    const w = new Win(4);
    return (src: number) => {
      w.push(src);
      if (!w.full) return NA;
      const [d, c, b, a] = w.buf; // a = newest
      return (d * 1 + c * 2 + b * 2 + a * 1) / 6;
    };
  },
  rsi: () => {
    const ch = change();
    const up = rma();
    const dn = rma();
    return (src: number, len: number) => {
      const c = ch(src, 1);
      const u = up(isN(c) ? NA : Math.max(c, 0), len);
      const d = dn(isN(c) ? NA : -Math.min(c, 0), len);
      if (isN(u) || isN(d)) return NA;
      if (d === 0) return 100;
      if (u === 0) return 0;
      return 100 - 100 / (1 + u / d);
    };
  },
  tr: (env) => {
    const t = trueRange(env);
    return () => t();
  },
  atr: (env) => {
    const t = trueRange(env);
    const r = rma();
    return (len: number) => r(t(), len);
  },
  stdev: () => stdev(),
  variance: () => {
    const s = stdev();
    return (src: number, len: number, biased?: boolean) => {
      const v = s(src, len, biased);
      return v * v;
    };
  },
  dev: () => dev(),
  highest: () => highest(),
  lowest: () => lowest(),
  highestbars: () => {
    let w: Win | null = null;
    return (src: number, len: number) => {
      if (!w || w.len !== len) w = new Win(len);
      w.push(src);
      let best = -Infinity;
      let bi = -1;
      for (let i = 0; i < w.buf.length; i++) {
        const x = w.buf[i];
        if (isN(x)) continue;
        if (x >= best) {
          best = x;
          bi = i;
        }
      }
      return bi < 0 ? NA : bi - (w.buf.length - 1);
    };
  },
  lowestbars: () => {
    let w: Win | null = null;
    return (src: number, len: number) => {
      if (!w || w.len !== len) w = new Win(len);
      w.push(src);
      let best = Infinity;
      let bi = -1;
      for (let i = 0; i < w.buf.length; i++) {
        const x = w.buf[i];
        if (isN(x)) continue;
        if (x <= best) {
          best = x;
          bi = i;
        }
      }
      return bi < 0 ? NA : bi - (w.buf.length - 1);
    };
  },
  range: () => {
    const h = highest();
    const l = lowest();
    return (src: number, len: number) => h(src, len) - l(src, len);
  },
  median: () => {
    let w: Win | null = null;
    return (src: number, len: number) => {
      if (!w || w.len !== len) w = new Win(len);
      w.push(src);
      if (!w.full) return NA;
      if (w.buf.some(isN)) return NA;
      const s = [...w.buf].sort((a, b) => a - b);
      const m = Math.floor(len / 2);
      return len % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
  },
  crossover: () => crossStep('over'),
  crossunder: () => crossStep('under'),
  cross: () => crossStep('any'),
  change: () => change(),
  mom: () => change(),
  roc: () => {
    let w: Win | null = null;
    return (src: number, len: number) => {
      if (!w || w.len !== len + 1) w = new Win(len + 1);
      w.push(src);
      if (!w.full) return NA;
      const old = w.buf[0];
      return (100 * (src - old)) / old;
    };
  },
  cum: () => {
    let prev = NA;
    return (src: number) => {
      prev = (isN(prev) ? 0 : prev) + src;
      return prev;
    };
  },
  sum: () => {
    const s = sma();
    return (src: number, len: number) => s(src, len) * len;
  },
  barssince: () => {
    let prev = NA;
    return (cond: any) => {
      if (cond === true || (typeof cond === 'number' && cond !== 0 && !isN(cond))) prev = 0;
      else prev = isN(prev) ? NA : prev + 1;
      return prev;
    };
  },
  valuewhen: () => {
    const hist: number[] = [];
    return (cond: any, src: number, occurrence = 0) => {
      if (cond === true || (typeof cond === 'number' && cond !== 0 && !isN(cond))) {
        hist.push(src);
        if (hist.length > 512) hist.shift();
      }
      const idx = hist.length - 1 - occurrence;
      return idx >= 0 ? hist[idx] : NA;
    };
  },
  pivothigh: (env) => pivot('high', env),
  pivotlow: (env) => pivot('low', env),
  macd: () => {
    const f = ema();
    const s = ema();
    const sig = ema();
    return (src: number, fast: number, slow: number, sigLen: number) => {
      const m = f(src, fast) - s(src, slow);
      const sg = sig(m, sigLen);
      return [m, sg, m - sg];
    };
  },
  bb: () => {
    const m = sma();
    const sd = stdev();
    return (src: number, len: number, mult: number) => {
      const basis = m(src, len);
      const dev = mult * sd(src, len, true);
      return [basis, basis + dev, basis - dev];
    };
  },
  bbw: () => {
    const m = sma();
    const sd = stdev();
    return (src: number, len: number, mult: number) => {
      const basis = m(src, len);
      return (2 * mult * sd(src, len, true)) / basis;
    };
  },
  stoch: () => {
    const hh = highest();
    const ll = lowest();
    return (src: number, high: number, low: number, len: number) => {
      const h = hh(high, len);
      const l = ll(low, len);
      return h === l ? NA : (100 * (src - l)) / (h - l);
    };
  },
  supertrend: (env) => {
    const tr = trueRange(env);
    const atrR = rma();
    let prevAtr = NA;
    let prevUpper = NA;
    let prevLower = NA;
    let prevSt = NA;
    let prevClose = NA;
    return (factor: number, period: number) => {
      const b = env.bar();
      const atr = atrR(tr(), period);
      if (isN(atr)) {
        prevClose = b.close;
        return [NA, NA];
      }
      const hl2 = (b.high + b.low) / 2;
      let upper = hl2 + factor * atr;
      let lower = hl2 - factor * atr;
      const pl = isN(prevLower) ? 0 : prevLower;
      const pu = isN(prevUpper) ? 0 : prevUpper;
      lower = lower > pl || prevClose < pl ? lower : pl;
      upper = upper < pu || prevClose > pu ? upper : pu;
      let dir: number;
      if (isN(prevAtr)) dir = 1;
      else if (prevSt === prevUpper) dir = b.close > upper ? -1 : 1;
      else dir = b.close < lower ? 1 : -1;
      const st = dir === -1 ? lower : upper;
      prevAtr = atr;
      prevUpper = upper;
      prevLower = lower;
      prevSt = st;
      prevClose = b.close;
      return [st, dir];
    };
  },
  vwap: (env) => {
    let day = -1;
    let pv = 0;
    let v = 0;
    return (src: number) => {
      const b = env.bar();
      const d = Math.floor(b.time / 86_400_000);
      if (d !== day) {
        day = d;
        pv = 0;
        v = 0;
      }
      pv += src * b.volume;
      v += b.volume;
      return v > 0 ? pv / v : NA;
    };
  },
  mfi: (env) => {
    const ch = change();
    const up = sma();
    const dn = sma();
    return (src: number, len: number) => {
      const vol = env.bar().volume;
      const c = ch(src, 1);
      const u = up(isN(c) ? NA : c <= 0 ? 0 : vol * src, len) * len;
      const d = dn(isN(c) ? NA : c >= 0 ? 0 : vol * src, len) * len;
      if (isN(u) || isN(d)) return NA;
      return 100 - 100 / (1 + u / d);
    };
  },
  linreg: () => linreg(),
  dmi: (env) => {
    const tr = trueRange(env);
    const rTr = rma();
    const rUp = rma();
    const rDn = rma();
    const rAdx = rma();
    const fp = fixnan();
    const fm = fixnan();
    let pHigh = NA;
    let pLow = NA;
    return (diLen: number, adxLen: number) => {
      const b = env.bar();
      const up = isN(pHigh) ? NA : b.high - pHigh;
      const down = isN(pLow) ? NA : pLow - b.low;
      pHigh = b.high;
      pLow = b.low;
      const plusDM = isN(up) ? NA : up > down && up > 0 ? up : 0;
      const minusDM = isN(down) ? NA : down > up && down > 0 ? down : 0;
      const trr = rTr(tr(), diLen);
      const plus = fp((100 * rUp(plusDM, diLen)) / trr);
      const minus = fm((100 * rDn(minusDM, diLen)) / trr);
      const sum = plus + minus;
      const adx = 100 * rAdx(Math.abs(plus - minus) / (sum === 0 ? 1 : sum), adxLen);
      return [plus, minus, adx];
    };
  },
  cci: () => cci(),
  rising: () => {
    let w: Win | null = null;
    return (src: number, len: number) => {
      if (!w || w.len !== len + 1) w = new Win(len + 1);
      w.push(src);
      if (!w.full) return false;
      for (let i = 1; i <= len; i++) if (!(w.buf[i] > w.buf[i - 1])) return false;
      return true;
    };
  },
  falling: () => {
    let w: Win | null = null;
    return (src: number, len: number) => {
      if (!w || w.len !== len + 1) w = new Win(len + 1);
      w.push(src);
      if (!w.full) return false;
      for (let i = 1; i <= len; i++) if (!(w.buf[i] < w.buf[i - 1])) return false;
      return true;
    };
  },
  fixnan: () => fixnan(),
  kc: (env) => {
    const e = ema();
    const tr = trueRange(env);
    const rt = rma();
    const rng = sma();
    return (src: number, len: number, mult: number, useTR = true) => {
      const basis = e(src, len);
      const b = env.bar();
      const range = useTR ? tr() : b.high - b.low;
      const r = useTR ? rt(range, len) : rng(range, len);
      return [basis, basis + mult * r, basis - mult * r];
    };
  },
  obv: (env) => {
    let prevClose = NA;
    let total = 0;
    return () => {
      const b = env.bar();
      if (!isN(prevClose)) total += b.close > prevClose ? b.volume : b.close < prevClose ? -b.volume : 0;
      prevClose = b.close;
      return total;
    };
  },
  cmo: () => {
    const ch = change();
    const up = sma();
    const dn = sma();
    return (src: number, len: number) => {
      const c = ch(src, 1);
      const u = up(isN(c) ? NA : Math.max(c, 0), len) * len;
      const d = dn(isN(c) ? NA : -Math.min(c, 0), len) * len;
      if (isN(u) || isN(d)) return NA;
      return u + d === 0 ? 0 : (100 * (u - d)) / (u + d);
    };
  },
  alma: () => {
    let w: Win | null = null;
    return (src: number, len: number, offset = 0.85, sigma = 6, floor = false) => {
      if (!w || w.len !== len) w = new Win(len);
      w.push(src);
      if (!w.full || len <= 0 || sigma === 0) return NA;
      const m = floor ? Math.floor(offset * (len - 1)) : offset * (len - 1);
      const s = len / sigma;
      const denom = 2 * s * s;
      let norm = 0;
      let sum = 0;
      for (let i = 0; i < len; i++) {
        const x = w.buf[i];
        if (isN(x)) return NA;
        const wt = Math.exp(-((i - m) * (i - m)) / denom);
        norm += wt;
        sum += x * wt;
      }
      return norm === 0 ? NA : sum / norm;
    };
  },
  wpr: (env) => {
    let wh: Win | null = null;
    let wl: Win | null = null;
    return (len: number) => {
      const b = env.bar();
      if (!wh || wh.len !== len) {
        wh = new Win(len);
        wl = new Win(len);
      }
      wh.push(b.high);
      wl!.push(b.low);
      if (!wh.full) return NA;
      let hh = -Infinity;
      let ll = Infinity;
      for (let i = 0; i < len; i++) {
        const h = wh.buf[i];
        const l = wl!.buf[i];
        if (isN(h) || isN(l)) return NA;
        if (h > hh) hh = h;
        if (l < ll) ll = l;
      }
      return hh === ll ? NA : ((hh - b.close) / (hh - ll)) * -100;
    };
  },
  tsi: () => {
    const ch = change();
    const e1 = ema();
    const e2 = ema();
    const a1 = ema();
    const a2 = ema();
    return (src: number, shortLen: number, longLen: number) => {
      const pc = ch(src, 1);
      const dsPc = e2(e1(pc, longLen), shortLen);
      const dsAbs = a2(a1(isN(pc) ? NA : Math.abs(pc), longLen), shortLen);
      if (isN(dsPc) || isN(dsAbs)) return NA;
      return dsAbs === 0 ? 0 : dsPc / dsAbs;
    };
  },
  kcw: (env) => {
    const e = ema();
    const tr = trueRange(env);
    const rt = rma();
    const rng = sma();
    return (src: number, len: number, mult: number, useTR = true) => {
      const basis = e(src, len);
      const b = env.bar();
      const range = useTR ? tr() : b.high - b.low;
      const r = useTR ? rt(range, len) : rng(range, len);
      if (isN(basis) || isN(r) || basis === 0) return NA;
      return (2 * mult * r) / basis;
    };
  },
  sar: (env) => {
    let trend = 0; // 1 up, -1 down
    let sar = NA;
    let ep = NA;
    let af = NA;
    let pHigh1 = NA;
    let pLow1 = NA;
    let pHigh2 = NA;
    let pLow2 = NA;
    let pClose = NA;
    return (start = 0.02, inc = 0.02, max = 0.2) => {
      const b = env.bar();
      let out = NA;
      if (trend === 0) {
        if (!isN(pClose)) {
          trend = b.close >= pClose ? 1 : -1;
          sar = trend === 1 ? pLow1 : pHigh1;
          ep = trend === 1 ? b.high : b.low;
          af = start;
          out = sar;
        }
      } else {
        let next = sar + af * (ep - sar);
        if (trend === 1) {
          if (!isN(pLow1)) next = Math.min(next, pLow1);
          if (!isN(pLow2)) next = Math.min(next, pLow2);
          if (b.low < next) {
            trend = -1;
            sar = Math.max(ep, b.high);
            ep = b.low;
            af = start;
          } else {
            sar = next;
            if (b.high > ep) {
              ep = b.high;
              af = Math.min(max, af + inc);
            }
          }
        } else {
          if (!isN(pHigh1)) next = Math.max(next, pHigh1);
          if (!isN(pHigh2)) next = Math.max(next, pHigh2);
          if (b.high > next) {
            trend = 1;
            sar = Math.min(ep, b.low);
            ep = b.high;
            af = start;
          } else {
            sar = next;
            if (b.low < ep) {
              ep = b.low;
              af = Math.min(max, af + inc);
            }
          }
        }
        out = sar;
      }
      pHigh2 = pHigh1;
      pLow2 = pLow1;
      pHigh1 = b.high;
      pLow1 = b.low;
      pClose = b.close;
      return out;
    };
  },
  cog: () => {
    let w: Win | null = null;
    return (src: number, len: number) => {
      if (!w || w.len !== len) w = new Win(len);
      w.push(src);
      if (!w.full || len <= 0) return NA;
      let num = 0;
      let den = 0;
      for (let i = 0; i < len; i++) {
        const x = w.buf[len - 1 - i]; // i=0 current bar -> weight 1
        if (isN(x)) return NA;
        num += x * (i + 1);
        den += x;
      }
      return den === 0 ? NA : -num / den;
    };
  },
  percentrank: () => {
    let w: Win | null = null;
    return (src: number, len: number) => {
      if (len <= 0) return NA;
      if (!w || w.len !== len + 1) w = new Win(len + 1);
      w.push(src);
      if (!w.full || isN(src)) return NA;
      let count = 0;
      for (let i = 0; i < len; i++) {
        const x = w.buf[i]; // previous `len` bars
        if (isN(x)) return NA;
        if (x <= src) count++;
      }
      return (count / len) * 100;
    };
  },
  percentile_linear_interpolation: () => {
    let w: Win | null = null;
    return (src: number, len: number, pct: number) => {
      if (len <= 0 || isN(pct) || pct < 0 || pct > 100) return NA;
      if (!w || w.len !== len) w = new Win(len);
      w.push(src);
      if (!w.full || w.buf.some(isN)) return NA;
      const s = [...w.buf].sort((a, b) => a - b);
      const pos = (pct / 100) * (len - 1);
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      return lo === hi ? s[lo] : s[lo] + (pos - lo) * (s[hi] - s[lo]);
    };
  },
  percentile_nearest_rank: () => {
    let w: Win | null = null;
    return (src: number, len: number, pct: number) => {
      if (len <= 0 || isN(pct) || pct < 0 || pct > 100) return NA;
      if (!w || w.len !== len) w = new Win(len);
      w.push(src);
      const valid = w.buf.filter((x) => !isN(x));
      if (valid.length === 0) return NA;
      valid.sort((a, b) => a - b);
      const idx = pct <= 0 ? 0 : Math.min(valid.length - 1, Math.ceil((pct / 100) * valid.length) - 1);
      return valid[idx];
    };
  },
  correlation: () => {
    let w1: Win | null = null;
    let w2: Win | null = null;
    return (s1: number, s2: number, len: number) => {
      if (len <= 0) return NA;
      if (!w1 || w1.len !== len) {
        w1 = new Win(len);
        w2 = new Win(len);
      }
      w1.push(s1);
      w2!.push(s2);
      if (!w1.full) return NA;
      let m1 = 0;
      let m2 = 0;
      for (let i = 0; i < len; i++) {
        const a = w1.buf[i];
        const b = w2!.buf[i];
        if (isN(a) || isN(b)) return NA;
        m1 += a;
        m2 += b;
      }
      m1 /= len;
      m2 /= len;
      let cov = 0;
      let v1 = 0;
      let v2 = 0;
      for (let i = 0; i < len; i++) {
        const d1 = w1.buf[i] - m1;
        const d2 = w2!.buf[i] - m2;
        cov += d1 * d2;
        v1 += d1 * d1;
        v2 += d2 * d2;
      }
      const denom = Math.sqrt(v1 * v2);
      return denom === 0 ? NA : cov / denom;
    };
  },
  mode: () => {
    let w: Win | null = null;
    return (src: number, len: number) => {
      if (len <= 0) return NA;
      if (!w || w.len !== len) w = new Win(len);
      w.push(src);
      if (!w.full || w.buf.some(isN)) return NA;
      const freq = new Map<number, number>();
      let bestVal = w.buf[0];
      let bestCnt = 0;
      for (const x of w.buf) {
        const c = (freq.get(x) ?? 0) + 1;
        freq.set(x, c);
        if (c > bestCnt || (c === bestCnt && x < bestVal)) {
          bestCnt = c;
          bestVal = x;
        }
      }
      return bestVal;
    };
  },
  rci: () => {
    let w: Win | null = null;
    return (src: number, len: number) => {
      if (len < 2) return NA;
      if (!w || w.len !== len) w = new Win(len);
      w.push(src);
      if (!w.full || w.buf.some(isN)) return NA;
      // Assign average 1-based ranks to values (ties share average rank)
      const indexed = w.buf.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
      const ranks = new Array<number>(len);
      let k = 0;
      while (k < len) {
        let j = k;
        while (j + 1 < len && indexed[j + 1].v === indexed[k].v) j++;
        const avgRank = (k + j) / 2 + 1;
        for (let m = k; m <= j; m++) ranks[indexed[m].i] = avgRank;
        k = j + 1;
      }
      const meanT = (len + 1) / 2;
      let cov = 0;
      let vt = 0;
      let vr = 0;
      for (let i = 0; i < len; i++) {
        const dt = i + 1 - meanT;
        const dr = ranks[i] - meanT;
        cov += dt * dr;
        vt += dt * dt;
        vr += dr * dr;
      }
      const denom = Math.sqrt(vt * vr);
      return denom === 0 ? 0 : (cov / denom) * 100;
    };
  },
  max: () => {
    let best = NA;
    return (src: number) => {
      if (!isN(src)) best = isN(best) ? src : Math.max(best, src);
      return best;
    };
  },
  min: () => {
    let best = NA;
    return (src: number) => {
      if (!isN(src)) best = isN(best) ? src : Math.min(best, src);
      return best;
    };
  },
  pivot_point_levels: (env) => {
    let hasPrev = false;
    let prevO = NA;
    let prevH = NA;
    let prevL = NA;
    let prevC = NA;
    let curO = NA;
    let curH = NA;
    let curL = NA;
    let curC = NA;
    let lastBucket = NaN;
    return (type: unknown, anchor: unknown, developing = false) => {
      const b = env.bar();
      let isAnchor = false;
      if (typeof anchor === 'string') {
        const sec = parseTimeframeSeconds(anchor);
        if (Number.isFinite(sec) && sec > 0) {
          const curBucket = Math.floor(b.time / 1000 / sec);
          isAnchor = !Number.isNaN(lastBucket) && curBucket !== lastBucket;
          lastBucket = curBucket;
        }
      } else {
        isAnchor = Boolean(anchor);
      }

      if (isN(curO)) {
        curO = b.open;
        curH = b.high;
        curL = b.low;
        curC = b.close;
      } else if (isAnchor) {
        prevO = curO;
        prevH = curH;
        prevL = curL;
        prevC = curC;
        hasPrev = true;
        curO = b.open;
        curH = b.high;
        curL = b.low;
        curC = b.close;
      } else {
        curH = Math.max(curH, b.high);
        curL = Math.min(curL, b.low);
        curC = b.close;
      }

      const dev = Boolean(developing);
      if (!dev && !hasPrev) {
        return new ScriptArray(Array(11).fill(NA), 'float');
      }
      const O = dev ? curO : prevO;
      const H = dev ? curH : prevH;
      const L = dev ? curL : prevL;
      const C = dev ? curC : prevC;
      const openForWoodie = dev ? curC : curO;
      return new ScriptArray(computePivotLevels(String(type ?? 'Traditional'), O, H, L, C, openForWoodie), 'float');
    };
  },
  pvt: (env) => {
    let prevClose = NA;
    let total = 0;
    return () => {
      const b = env.bar();
      if (!isN(prevClose) && prevClose !== 0) {
        total += ((b.close - prevClose) / prevClose) * b.volume;
      }
      prevClose = b.close;
      return total;
    };
  },
  accdist: (env) => {
    let total = 0;
    return () => {
      const b = env.bar();
      const rng = b.high - b.low;
      if (rng !== 0) total += ((2 * b.close - b.low - b.high) / rng) * b.volume;
      return total;
    };
  },
  iii: (env) => () => {
    const b = env.bar();
    const denom = (b.high - b.low) * b.volume;
    return denom === 0 ? 0 : (2 * b.close - b.high - b.low) / denom;
  },
  nvi: (env) => {
    let nvi = 1;
    let prevClose = NA;
    let prevVol = NA;
    return () => {
      const b = env.bar();
      if (!isN(prevVol) && b.volume < prevVol && !isN(prevClose) && prevClose !== 0) {
        nvi += ((b.close - prevClose) / prevClose) * nvi;
      }
      prevClose = b.close;
      prevVol = b.volume;
      return nvi;
    };
  },
  pvi: (env) => {
    let pvi = 1;
    let prevClose = NA;
    let prevVol = NA;
    return () => {
      const b = env.bar();
      if (!isN(prevVol) && b.volume > prevVol && !isN(prevClose) && prevClose !== 0) {
        pvi += ((b.close - prevClose) / prevClose) * pvi;
      }
      prevClose = b.close;
      prevVol = b.volume;
      return pvi;
    };
  },
  wad: (env) => {
    let wad = 0;
    let prevClose = NA;
    return () => {
      const b = env.bar();
      if (!isN(prevClose)) {
        const trh = Math.max(b.high, prevClose);
        const trl = Math.min(b.low, prevClose);
        if (b.close > prevClose) wad += b.close - trl;
        else if (b.close < prevClose) wad += b.close - trh;
      }
      prevClose = b.close;
      return wad;
    };
  },
  wvad: (env) => () => {
    const b = env.bar();
    const rng = b.high - b.low;
    return rng === 0 ? 0 : ((b.close - b.open) / rng) * b.volume;
  },
};

function computePivotLevels(
  rawType: string,
  O: number,
  H: number,
  L: number,
  C: number,
  woodieRef: number
): number[] {
  const t = rawType.trim().toLowerCase();
  const D = H - L;
  if (t === 'fibonacci') {
    const P = (H + L + C) / 3;
    return [P, P + 0.382 * D, P - 0.382 * D, P + 0.618 * D, P - 0.618 * D, P + D, P - D, NA, NA, NA, NA];
  }
  if (t === 'woodie') {
    const P = (H + L + 2 * woodieRef) / 4;
    const R1 = 2 * P - L;
    const S1 = 2 * P - H;
    const R2 = P + D;
    const S2 = P - D;
    const R3 = H + 2 * (P - L);
    const S3 = L - 2 * (H - P);
    const R4 = R3 + D;
    const S4 = S3 - D;
    return [P, R1, S1, R2, S2, R3, S3, R4, S4, NA, NA];
  }
  if (t === 'classic') {
    const P = (H + L + C) / 3;
    return [
      P,
      2 * P - L,
      2 * P - H,
      P + D,
      P - D,
      P + 2 * D,
      P - 2 * D,
      P + 3 * D,
      P - 3 * D,
      NA,
      NA,
    ];
  }
  if (t === 'dm') {
    const X = C < O ? H + 2 * L + C : C > O ? 2 * H + L + C : H + L + 2 * C;
    return [X / 4, X / 2 - L, X / 2 - H, NA, NA, NA, NA, NA, NA, NA, NA];
  }
  if (t === 'camarilla') {
    const P = (H + L + C) / 3;
    const R5 = L !== 0 ? (H / L) * C : NA;
    const S5 = isN(R5) ? NA : 2 * C - R5;
    return [
      P,
      C + (D * 1.1) / 12,
      C - (D * 1.1) / 12,
      C + (D * 1.1) / 6,
      C - (D * 1.1) / 6,
      C + (D * 1.1) / 4,
      C - (D * 1.1) / 4,
      C + (D * 1.1) / 2,
      C - (D * 1.1) / 2,
      R5,
      S5,
    ];
  }
  // Traditional (default)
  const P = (H + L + C) / 3;
  return [
    P,
    2 * P - L,
    2 * P - H,
    P + D,
    P - D,
    2 * P + (H - 2 * L),
    2 * P - (2 * H - L),
    3 * P + (H - 3 * L),
    3 * P - (3 * H - L),
    4 * P + (H - 4 * L),
    4 * P - (4 * H - L),
  ];
}

export function coerceTaArg(v: unknown): any {
  if (typeof v === 'boolean' || typeof v === 'string') return v;
  return toNum(v);
}
