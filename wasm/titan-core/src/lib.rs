//! TitanView TitanScript VM sıcak yolu. `frontend/src/script/ta.ts` içindeki artımlı (bar-bar) ta.* temel
//! adımlayıcılarının Rust karşılıkları: sma, ema, rma, wma, highest, lowest, stdev, dev, linreg, cci.
//! Anlamlar TS uygulamasıyla BİREBİR aynıdır (aynı kayan nokta işlem sırası → bit-özdeş sonuç);
//! `frontend/src/script/__tests__/wasmCore.test.ts` rastgele + NaN'lı veriyle eşitliği doğrular.
//! Bağımlılık yok, wasm-bindgen yok: ham `extern "C"` dışa aktarımlar, tek iş parçacığı.

use std::cell::RefCell;

const NA: f64 = f64::NAN;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Sma,
    Ema,
    Rma,
    Wma,
    Highest,
    Lowest,
    Stdev,
    Dev,
    Linreg,
    Cci,
}

/// Son `len` değerin halka tamponu (eskiden yeniye: `pos` doluyken en eskinin yeridir).
struct Ring {
    len: usize,
    buf: Vec<f64>,
    pos: usize,
    count: usize,
}

impl Ring {
    fn new() -> Ring {
        Ring { len: 0, buf: Vec::new(), pos: 0, count: 0 }
    }
    fn reset(&mut self, len: usize) {
        self.len = len;
        self.buf.clear();
        self.buf.resize(len, NA);
        self.pos = 0;
        self.count = 0;
    }
    fn full(&self) -> bool {
        self.count >= self.len
    }
    /// doluyken düşen (en eski) değer
    fn oldest(&self) -> f64 {
        self.buf[self.pos]
    }
    fn push(&mut self, v: f64) {
        self.buf[self.pos] = v;
        self.pos = (self.pos + 1) % self.len;
        if self.count < self.len {
            self.count += 1;
        }
    }
    /// sıralı erişim: 0 = en eski mevcut değer
    fn nth_oldest(&self, i: usize) -> f64 {
        let start = if self.count >= self.len { self.pos } else { 0 };
        self.buf[(start + i) % self.len]
    }
    /// 0 = en yeni
    fn nth_newest(&self, k: usize) -> f64 {
        self.buf[(self.pos + self.len - 1 - k) % self.len]
    }
}

struct Inst {
    kind: Kind,
    ring: Ring,
    sum: f64,
    nas: usize,
    prev: f64,
}

impl Inst {
    fn new(kind: Kind) -> Inst {
        Inst { kind, ring: Ring::new(), sum: 0.0, nas: 0, prev: NA }
    }

    fn sma(&mut self, v: f64, len: usize) -> f64 {
        if self.ring.len != len {
            self.ring.reset(len);
            self.sum = 0.0;
            self.nas = 0;
        }
        if self.ring.full() {
            let old = self.ring.oldest();
            if old.is_nan() {
                self.nas -= 1;
            } else {
                self.sum -= old;
            }
        }
        self.ring.push(v);
        if v.is_nan() {
            self.nas += 1;
        } else {
            self.sum += v;
        }
        if !self.ring.full() || self.nas > 0 {
            return NA;
        }
        self.sum / len as f64
    }

