import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import type { BacktestReport } from '../../types/market';
import { crc32, exportFileName, summaryRows, tradesToCsv, tradesToXlsx, zipStore } from '../tradeExport';

const bt: BacktestReport = {
  initialCapital: 10000,
  finalEquity: 10150,
  netProfitCash: 150,
  netProfitPercent: 1.5,
  totalTrades: 2,
  winningTrades: 1,
  losingTrades: 1,
  winRatePercent: 50,
  profitFactor: 2.5,
  maxDrawdownPercent: 1,
  trades: [
    { id: 1, direction: 'LONG', entryTime: 1_700_000_000, entryPrice: 100, exitTime: 1_700_003_600, exitPrice: 110, pnlPercent: 10, pnlCash: 100, equityAfter: 10100, qty: 10, entryComment: 'Al, "güçlü"', exitComment: 'TP', commission: 0.5 },
    { id: 2, direction: 'SHORT', entryTime: 1_700_007_200, entryPrice: 110, exitTime: 1_700_010_800, exitPrice: 105, pnlPercent: 4.5, pnlCash: 50, equityAfter: 10150, qty: 10, entryId: 'S' },
  ],
  equityCurve: Array.from({ length: 20 }, (_, i) => ({ time: 1_700_000_000 + i * 3600, value: 10000 + i * 8 })),
};
const meta = { symbol: 'BTCUSDT', interval: '1h', script: 'Test Strat', stepSec: 3600 };

function readZip(buf: Uint8Array): Map<string, string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Map<string, string>();
  let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true);
    const crc = dv.getUint32(p + 14, true);
    const csize = dv.getUint32(p + 18, true);
    const nlen = dv.getUint16(p + 26, true);
    const xlen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(buf.slice(p + 30, p + 30 + nlen));
    const data = buf.slice(p + 30 + nlen + xlen, p + 30 + nlen + xlen + csize);
    const raw = method === 8 ? new Uint8Array(inflateRawSync(data)) : data;
    expect(crc32(raw)).toBe(crc);
    out.set(name, new TextDecoder().decode(raw));
    p += 30 + nlen + xlen + csize;
  }
  return out;
}

describe('işlem dışa aktarımı (Faz 24)', () => {
  it('CSV: BOM, başlık, kaçışlı hücreler, UTC zaman', () => {
    const csv = tradesToCsv(bt.trades);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('İşlem No,Yön,Giriş Zamanı,Giriş Fiyatı,Çıkış Zamanı,Çıkış Fiyatı,Miktar,K/Z %,K/Z,Bakiye,Komisyon,Giriş Sinyali,Çıkış Sinyali');
    expect(lines[1]).toBe('1,Long,2023-11-14 22:13:20,100,2023-11-14 23:13:20,110,10,10,100,10100,0.5,"Al, ""güçlü""",TP');
    expect(lines[2]).toContain('2,Short,');
    expect(lines[2].endsWith(',S,')).toBe(true);
  });

  it('özet satırları', () => {
    const rows = new Map(summaryRows(bt, meta));
    expect(rows.get('Betik')).toBe('Test Strat');
    expect(rows.get('Net Kâr')).toBe(150);
    expect(rows.get('Toplam İşlem')).toBe(2);
    expect(rows.get('Profit Factor')).toBe(2.5);
    expect(rows.has('Sharpe')).toBe(true);
  });

  it('XLSX: geçerli ZIP (CRC tutarlı), iki sayfa, değerler', () => {
    const files = readZip(tradesToXlsx(bt, meta));
    expect([...files.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
    const s1 = files.get('xl/worksheets/sheet1.xml')!;
    expect(s1).toContain('<c r="A2"><v>1</v></c>');
    expect(s1).toContain('Al, &quot;güçlü&quot;');
    expect(s1).toContain('<c r="I2"><v>100</v></c>');
    expect(files.get('xl/worksheets/sheet2.xml')).toContain('Test Strat');
    expect(files.get('xl/workbook.xml')).toContain('name="İşlemler"');
  });

  it('crc32 bilinen değer', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('zipStore boş ve çoklu dosya', () => {
    const z = zipStore([{ name: 'a.txt', data: new TextEncoder().encode('merhaba') }]);
    expect(readZip(z).get('a.txt')).toBe('merhaba');
  });

  it('dosya adı güvenli', () => {
    expect(exportFileName({ ...meta, script: 'A/B: c' }, 'csv')).toBe('A_B_c_BTCUSDT_1h_islemler.csv');
  });
});
