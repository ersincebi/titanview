import type { ScriptExecutionResult, ScriptFill, ScriptFillRef, ScriptPlotSeries } from '../types/market';

const sig = (p: ScriptPlotSeries) => {
  const last = p.data[p.data.length - 1];
  return `${p.title}|${p.style}|${p.color}|${p.isOverlay}|${p.data.length}|${last ? `${last.time}:${last.value}` : ''}`;
};

/**
 * İki betiğin sonucunu tek grafikte gösterilecek şekilde birleştirir (ör. strateji + gösterge).
 * Birincil sonuç geçersizse olduğu gibi döner (hata görünür kalır). İkincil hatalıysa birincil + uyarı döner.
 * Birebir aynı çizgiler (başlık/stil/renk/veri) tekrar çizilmez; fill referansları buna göre yönlendirilir.
 */
export function mergeScriptResults(a: ScriptExecutionResult, b: ScriptExecutionResult | null): ScriptExecutionResult {
  if (!b) return a;
  if (!a.ok) return a;
  if (!b.ok) return { ...a, warnings: [...(a.warnings ?? []), `Ek gösterge çalışmadı: ${b.error ?? b.scriptTitle}`] };

  const have = new Map(a.plots.map((p) => [sig(p), p.id]));
  const idMap = new Map<string, string>();
  const extraPlots: ScriptPlotSeries[] = [];
  for (const p of b.plots) {
    const dupOf = have.get(sig(p));
    if (dupOf) {
      idMap.set(p.id, dupOf);
      continue;
    }
    const nid = `s2:${p.id}`;
    idMap.set(p.id, nid);
    extraPlots.push({ ...p, id: nid });
  }
  const ref = (r: ScriptFillRef): ScriptFillRef => ('plot' in r ? { plot: idMap.get(r.plot) ?? r.plot } : r);
  const remapFill = (f: ScriptFill): ScriptFill => ({ ...f, a: ref(f.a), b: ref(f.b) });

  const mseen = new Set(a.markers.map((m) => `${m.time}|${m.shape}|${m.text}`));
  const markers = [...a.markers, ...b.markers.filter((m) => !mseen.has(`${m.time}|${m.shape}|${m.text}`))];
  const hseen = new Set(a.hlines.map((h) => `${h.price}|${h.title}`));
  const hlines = [...a.hlines, ...b.hlines.filter((h) => !hseen.has(`${h.price}|${h.title}`))];

  const d1 = a.drawings;
  const d2 = b.drawings;
  const drawings =
    d1 || d2
      ? {
          lines: [...(d1?.lines ?? []), ...(d2?.lines ?? [])],
          boxes: [...(d1?.boxes ?? []), ...(d2?.boxes ?? [])],
          labels: [...(d1?.labels ?? []), ...(d2?.labels ?? [])],
          tables: [...(d1?.tables ?? []), ...(d2?.tables ?? [])],
          linefills: [...(d1?.linefills ?? []), ...(d2?.linefills ?? [])],
          polylines: [...(d1?.polylines ?? []), ...(d2?.polylines ?? [])],
        }
      : undefined;

  return {
    ...a,
    scriptTitle: `${a.scriptTitle} + ${b.scriptTitle}`,
    isStrategy: a.isStrategy || b.isStrategy,
    executionMs: Number((a.executionMs + b.executionMs).toFixed(2)),
    plots: [...a.plots, ...extraPlots],
    markers,
    hlines,
    bgcolors: [...(a.bgcolors ?? []), ...(b.bgcolors ?? [])],
    barcolors: [...(a.barcolors ?? []), ...(b.barcolors ?? [])],
    fills: [...(a.fills ?? []), ...(b.fills ?? []).map(remapFill)],
    ohlcPlots: [...(a.ohlcPlots ?? []), ...(b.ohlcPlots ?? []).map((o) => ({ ...o, id: `s2:${o.id}` }))],
    drawings,
    backtest: a.backtest ?? b.backtest,
    warnings: [...new Set([...(a.warnings ?? []), ...(b.warnings ?? [])])],
    alerts: [...(a.alerts ?? []), ...(b.alerts ?? [])],
    logs: [...(a.logs ?? []), ...(b.logs ?? [])],
  };
}
