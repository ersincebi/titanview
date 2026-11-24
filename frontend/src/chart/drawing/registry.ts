import type { Candle, DrawingObject, DrawingToolType, TimePricePoint } from '../../types/market';
import {
  barsPatternExtra,
  renderAnchoredVp,
  renderAnchoredVwap,
  renderBarsPattern,
  renderDatePriceRange,
  renderForecast,
  renderGhostFeed,
  renderProjection,
} from './forecast';
import {
  renderAnchoredText,
  renderCallout,
  renderComment,
  renderFlagMark,
  renderIcon,
  renderNote,
  renderPin,
  renderPriceNote,
  renderSignpost,
  renderTable,
  screenPoint,
} from './notes';
import {
  renderAbcd,
  renderCyclicLines,
  renderElliott,
  renderHarmonic,
  renderHeadShoulders,
  renderSineLine,
  renderThreeDrives,
  renderTimeCycles,
  renderTrianglePattern,
} from './patterns';
import {
  regressionHandles,
  renderCrossLine,
  renderDisjointChannel,
  renderFlatChannel,
  renderPitchforkKind,
  renderRegression,
  renderTrendAngle,
} from './channels';
import {
  renderFibChannel,
  renderFibCircles,
  renderFibPitchfan,
  renderFibSpeedArcs,
  renderFibSpeedFan,
  renderFibSpiral,
  renderFibTimezone,
  renderFibTrendTime,
  renderFibWedge,
} from './fibFamily';
import { renderGannBox, renderGannFan, renderGannSquare, squareFixedCorner } from './gann';
import {
  deriveCurveControls,
  renderArc,
  renderArrowMarker,
  renderCircle,
  renderCurve,
  renderHighlighter,
  renderMarkArrow,
  renderPath,
  renderRotatedRect,
  renderTriangle,
} from './shapes';
import { toPx, type Px, type ToolMapper } from './svg';

export type ToolRenderer = (d: DrawingObject, m: ToolMapper, g: SVGElement, w: number, h: number) => void;

export interface ToolDef {
  render: ToolRenderer;
  /** seçim tutamaklarının konumu (varsayılan: her nokta kendi yerinde) */
  handles?: (d: DrawingObject, m: ToolMapper, w?: number, h?: number) => Px[] | null;
  /** tıklamalar bitince eklenecek türetilmiş noktalar (eğri kontrol noktaları) */
  complete?: (pts: TimePricePoint[]) => TimePricePoint[];
  /** tamamlanınca mumlardan türetilen ek alanlar (çubuk deseni anlık görüntüsü); noktaları da değiştirebilir */
  extra?: (pts: TimePricePoint[], candles: Candle[]) => Partial<DrawingObject>;
}

/** Faz 21 araçları. Eski araçlar DrawingManager'daki switch'te kalır. */
export const TOOL_DEFS: Partial<Record<DrawingToolType, ToolDef>> = {
  // çizgiler
  trend_angle: { render: renderTrendAngle },
  cross_line: { render: renderCrossLine },
  // kanallar
  regression: { render: renderRegression, handles: regressionHandles },
  flat_channel: { render: renderFlatChannel },
  disjoint_channel: { render: renderDisjointChannel },
  // pitchfork
  schiff_pitchfork: { render: renderPitchforkKind('schiff') },
  mod_schiff_pitchfork: { render: renderPitchforkKind('mod_schiff') },
  inside_pitchfork: { render: renderPitchforkKind('inside') },
  // fib
  fib_channel: { render: renderFibChannel },
  fib_timezone: { render: renderFibTimezone },
  fib_speed_fan: { render: renderFibSpeedFan },
  fib_trend_time: { render: renderFibTrendTime },
  fib_circles: { render: renderFibCircles },
  fib_spiral: { render: renderFibSpiral },
  fib_speed_arcs: { render: renderFibSpeedArcs },
  fib_wedge: { render: renderFibWedge },
  fib_pitchfan: { render: renderFibPitchfan },
  // gann
  gann_box: { render: renderGannBox },
  gann_square_fixed: {
    render: renderGannSquare(true),
    handles: (d, m) => {
      const a = d.points[0] && toPx(m, d.points[0]);
      const b = d.points[1] && toPx(m, d.points[1]);
      return a && b ? [a, squareFixedCorner(a, b)] : null;
    },
  },
  gann_square: { render: renderGannSquare(false) },
  gann_fan: { render: renderGannFan },
  // şekiller
  highlighter: { render: renderHighlighter },
  arrow_marker: { render: renderArrowMarker },
  arrow_up: { render: renderMarkArrow(true) },
  arrow_down: { render: renderMarkArrow(false) },
  rotated_rect: { render: renderRotatedRect },
  path: { render: renderPath(false) },
  polyline: { render: renderPath(true) },
  circle: { render: renderCircle },
  triangle: { render: renderTriangle },
  arc: { render: renderArc },
  curve: { render: renderCurve('curve'), complete: (p) => [p[0], p[1], ...deriveCurveControls('curve', p[0], p[1])] },
  double_curve: { render: renderCurve('double_curve'), complete: (p) => [p[0], p[1], ...deriveCurveControls('double_curve', p[0], p[1])] },
  // Faz 22: formasyonlar
  xabcd: { render: renderHarmonic },
  cypher: { render: renderHarmonic },
  head_shoulders: { render: renderHeadShoulders },
  abcd: { render: renderAbcd },
  triangle_pattern: { render: renderTrianglePattern },
  three_drives: { render: renderThreeDrives },
  elliott_impulse: { render: renderElliott },
  elliott_correction: { render: renderElliott },
  elliott_triangle: { render: renderElliott },
  elliott_double: { render: renderElliott },
  elliott_triple: { render: renderElliott },
  cyclic_lines: { render: renderCyclicLines },
  time_cycles: { render: renderTimeCycles },
  sine_line: { render: renderSineLine },
  // Faz 22: tahmin
  forecast: { render: renderForecast },
  date_price_range: { render: renderDatePriceRange },
  bars_pattern: { render: renderBarsPattern, extra: (p, c) => barsPatternExtra(p, c) },
  ghost_feed: { render: renderGhostFeed },
  projection: { render: renderProjection },
  anchored_vwap: { render: renderAnchoredVwap },
  anchored_vp: { render: renderAnchoredVp },
  // Faz 22: yazı / not / ikon
  anchored_text: { render: renderAnchoredText, handles: (d, _m, w, h) => (d.points[0] ? [screenPoint(d.points[0], w ?? 1000, h ?? 600)] : null) },
  note: { render: renderNote },
  price_note: { render: renderPriceNote },
  pin: { render: renderPin },
  table: { render: renderTable },
  callout: { render: renderCallout },
  comment: { render: renderComment },
  signpost: { render: renderSignpost },
  flag_mark: { render: renderFlagMark },
  icon: { render: renderIcon },
};

/** Serbest el araçları (sürükleyerek çizilir). */
export const FREEHAND_TOOLS: ReadonlySet<DrawingToolType> = new Set<DrawingToolType>(['brush', 'highlighter']);
