import type { DrawingObject, TimePricePoint } from '../../types/market';

export interface TrendlineMetrics {
  priceDiff: number;
  pctChange: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  timeSpan: number;
  slope: number;
}

export interface CoordinateMapper {
  timeToX(time: number): number | null;
  xToTime(x: number): number | null;
  priceToY(price: number): number | null;
  yToPrice(y: number): number | null;
}

/**
 * Calculates mathematical metrics for a trendline between two time/price points.
 */
export function calculateTrendlineMetrics(
  p1: TimePricePoint,
  p2: TimePricePoint
): TrendlineMetrics {
  const priceDiff = p2.price - p1.price;
  const pctChange = p1.price !== 0 ? (priceDiff / p1.price) * 100 : 0;
  const timeSpan = Math.abs(p2.time - p1.time);
  const timeDelta = p2.time - p1.time;
  const slope = timeDelta !== 0 ? priceDiff / timeDelta : 0;

  let direction: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
  if (Math.abs(priceDiff) > 1e-9) {
    direction = priceDiff > 0 ? 'UP' : 'DOWN';
  }

  return {
    priceDiff,
    pctChange,
    direction,
    timeSpan,
    slope,
  };
}

export class TrendlineTool {
  public static calculate(p1: TimePricePoint, p2: TimePricePoint): TrendlineMetrics {
    return calculateTrendlineMetrics(p1, p2);
  }

  public static render(
    drawing: DrawingObject,
    mapper: CoordinateMapper,
    svg: SVGElement,
    chartWidth: number,
    chartHeight: number
  ): void {
    if (drawing.points.length < 2) return;
    const p1 = drawing.points[0];
    const p2 = drawing.points[1];

    const x1 = mapper.timeToX(p1.time);
    const y1 = mapper.priceToY(p1.price);
    const x2 = mapper.timeToX(p2.time);
    const y2 = mapper.priceToY(p2.price);

    if (x1 === null || y1 === null || x2 === null || y2 === null) return;

    let endX = x2;
    let endY = y2;
    const isRay = drawing.toolType === 'ray';

    if (isRay && x2 !== x1) {
      const slope = (y2 - y1) / (x2 - x1);
      endX = x2 > x1 ? chartWidth : 0;
      endY = y1 + slope * (endX - x1);
    }

    const strokeColor = drawing.color || '#0284C7';
    const metrics = calculateTrendlineMetrics(p1, p2);

    // 1. Trendline SVG path
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(endX));
    line.setAttribute('y2', String(endY));
    line.setAttribute('stroke', strokeColor);
    line.setAttribute('stroke-width', '2');
    svg.appendChild(line);

    // 2. Control point anchor circles
    const makeCircle = (cx: number, cy: number) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', String(cx));
      c.setAttribute('cy', String(cy));
      c.setAttribute('r', '4');
      c.setAttribute('fill', strokeColor);
      c.setAttribute('stroke', '#FFFFFF');
      c.setAttribute('stroke-width', '1');
      return c;
    };
    svg.appendChild(makeCircle(x1, y1));
    svg.appendChild(makeCircle(x2, y2));

    // 3. Percentage and Price Diff Badge
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const sign = metrics.priceDiff >= 0 ? '+' : '';
    const badgeText = `${sign}${metrics.pctChange.toFixed(2)}% (${sign}${metrics.priceDiff.toFixed(2)})`;
    const badgeColor = metrics.priceDiff >= 0 ? '#089981' : '#F23645';

    const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textEl.setAttribute('x', String(midX));
    textEl.setAttribute('y', String(midY - 10));
    textEl.setAttribute('fill', badgeColor);
    textEl.setAttribute('font-size', '11');
    textEl.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif");
    textEl.setAttribute('font-weight', '700');
    textEl.setAttribute('text-anchor', 'middle');
    textEl.textContent = badgeText;
    svg.appendChild(textEl);
  }
}
