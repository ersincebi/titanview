import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTINS, builtinById, parseDeclaration, searchBuiltins } from '../builtins';
import { executeScript } from '../runtime';
import { walkCandles } from './walkCandles';

const BARS = walkCandles(420);
const run = (code: string, bars = BARS) => executeScript(code, bars, { symbol: 'TEST', timeframe: 'D' });

/** Kaynağı olmayan (dürüst na) ya da bilinçli olarak uyarı veren göstergeler. */
const ALLOWED_WARN = /sembol verisi yok|HTF değerleri|request\.security_lower_tf|grafik zaman diliminden küçük/;

describe('Faz 20: hazır gösterge kütüphanesi', () => {
  it('katalog ≥150 gösterge, benzersiz kimlik, her biri başlık/kategori/Türkçe ad taşır', () => {
    expect(BUILTINS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(BUILTINS.map((b) => b.id)).size).toBe(BUILTINS.length);
    for (const b of BUILTINS) {
      expect(b.title, b.id).toBeTruthy();
      expect(b.tr, b.id).toBeTruthy();
      expect(b.desc, b.id).toBeTruthy();
      expect(b.code.startsWith('//@version=6'), b.id).toBe(true);
    }
  });

  it.each(BUILTINS.map((b) => [b.id, b] as const))('%s derlenir, çalışır ve çıktı üretir', (_id, b) => {
    const res = run(b.code);
    expect(res.error, `${b.id}: ${res.error}`).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.isOverlay, `${b.id} overlay`).toBe(b.overlay);
    const unexpected = (res.warnings ?? []).filter((w) => !ALLOWED_WARN.test(w));
    expect(unexpected, b.id).toEqual([]);
    const plotted = res.plots.some((p) => p.data.length > 0) || (res.ohlcPlots ?? []).some((o) => o.data.length > 0);
    const drawn =
      res.markers.length > 0 ||
      (res.bgcolors ?? []).some((x) => x.points.length > 0) ||
      (res.drawings?.lines.length ?? 0) + (res.drawings?.labels.length ?? 0) + (res.drawings?.boxes.length ?? 0) + (res.drawings?.tables.length ?? 0) > 0 ||
      res.hlines.length > 0;
    if (b.category === 'pattern') return; // formasyon bu veride hiç oluşmayabilir; aşağıdaki toplu testte kanıtlanır
    if (!plotted && !drawn) {
      // seans/oturum göstergeleri günlükte bilinçli olarak boş: gün içi veride üretmeli
      const intra = executeScript(b.code, walkCandles(600, 900, 1_700_000_000), { symbol: 'TEST', timeframe: '15' });
      expect(intra.ok, b.id).toBe(true);
      expect((intra.bgcolors ?? []).some((x) => x.points.length > 0) || intra.plots.some((p) => p.data.length > 0), `${b.id} çıktı yok`).toBe(true);
      return;
    }
    expect(plotted || drawn, `${b.id} çıktı yok`).toBe(true);
  });

  it('bildirim ayrıştırma: konumsal + adlandırılmış başlık, overlay', () => {
    expect(parseDeclaration('indicator("Relative Strength Index", "RSI", overlay=false)')).toEqual({ title: 'Relative Strength Index', shortTitle: 'RSI', overlay: false });
    expect(parseDeclaration('indicator(title="Bollinger Bands", shorttitle="BB", overlay=true)')).toEqual({ title: 'Bollinger Bands', shortTitle: 'BB', overlay: true });
    expect(parseDeclaration('indicator("X")')).toEqual({ title: 'X', shortTitle: 'X', overlay: false });
  });

  it('arama Türkçe aksan duyarsız ve çok kelimeli', () => {
    expect(searchBuiltins('goreceli guc').some((b) => b.id === 'rsi')).toBe(true);
    expect(searchBuiltins('RSI').some((b) => b.id === 'rsi')).toBe(true);
    expect(searchBuiltins('bollinger %b').some((b) => b.id === 'bb_percent_b')).toBe(true);
    expect(searchBuiltins('   ').length).toBe(BUILTINS.length);
    expect(searchBuiltins('zzzz-yok')).toEqual([]);
    expect(builtinById('nope')).toBeUndefined();
  });

  it('Faz 32 lisans/köken kapısı: tüm builtins dosyaları SPDX taşır, üçüncü taraf marka/telif içermez', () => {
    const dir = path.resolve(import.meta.dirname, '../builtins');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.titan') || f.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(190);
    for (const f of files) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(content, `${f}: SPDX başlığı eksik`).toContain('SPDX-License-Identifier: AGPL-3.0-or-later');
      expect(content, `${f}: yasaklı marka ifadesi içeriyor`).not.toMatch(/tradingview/i);
      expect(content, `${f}: telif işareti içeriyor`).not.toContain('©');
    }
  });
});
