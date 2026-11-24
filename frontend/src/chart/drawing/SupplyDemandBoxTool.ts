import { tt } from '../../state/i18n';
import type { DrawingObject, TimePricePoint } from '../../types/market';
import type { CoordinateMapper } from './TrendlineTool';

export interface BoxBounds {
  minPrice: number;
  maxPrice: number;
  minTime: number;
  maxTime: number;
  priceHeight: number;
  pctHeight: number;
  zoneType: 'DEMAND' | 'SUPPLY';
}

export function calculateSupplyDemandBounds(
  p1: TimePricePoint,
  p2: TimePricePoint
): BoxBounds {
  const minPrice = Math.min(p1.price, p2.price);
  const maxPrice = Math.max(p1.price, p2.price);
  const minTime = Math.min(p1.time, p2.time);
  const maxTime = Math.max(p1.time, p2.time);
  const priceHeight = maxPrice - minPrice;
  const pctHeight = minPrice > 0 ? (priceHeight / minPrice) * 100 : 0;
  // If drawn upwards, typically demand zone; if downwards, supply zone
  const zoneType = p2.price >= p1.price ? 'DEMAND' : 'SUPPLY';

  return {
    minPrice,
    maxPrice,
    minTime,
    maxTime,
    priceHeight,
    pctHeight,
    zoneType,
  };
}

export class SupplyDemandBoxTool {
  public static calculate(p1: TimePricePoint, p2: TimePricePoint): BoxBounds {
    return calculateSupplyDemandBounds(p1, p2);
  }

  public static render(
    drawing: DrawingObject,
    mapper: CoordinateMapper,
    svg: SVGElement
  ): void {
    if (drawing.points.length < 2) return;
    const p1 = drawing.points[0];
    const p2 = drawing.points[1];

    const x1 = mapper.timeToX(p1.time);
    const y1 = mapper.priceToY(p1.price);
    const x2 = mapper.timeToX(p2.time);
    const y2 = mapper.priceToY(p2.price);

    if (x1 === null || y1 === null || x2 === null || y2 === null) return;

    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.max(6, Math.abs(x2 - x1));
    const rh = Math.max(6, Math.abs(y2 - y1));

    const bounds = calculateSupplyDemandBounds(p1, p2);
    const isDemand = bounds.zoneType === 'DEMAND';
    const defaultColor = isDemand ? '#089981' : '#F23645';
    const strokeColor = drawing.color || defaultColor;
    const fillColor = isDemand
      ? 'rgba(8, 153, 129, 0.16)'
      : 'rgba(242, 54, 69, 0.16)';

    // 1. Zone box
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(rx));
    rect.setAttribute('y', String(ry));
    rect.setAttribute('width', String(rw));
    rect.setAttribute('height', String(rh));
    rect.setAttribute('fill', fillColor);
    rect.setAttribute('stroke', strokeColor);
    rect.setAttribute('stroke-width', '1.2');
    rect.setAttribute('rx', '3');
    svg.appendChild(rect);

    // 2. Zone badge / label
    const label =
      drawing.label ||
      `${isDemand ? tt("Talep Bölgesi") : tt("Arz Bölgesi")} (${bounds.priceHeight.toFixed(2)} | %${bounds.pctHeight.toFixed(1)})`;

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', String(rx + 6));
    txt.setAttribute('y', String(ry + 14));
    txt.setAttribute('fill', strokeColor);
    txt.setAttribute('font-size', '10.5');
    txt.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif");
    txt.setAttribute('font-weight', '700');
    txt.textContent = label;
    svg.appendChild(txt);
  }
}
