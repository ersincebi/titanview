import { lang } from './i18n';
import { rt } from './runtime';
import { toast, ui } from './store';
import { colorThemeId } from './theme';

export function buildChartShareUrl(): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  url.searchParams.delete('share');
  url.searchParams.set('symbol', ui.symbol);
  url.searchParams.set('interval', ui.interval);
  if (ui.chartStyle !== 'candles') url.searchParams.set('style', ui.chartStyle);
  else url.searchParams.delete('style');
  if (ui.scaleKind !== 'normal') url.searchParams.set('scale', ui.scaleKind);
  else url.searchParams.delete('scale');
  if (colorThemeId() !== 'dark') url.searchParams.set('theme', colorThemeId());
  else url.searchParams.delete('theme');
  url.searchParams.set('lang', lang());
  return url.toString();
}

/** Grafik tuvalini indirir ve panoya kopyalar (mevcut `takeSnapshot` sözleşmesi %100 korunur). */
export function takeSnapshot(): void {
  try {
    const canvas = rt.chart?.takeScreenshot();
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `TitanView_${ui.symbol}_${ui.interval}.png`;
    a.click();
    canvas.toBlob((blob) => {
      if (blob && navigator.clipboard?.write) {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
      }
    });
    toast(
      lang() === 'en'
        ? `📸 ${ui.symbol} chart downloaded & copied to clipboard!`
        : `📸 ${ui.symbol} grafiği kaydedildi ve panoya kopyalandı!`
    );
  } catch {
    toast(lang() === 'en' ? 'Could not take snapshot' : 'Ekran görüntüsü alınamadı');
  }
}

/** Yalnızca PNG olarak indirir. */
export function downloadSnapshot(): boolean {
  try {
    const canvas = rt.chart?.takeScreenshot();
    if (!canvas) return false;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `TitanView_${ui.symbol}_${ui.interval}.png`;
    a.click();
    toast(
      lang() === 'en'
        ? `📸 Downloaded: TitanView_${ui.symbol}_${ui.interval}.png`
        : `📸 İndirildi: TitanView_${ui.symbol}_${ui.interval}.png`
    );
    return true;
  } catch {
    toast(lang() === 'en' ? 'Could not take snapshot' : 'Ekran görüntüsü alınamadı');
    return false;
  }
}

/** Grafik görüntüsünü PNG olarak panoya kopyalar. */
export async function copySnapshotImage(): Promise<boolean> {
  try {
    const canvas = rt.chart?.takeScreenshot();
    if (!canvas) return false;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    if (blob && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(lang() === 'en' ? `📋 Chart image copied (${ui.symbol})` : `📋 Grafik görüntüsü panoya kopyalandı (${ui.symbol})`);
      return true;
    }
    toast(lang() === 'en' ? 'Clipboard image write unsupported in this browser' : 'Bu tarayıcıda görüntü kopyalama desteklenmiyor');
    return false;
  } catch {
    toast(lang() === 'en' ? 'Could not copy chart image' : 'Grafik görüntüsü panoya kopyalanamadı');
    return false;
  }
}

/** Sembol/aralık/stil/tema/dil derin bağlantısını panoya kopyalar. */
export async function copyChartLink(): Promise<string | null> {
  const url = buildChartShareUrl();
  if (!url) return null;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      toast(lang() === 'en' ? '🔗 Chart link copied to clipboard' : '🔗 Grafik bağlantısı panoya kopyalandı');
      return url;
    }
  } catch {
    // fallback below
  }
  toast(lang() === 'en' ? `🔗 Link ready: ${url}` : `🔗 Bağlantı hazır: ${url}`);
  return url;
}

/** Grafik görüntüsünü yeni tarayıcı sekmesinde açar. */
export function openSnapshotInNewTab(): boolean {
  try {
    const canvas = rt.chart?.takeScreenshot();
    if (!canvas) return false;
    const dataUrl = canvas.toDataURL('image/png');
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(
        `<!doctype html><title>TitanView — ${ui.symbol} (${ui.interval})</title>` +
          `<body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh">` +
          `<img src="${dataUrl}" style="max-width:100%;max-height:100vh"/></body>`
      );
      win.document.close();
      return true;
    }
    return false;
  } catch {
    toast(lang() === 'en' ? 'Could not open snapshot' : 'Ekran görüntüsü açılamadı');
    return false;
  }
}