    fn step(&mut self, v: f64, len: usize, extra: f64) -> f64 {
        match self.kind {
            Kind::Sma => self.sma(v, len),
            Kind::Ema | Kind::Rma => {
                let s = self.sma(v, len);
                let alpha = if self.kind == Kind::Ema { 2.0 / (len as f64 + 1.0) } else { 1.0 / len as f64 };
                if self.prev.is_nan() {
                    self.prev = s;
                } else if v.is_nan() {
                    self.prev = NA;
                } else {
                    self.prev = alpha * v + (1.0 - alpha) * self.prev;
                }
                self.prev
            }
            Kind::Wma => {
                if self.ring.len != len {
                    self.ring.reset(len);
                }
                self.ring.push(v);
                if !self.ring.full() {
                    return NA;
                }
                let mut s = 0.0;
                for j in 0..len {
                    let x = self.ring.nth_newest(j);
                    if x.is_nan() {
                        return NA;
                    }
                    s += x * (len - j) as f64;
                }
                let l = len as f64;
                s / ((l * (l + 1.0)) / 2.0)
            }
            Kind::Highest | Kind::Lowest => {
                if self.ring.len != len {
                    self.ring.reset(len);
                }
                self.ring.push(v);
                let hi = self.kind == Kind::Highest;
                let mut m = if hi { f64::NEG_INFINITY } else { f64::INFINITY };
                let mut any = false;
                for i in 0..self.ring.count {
                    let x = self.ring.nth_oldest(i);
                    if x.is_nan() {
                        continue;
                    }
                    any = true;
                    if (hi && x > m) || (!hi && x < m) {
                        m = x;
                    }
                }
                if any {
                    m
                } else {
                    NA
                }
            }
            Kind::Stdev => {
                if self.ring.len != len {
                    self.ring.reset(len);
                }
                self.ring.push(v);
                if !self.ring.full() {
                    return NA;
                }
                let mut sum = 0.0;
                for i in 0..len {
                    let x = self.ring.nth_oldest(i);
                    if x.is_nan() {
                        return NA;
                    }
                    sum += x;
                }
                let mean = sum / len as f64;
                let mut sq = 0.0;
                for i in 0..len {
                    let x = self.ring.nth_oldest(i);
                    sq += (x - mean) * (x - mean);
                }
                let biased = extra != 0.0;
                let div = if biased { len as f64 } else { (len.saturating_sub(1)).max(1) as f64 };
                (sq / div).sqrt()
            }
            Kind::Dev | Kind::Cci => {
                let mean = self.sma(v, len);
                if mean.is_nan() {
                    return NA;
                }
                let mut d = 0.0;
                for i in 0..len {
                    let x = self.ring.nth_oldest(i);
                    d += (x - mean).abs();
                }
                d /= len as f64;
                if self.kind == Kind::Dev {
                    d
                } else if d == 0.0 {
                    0.0
                } else {
                    (v - mean) / (0.015 * d)
                }
            }
            Kind::Linreg => {
                if self.ring.len != len {
                    self.ring.reset(len);
                }
                self.ring.push(v);
                if !self.ring.full() {
                    return NA;
                }
                let mut sx = 0.0;
                let mut sy = 0.0;
                let mut sxy = 0.0;
                let mut sxx = 0.0;
                for i in 0..len {
                    let y = self.ring.nth_oldest(i);
                    if y.is_nan() {
                        return NA;
                    }
                    let xi = i as f64;
                    sx += xi;
                    sy += y;
                    sxy += xi * y;
                    sxx += xi * xi;
                }
                let l = len as f64;
                let denom = l * sxx - sx * sx;
                let slope = if denom == 0.0 { 0.0 } else { (l * sxy - sx * sy) / denom };
                let intercept = (sy - slope * sx) / l;
                intercept + slope * (l - 1.0 - extra)
            }
        }
    }
}

thread_local! {
    static ARENA: RefCell<Vec<Inst>> = const { RefCell::new(Vec::new()) };
}

/// Tüm adımlayıcıları serbest bırakır (en dıştaki koşu başlarken çağrılır).
#[no_mangle]
pub extern "C" fn tc_reset() {
    ARENA.with(|a| a.borrow_mut().clear());
}

/// Yeni adımlayıcı: 0 sma, 1 ema, 2 rma, 3 wma, 4 highest, 5 lowest, 6 stdev, 7 dev, 8 linreg, 9 cci.
#[no_mangle]
pub extern "C" fn tc_new(kind: u32) -> u32 {
    let k = match kind {
        0 => Kind::Sma,
        1 => Kind::Ema,
        2 => Kind::Rma,
        3 => Kind::Wma,
        4 => Kind::Highest,
        5 => Kind::Lowest,
        6 => Kind::Stdev,
        7 => Kind::Dev,
        8 => Kind::Linreg,
        _ => Kind::Cci,
    };
    ARENA.with(|a| {
        let mut a = a.borrow_mut();
        a.push(Inst::new(k));
        (a.len() - 1) as u32
    })
}

/// Bir bar ilerlet. `len` >= 1 olmalıdır (geçersiz / aşırı uzunlukta panik yerine NaN döner).
/// `extra`: stdev için biased (1/0), linreg için offset.
#[no_mangle]
pub extern "C" fn tc_step(h: u32, v: f64, len: f64, extra: f64) -> f64 {
    if !(len >= 1.0) || !len.is_finite() {
        return NA;
    }
    let l = len as usize;
    if l == 0 || l > 1_000_000 {
        return NA;
    }
    ARENA.with(|a| {
        let mut a = a.borrow_mut();
        match a.get_mut(h as usize) {
            Some(inst) => inst.step(v, l, extra),
            None => NA,
        }
    })
}

