import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EN } from '../i18n_en';
import { setLang, tfmt, tt } from '../i18n';

// Faz 30 — EN kapsam koruması: kaynakta tt("…") / tfmt("…") ile sarılan her Türkçe metnin
// sözlükte İngilizce karşılığı olmalı (Faz 29'da "tam EN" iddiasına rağmen ~100 metin Türkçe kalmıştı).
const ROOT = path.resolve(__dirname, '../..');
const TR = /[çğıöşüÇĞİÖŞÜ]/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'builtins') continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(e.name) && !/i18n(_en)?\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

function wrapped(): Array<{ file: string; key: string }> {
  const re = /\b(tt|tfmt)\((["'])((?:\\.|(?!\2).)*)\2/g;
  const res: Array<{ file: string; key: string }> = [];
  for (const f of sourceFiles(ROOT)) {
    const src = fs.readFileSync(f, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const key = m[2] === '"' ? JSON.parse(`"${m[3]}"`) : m[3].replace(/\\'/g, "'");
      res.push({ file: path.relative(ROOT, f), key });
    }
  }
  return res;
}

describe('Faz 30 — EN dil kapsamı', () => {
  beforeEach(() => setLang('en'));
  afterEach(() => setLang('tr'));

  it('kaynakta sarılı her Türkçe metnin EN karşılığı var', () => {
    const all = wrapped();
    expect(all.length).toBeGreaterThan(1000);
    const missing = all.filter(({ key }) => TR.test(key) && TR.test(tt(key).replace(/Türkçe|Türkiye/g, '')) && TR.test(tfmt(key).replace(/Türkçe|Türkiye/g, '')));
    expect(missing.map((m) => `${m.file}: ${m.key}`)).toEqual([]);
  });

  it('sözlük değerleri Türkçe karakter içermez (özel adlar hariç)', () => {
    const allow = /Türkçe|Türkiye/;
    const bad = Object.entries(EN).filter(([, v]) => TR.test(v) && !allow.test(v));
    expect(bad).toEqual([]);
  });

  it('tt TR modunda metni aynen, EN modunda çeviriyi döndürür; tfmt yer tutucuları doldurur', () => {
    expect(tt('İzleme Listesi')).toBe('Watchlist');
    expect(tfmt('{0} gün önce', 3)).toBe('3 days ago');
    setLang('tr');
    expect(tt('İzleme Listesi')).toBe('İzleme Listesi');
    expect(tfmt('{0} gün önce', 3)).toBe('3 gün önce');
  });

  it('sarılı her metin (Türkçe karaktersiz olanlar da: "Mesaj", "Tetikleme"…) sözlükte ya da dil-nötr', () => {
    // Faz 30 2. tarama: ç/ş içermeyen Türkçe sözcükler önceki testten kaçıyordu.
    // Türkçe karaktersiz Türkçe sözcükler; İngilizce teknik adlar ("SMA (20)", "MACD Histogram") dil-nötr sayılır
    const TR_ASCII = /\b(ve|ile|bir|yok|Son|Sembol|Hacim|Kaydet|Sil|Ekle|Yeni|Kapat|Ayarlar|Durum|Liste|Piyasa|Fiyat|Alarm|Emir|Pozisyon|Hesap|Haber|Takvim|Notlar|Seans|Zaman|Tarih|Grafik|Metin|Ortalama|Hedef|Zarar|Bakiye|Miktar|Adet|Renk|Stil|Kaynak|Uzunluk|Aktif|Sonra|Yenile|Ara|Filtre|Gizle|Kilitle|Hafta|Saat|Dakika|Saniye|Tablo|Analiz|Oran|Sepet|Hisse|Kripto|Veri|Hata|Onay|Durdur|Devam|Mesaj|Tetikleme|Bildirimler|Etiket|Genel|Strateji|Tutar|Uygula|Temizle|Betik|Girdi|Girdiler|Konsol|Tema|Kategori|Seviyesi|Sinyali|Fark|Skor|Formasyonu|Marj|Zirve|Zirveden|YBB|Optimizasyon|Korelasyon|Mavi|Pembe|Turuncu|Mor|Sabit|Teknik|Puan|Toplam|Gelir|Serbest|Nakit|Uygulama|Ses|AL|SAT|Favoriler|Betiklerim)\b/;
    const neutral = (k: string) => (!/[A-Za-zçğıöşüÇĞİÖŞÜ]{2,}/.test(k.replace(/\{\d+\}/g, '')) || (!TR.test(k) && !TR_ASCII.test(k))) || ['VaR', '🛡 Risk', '🇹🇷 Türkiye', '⚔️ Titan Trend Master'].includes(k);
    const missing = [...new Set(wrapped().map((w) => w.key))].filter((k) => !neutral(k) && tt(k) === k && tfmt(k) === k);
    expect(missing).toEqual([]);
  });
});
