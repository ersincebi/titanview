import { tt } from './i18n';
import type { BacktestReport, BacktestTrade } from '../types/market';
import { riskStats, sideStats } from './strategyStats';

/** Faz 24: işlem listesi + özet → CSV ve gerçek .xlsx (bağımlılıksız, sıkıştırmasız ZIP). */

export interface ExportMeta {
  symbol: string;
  interval: string;
  script: string;
  stepSec: number;
}

const HEAD = [
  'İşlem No',
  'Yön',
  'Giriş Zamanı',
  'Giriş Fiyatı',
  'Çıkış Zamanı',
  'Çıkış Fiyatı',
  'Miktar',
  'K/Z %',
  'K/Z',
  'Bakiye',
  'Komisyon',
  'Giriş Sinyali',
  'Çıkış Sinyali',
];

const iso = (t: number): string => (t > 0 ? new Date(t * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '') : '');

function row(t: BacktestTrade): Array<string | number> {
  return [
    t.id,
    t.direction === 'LONG' ? 'Long' : 'Short',
    iso(t.entryTime),
    t.entryPrice,
    iso(t.exitTime),
    t.exitPrice,
    t.qty ?? '',
    t.pnlPercent,
    t.pnlCash,
    t.equityAfter,
    t.commission ?? '',
    t.entryComment || t.entryId || '',
    t.exitComment || '',
  ];
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 (BOM'lu: Excel Türkçe karakterleri doğru açar) CSV; virgül ayırıcı, CRLF. */
export function tradesToCsv(trades: BacktestTrade[]): string {
  const lines = [HEAD, ...trades.map(row)].map((r) => r.map(csvCell).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function summaryRows(bt: BacktestReport, meta: ExportMeta): Array<[string, string | number]> {
  const all = sideStats(bt.trades, meta.stepSec);
  const risk = riskStats(bt, meta.stepSec);
  const n = (v: number | null): string | number => (v === null ? '' : +v.toFixed(4));
  return [
    ['Betik', meta.script],
    ['Sembol', meta.symbol],
    ['Zaman Dilimi', meta.interval],
    ['Başlangıç Sermayesi', bt.initialCapital],
    ['Son Özsermaye', bt.finalEquity],
    ['Net Kâr', bt.netProfitCash],
    ['Net Kâr %', bt.netProfitPercent],
    ['Toplam İşlem', bt.totalTrades],
    ['Kârlı İşlem', bt.winningTrades],
    ['Zararlı İşlem', bt.losingTrades],
    ['Kazanma Oranı %', bt.winRatePercent],
    ['Profit Factor', bt.profitFactor],
    ['Maks. Düşüş (nakit)', +risk.maxDrawdownCash.toFixed(2)],
    ['Maks. Düşüş %', +risk.maxDrawdownPct.toFixed(2)],
    ['Sharpe', n(risk.sharpe)],
    ['Sortino', n(risk.sortino)],
    ['Getiri / Maks. Düşüş', n(risk.returnOnMaxDD)],
    ['Brüt Kâr', +all.grossProfit.toFixed(2)],
    ['Brüt Zarar', +all.grossLoss.toFixed(2)],
    ['Ort. İşlem K/Z', n(all.avgTrade)],
    ['Komisyon', bt.commissionPaid ?? 0],
    ['Açık Pozisyon K/Z', bt.openProfitCash ?? 0],
  ];
}

// ------------------------------------------------------------------ XLSX

const xmlEsc = (s: string): string =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetXml(rows: Array<Array<string | number>>, widths: number[]): string {
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const body = rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          const ref = `${colName(ci)}${ri + 1}`;
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
          if (v === '' || v === null || v === undefined) return '';
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
}

let crcTable: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Sıkıştırmasız (STORE) ZIP. */
export function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0)]);
    chunks.push(local, name, f.data);
    central.push(
      Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]),
      name
    );
    offset += local.length + name.length + f.data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export function tradesToXlsx(bt: BacktestReport, meta: ExportMeta): Uint8Array {
  const enc = new TextEncoder();
  const f = (name: string, text: string) => ({ name, data: enc.encode(text) });
  const trades = sheetXml([HEAD, ...bt.trades.map(row)], [9, 8, 19, 13, 19, 13, 11, 10, 12, 13, 11, 22, 22]);
  const summary = sheetXml([['Metrik', tt("Değer")], ...summaryRows(bt, meta)], [30, 24]);
  return zipStore([
    f('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    f('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    f('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="İşlemler" sheetId="1" r:id="rId1"/><sheet name="Özet" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    f('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'),
    f('xl/worksheets/sheet1.xml', trades),
    f('xl/worksheets/sheet2.xml', summary),
  ]);
}

export function exportFileName(meta: ExportMeta, ext: 'csv' | 'xlsx'): string {
  const safe = (s: string) => s.replace(/[^\w.-]+/g, '_');
  return `${safe(meta.script || 'strateji')}_${safe(meta.symbol)}_${meta.interval}_islemler.${ext}`;
}

export function downloadBytes(name: string, data: BlobPart, mime: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
