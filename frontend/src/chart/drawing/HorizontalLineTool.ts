import type { DrawingObject, TimePricePoint } from '../../types/market';
import type { CoordinateMapper } from './TrendlineTool';

export interface HorizontalLineMetrics {
  price: number;
  formattedPrice: string;
}

export function calculateHorizontalLineMetrics(
  point: TimePricePoint,
  decimals = 2
): HorizontalLineMetrics {
  return {
    price: point.price,
    formattedPrice: point.price.toFixed(decimals),
  };
}

export class HorizontalLineTool {
  public static calculate(point: TimePricePoint, decimals = 2): HorizontalLineMetrics {
    return calculateHorizontalLineMetrics(point, decimals);
  }

  public static render(
    drawing: DrawingObject,
    mapper: CoordinateMapper,
    svg: SVGElement,
    chartWidth: number,
    chartHeight: number
  ): void {
    if (drawing.points.length < 1) return;
    const pt = drawing.points[0];

    if (drawing.toolType === 'vline') {
      const x = mapper.timeToX(pt.time);
      if (x === null) return;
      const vline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      vline.setAttribute('x1', String(x));
      vline.setAttribute('y1', '0');
      vline.setAttribute('x2', String(x));
      vline.setAttribute('y2', String(chartHeight));
      vline.setAttribute('stroke', drawing.color || '#AB47BC');
      vline.setAttribute('stroke-width', '1.5');
      vline.setAttribute('stroke-dasharray', '4,4');
      svg.appendChild(vline);
      return;
    }

    const y = mapper.priceToY(pt.price);
    if (y === null) return;

    const color = drawing.color || '#FFD54F';
    const metrics = calculateHorizontalLineMetrics(pt);

    // 1. Horizontal dashed line across entire chart width
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', String(y));
    line.setAttribute('x2', String(chartWidth));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '6,4');
    svg.appendChild(line);

    // 2. Right badge pill near price scale
    const labelText = drawing.label || `S/R: ${metrics.formattedPrice}`;
    const badgeW = labelText.length * 7 + 16;
    const badgeX = Math.max(10, chartWidth - badgeW - 10);
    const badgeY = y - 18;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(badgeX));
    rect.setAttribute('y', String(badgeY));
    rect.setAttribute('rx', '4');
    rect.setAttribute('width', String(badgeW));
    rect.setAttribute('height', '20');
    rect.setAttribute('fill', '#1E222D');
    rect.setAttribute('stroke', color);
    rect.setAttribute('stroke-width', '1');
    g.appendChild(rect);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', String(badgeX + 8));
    txt.setAttribute('y', String(badgeY + 14));
    txt.setAttribute('fill', color);
    txt.setAttribute('font-size', '10.5');
    txt.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif");
    txt.setAttribute('font-weight', '700');
    txt.textContent = labelText;
    g.appendChild(txt);

    svg.appendChild(g);
  }
}