/// Canlı adımlayıcı sayısı (testler / tanılama).
#[no_mangle]
pub extern "C" fn tc_count() -> u32 {
    ARENA.with(|a| a.borrow().len() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sma_and_nan_recovery() {
        tc_reset();
        let h = tc_new(0);
        assert!(tc_step(h, 10.0, 3.0, 0.0).is_nan());
        assert!(tc_step(h, 20.0, 3.0, 0.0).is_nan());
        assert_eq!(tc_step(h, 30.0, 3.0, 0.0), 20.0);
        assert!(tc_step(h, NA, 3.0, 0.0).is_nan());
        assert!(tc_step(h, 40.0, 3.0, 0.0).is_nan());
        assert!(tc_step(h, 50.0, 3.0, 0.0).is_nan());
        assert_eq!(tc_step(h, 60.0, 3.0, 0.0), 50.0);
    }

    #[test]
    fn ema_rma_wma() {
        tc_reset();
        let e = tc_new(1);
        let r = tc_new(2);
        let w = tc_new(3);
        let mut ev = NA;
        let mut rv = NA;
        let mut wv = NA;
        for &x in &[10.0, 20.0, 30.0, 40.0] {
            ev = tc_step(e, x, 3.0, 0.0);
            rv = tc_step(r, x, 3.0, 0.0);
            wv = tc_step(w, x, 3.0, 0.0);
        }
        assert!((ev - 30.0).abs() < 1e-12);
        assert!((rv - (20.0 * 2.0 / 3.0 + 40.0 / 3.0)).abs() < 1e-12);
        assert!((wv - ((40.0 * 3.0 + 30.0 * 2.0 + 20.0) / 6.0)).abs() < 1e-12);
    }

    #[test]
    fn highest_lowest_skip_nan() {
        tc_reset();
        let hi = tc_new(4);
        let lo = tc_new(5);
        assert_eq!(tc_step(hi, 5.0, 3.0, 0.0), 5.0);
        assert_eq!(tc_step(hi, NA, 3.0, 0.0), 5.0);
        assert_eq!(tc_step(hi, 2.0, 3.0, 0.0), 5.0);
        assert_eq!(tc_step(hi, 3.0, 3.0, 0.0), 3.0);
        assert_eq!(tc_step(lo, 5.0, 2.0, 0.0), 5.0);
        assert_eq!(tc_step(lo, 1.0, 2.0, 0.0), 1.0);
    }

    #[test]
    fn stdev_dev_cci_linreg() {
        tc_reset();
        let sd = tc_new(6);
        let dv = tc_new(7);
        let lr = tc_new(8);
        let cc = tc_new(9);
        for &x in &[10.0, 12.0, 14.0, 16.0] {
            let _ = tc_step(sd, x, 4.0, 1.0);
            let _ = tc_step(dv, x, 4.0, 0.0);
            let _ = tc_step(lr, x, 4.0, 0.0);
            let _ = tc_step(cc, x, 4.0, 0.0);
        }
        // exact linear series 10,12,14,16 -> mean=13, stdev=sqrt(5), dev=2, linreg(0)=16, cci=(16-13)/(0.015*2)=100
        let sd2 = tc_new(6);
        let dv2 = tc_new(7);
        let lr2 = tc_new(8);
        let cc2 = tc_new(9);
        let mut out = [NA; 4];
        for &x in &[10.0, 12.0, 14.0, 16.0] {
            out[0] = tc_step(sd2, x, 4.0, 1.0);
            out[1] = tc_step(dv2, x, 4.0, 0.0);
            out[2] = tc_step(lr2, x, 4.0, 1.0); // offset=1 -> 14
            out[3] = tc_step(cc2, x, 4.0, 0.0);
        }
        assert!((out[0] - 5.0_f64.sqrt()).abs() < 1e-12);
        assert!((out[1] - 2.0).abs() < 1e-12);
        assert!((out[2] - 14.0).abs() < 1e-12);
        assert!((out[3] - 100.0).abs() < 1e-12);
        assert!(tc_step(999, 1.0, 1.0, 0.0).is_nan());
        assert_eq!(tc_count(), 8);
    }

    #[test]
    fn invalid_lengths_return_nan_without_panicking() {
        tc_reset();
        let h = tc_new(0);
        for &bad in &[0.0, -5.0, 0.5, NA, f64::INFINITY, f64::NEG_INFINITY, 1e15] {
            assert!(tc_step(h, 42.0, bad, 0.0).is_nan());
        }
        assert_eq!(tc_step(h, 10.0, 1.0, 0.0), 10.0);
    }
}
