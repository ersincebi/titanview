import { tfmt, tt, localeTag } from '../state/i18n';
import type { CorporateEventsData } from '../types/market';
import type { LayerMapper } from './ScriptLayer';

export interface EventLayerOptions {
  dividends: boolean;
  splits: boolean;
  earnings: boolean;
}

export interface ChartEventMarker {
  id: string;
  kind: 'dividend' | 'split' | 'earnings';
  letter: 'D' | 'S' | 'E';
  time: number;
  dateStr: string;
  color: string;
  title: string;
  subtitle: string;
  detail: string;
  x: number;
  y: number;
}

const DEFAULT_OPTS: EventLayerOptions = {
  dividends: true,
  splits: true,
  earnings: true,
};

function fmtDateTr(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleDateString(localeTag(), {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(ts);
  }
}

/** Yahoo kurumsal olaylarını (Temettü, Bölünme, Bilanço) görünür grafik koordinatlarına yerleştirir. */
export function layoutCorporateEvents(
  events: CorporateEventsData | null,
  m: LayerMapper,
  opts: EventLayerOptions = DEFAULT_OPTS,
  currency = ''
): ChartEventMarker[] {
  if (!events || !events.supported) return [];
  const { width, height } = m.size();
  if (width <= 0 || height <= 0) return [];

  const xOf = (t: number): number | null => {
    const l = m.timeToLogical(t);
    return l === null ? null : m.logicalToX(l);
  };

  const curSym = currency === 'TRY' ? '₺' : currency === 'EUR' ? '€' : '$';
  const raw: Array<Omit<ChartEventMarker, 'x' | 'y'>> = [];

  if (opts.dividends) {
    for (const d of events.dividends ?? []) {
      const ds = fmtDateTr(d.time);
      raw.push({
        id: `div_${d.time}`,
        kind: 'dividend',
        letter: 'D',
        time: d.time,
        dateStr: ds,
        color: '#0284C7',
        title: tt("Temettü Ödemesi"),
        subtitle: ds,
        detail: tfmt("Hisse Başına Brüt Temettü: {0}{1}", curSym, d.amount.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')),
      });
    }
  }

  if (opts.splits) {
    for (const s of events.splits ?? []) {
      const ds = fmtDateTr(s.time);
      const ratio = s.ratio || `${s.numerator}:${s.denominator}`;
      raw.push({
        id: `split_${s.time}`,
        kind: 'split',
        letter: 'S',
        time: s.time,
        dateStr: ds,
        color: '#FF9800',
        title: tt("Hisse Bölünmesi (Split)"),
        subtitle: ds,
        detail: tfmt("Bölünme Oranı: {0} ({1} yeni pay / {2} eski pay)", ratio, s.numerator, s.denominator),
      });
    }
  }

  if (opts.earnings) {
    for (const e of events.earnings ?? []) {
      const ds = fmtDateTr(e.time);
      let color = '#AB47BC';
      let detail = tt("Bilanço / Kazanç Açıklama Tarihi");
      if (e.actual != null && e.estimate != null) {
        const diff = e.actual - e.estimate;
        const surp = e.estimate !== 0 ? ((diff / Math.abs(e.estimate)) * 100).toFixed(2) : '0.00';
        color = diff >= 0 ? '#089981' : '#F23645';
        detail = `HBK Gerçekleşen: ${curSym}${e.actual.toFixed(2)} · Beklenti: ${curSym}${e.estimate.toFixed(2)} · Sürpriz: ${diff >= 0 ? '+' : ''}${surp}%`;
      } else if (e.actual != null) {
        color = '#089981';
        detail = `HBK Gerçekleşen: ${curSym}${e.actual.toFixed(2)}`;
      } else if (e.estimate != null) {
        detail = `HBK Beklenti: ${curSym}${e.estimate.toFixed(2)} (Yaklaşan Bilanço)`;
      }
      raw.push({
        id: `earn_${e.time}`,
        kind: 'earnings',
        letter: 'E',
        time: e.time,
        dateStr: ds,
        color,
        title: tt("Çeyreklik Bilanço & Kazanç"),
        subtitle: ds,
        detail,
      });
    }
  }

  raw.sort((a, b) => a.time - b.time);

  const out: ChartEventMarker[] = [];
  // Track X buckets so two events on the same bar stack vertically instead of overlapping.
  const xStacks = new Map<number, number>();
  const baseY = Math.max(20, height - 14);

  for (const item of raw) {
    const x = xOf(item.time);
    if (x === null || x < -20 || x > width + 20) continue;
    const bucket = Math.round(x / 18);
    const stackIdx = xStacks.get(bucket) ?? 0;
    xStacks.set(bucket, stackIdx + 1);
    const y = Math.max(16, baseY - stackIdx * 20);
    out.push({
      ...item,
      x: Math.round(x * 10) / 10,
      y,
    });
  }

  return out;
}

export class EventLayer {
  private wrap: HTMLDivElement;
  private popover: HTMLDivElement;
  private events: CorporateEventsData | null = null;
  private opts: EventLayerOptions = { ...DEFAULT_OPTS };
  private currency = 'USD';
  private activeId: string | null = null;

  constructor(
    host: HTMLElement,
    private mapper: LayerMapper
  ) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'titan-event-layer';
    this.wrap.id = 'chart-events-strip';
    this.popover = document.createElement('div');
    this.popover.className = 'chart-event-popover';
    this.popover.id = 'chart-event-popover';
    this.popover.style.display = 'none';
    host.appendChild(this.wrap);
    host.appendChild(this.popover);
  }

  public setEvents(events: CorporateEventsData | null, currency = 'USD', opts?: Partial<EventLayerOptions>): void {
    this.events = events;
    this.currency = currency;
    if (opts) this.opts = { ...this.opts, ...opts };
    this.activeId = null;
    this.popover.style.display = 'none';
    this.render();
  }

  public setOptions(opts: Partial<EventLayerOptions>): void {
    this.opts = { ...this.opts, ...opts };
    this.render();
  }

  public getOptions(): EventLayerOptions {
    return { ...this.opts };
  }

  public count(): number {
    return this.wrap.childElementCount;
  }

  public destroy(): void {
    this.wrap.remove();
    this.popover.remove();
    this.events = null;
  }

  private showPopover(m: ChartEventMarker, width: number): void {
    this.activeId = m.id;
    this.popover.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'cep-head';
    const badge = document.createElement('span');
    badge.className = `cep-badge cep-${m.kind}`;
    badge.style.background = m.color;
    badge.textContent = m.letter;
    const title = document.createElement('strong');
    title.textContent = m.title;
    const date = document.createElement('span');
    date.className = 'cep-date';
    date.textContent = m.subtitle;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cep-close';
    closeBtn.textContent = '✕';
    closeBtn.onclick = (ev) => {
      ev.stopPropagation();
      this.activeId = null;
      this.popover.style.display = 'none';
    };
    head.append(badge, title, date, closeBtn);

    const body = document.createElement('div');
    body.className = 'cep-body';
    body.textContent = m.detail;

    this.popover.append(head, body);
    this.popover.style.display = 'block';
    const left = Math.max(8, Math.min(width - 250, m.x - 110));
    this.popover.style.left = `${left}px`;
    this.popover.style.bottom = `${Math.max(34, this.mapper.size().height - m.y + 16)}px`;
  }

  public render(): void {
    this.wrap.innerHTML = '';
    const { width, height } = this.mapper.size();
    if (width <= 0 || height <= 0 || !this.events || !this.events.supported) {
      this.popover.style.display = 'none';
      return;
    }
    this.wrap.style.width = `${width}px`;
    this.wrap.style.height = `${height}px`;
    this.wrap.style.top = `${this.mapper.top?.() ?? 0}px`;

    const markers = layoutCorporateEvents(this.events, this.mapper, this.opts, this.currency);
    let activeMarker: ChartEventMarker | null = null;

    for (const m of markers) {
      if (m.id === this.activeId) activeMarker = m;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chart-event-badge ev-${m.kind}${m.id === this.activeId ? ' active' : ''}`;
      btn.dataset.eventId = m.id;
      btn.dataset.eventKind = m.kind;
      btn.title = `${m.title} (${m.subtitle}) — ${m.detail}`;
      btn.style.left = `${m.x}px`;
      btn.style.top = `${m.y}px`;
      btn.style.borderColor = m.color;
      btn.style.color = '#fff';
      btn.style.background = m.color;
      btn.textContent = m.letter;
      btn.onclick = (ev) => {
        ev.stopPropagation();
        if (this.activeId === m.id && this.popover.style.display !== 'none') {
          this.activeId = null;
          this.popover.style.display = 'none';
        } else {
          this.showPopover(m, width);
        }
      };
      btn.onmouseenter = () => {
        this.showPopover(m, width);
      };
      this.wrap.appendChild(btn);
    }

    if (activeMarker && this.popover.style.display !== 'none') {
      const left = Math.max(8, Math.min(width - 250, activeMarker.x - 110));
      this.popover.style.left = `${left}px`;
    } else if (!activeMarker) {
      this.popover.style.display = 'none';
    }
  }
}
