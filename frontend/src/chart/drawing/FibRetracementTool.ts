import { tt } from '../../state/i18n';
import type { DrawingObject, TimePricePoint } from '../../types/market';
import type { CoordinateMapper } from './TrendlineTool';

export interface FibLevelDef {
  level: number;
  color: string;
  label?: string;
}

export interface CalculatedFibLevel {
  level: number;
  price: number;
  color: string;
  label: string;
}

export const DEFAULT_FIB_LEVELS: FibLevelDef[] = [
  { level: 0, color: '#787B86', label: '0.0 (100%)' },
  { level: 0.236, color: '#F23645', label: '0.236' },
  { level: 0.382, color: '#FF9800', label: '0.382' },
  { level: 0.5, color: '#089981', label: '0.5' },
  { level: 0.618, color: '#00BCD4', label: tt("0.618 (Altın Oran)") },
  { level: 0.786, color: '#0284C7', label: '0.786' },
  { level: 1, color: '#787B86', label: '1.0 (0%)' },
];

/**
 * Calculates price values for standard Fibonacci retracement levels
 * based on two reference points (Swing High / Swing Low).
 */
export function calculateFibLevels(
  p1: TimePricePoint,
  p2: TimePricePoint,
  levelDefs: FibLevelDef[] = DEFAULT_FIB_LEVELS
): CalculatedFibLevel[] {
  const diff = p2.price - p1.price;

  return levelDefs.map((def) => {
    // Retracement from p2 back toward p1:
    // level = 0 => p2.price
    // level = 1 => p1.price
    const price = p1.price + diff * (1 - def.level);
    return {
      level: def.level,
      price,
      color: def.color,
      label: def.label || `Fib ${def.level}`,
    };
  });
}

export class FibRetracementTool {
  public static calculate(
    p1: TimePricePoint,
    p2: TimePricePoint,
    levels = DEFAULT_FIB_LEVELS
  ): CalculatedFibLevel[] {
    return calculateFibLevels(p1, p2, levels);
  }

  public static render(
    drawing: DrawingObject,
    mapper: CoordinateMapper,
    svg: SVGElement,
    chartWidth: number
  ): void {
    if (drawing.points.length < 2) return;
    const p1 = drawing.points[0];
    const p2 = drawing.points[1];

    const x1 = mapper.timeToX(p1.time);
    const x2 = mapper.timeToX(p2.time);
    if (x1 === null || x2 === null) return;

    const leftX = Math.min(x1, x2);
    const rightX = Math.max(x1, x2);
    const levels = calculateFibLevels(p1, p2);

    // Draw shaded background bands between adjacent levels
    for (let i = 0; i < levels.length - 1; i++) {
      const topLvl = levels[i];
      const botLvl = levels[i + 1];
      const yTop = mapper.priceToY(topLvl.price);
      const yBot = mapper.priceToY(botLvl.price);
      if (yTop === null || yBot === null) continue;

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(leftX));
      rect.setAttribute('y', String(Math.min(yTop, yBot)));
      rect.setAttribute('width', String(Math.max(20, rightX - leftX)));
      rect.setAttribute('height', String(Math.abs(yBot - yTop)));
      rect.setAttribute('fill', topLvl.color);
      rect.setAttribute('fill-opacity', '0.08');
      svg.appendChild(rect);
    }

    // Draw dashed lines and level badges
    for (const fib of levels) {
      const ly = mapper.priceToY(fib.price);
      if (ly === null) continue;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(leftX));
      line.setAttribute('y1', String(ly));
      line.setAttribute('x2', String(Math.max(rightX, chartWidth - 80)));
      line.setAttribute('y2', String(ly));
      line.setAttribute('stroke', fib.color);
      line.setAttribute('stroke-width', '1.2');
      line.setAttribute('stroke-dasharray', '3,3');
      svg.appendChild(line);

      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', String(leftX + 6));
      txt.setAttribute('y', String(ly - 4));
      txt.setAttribute('fill', fib.color);
      txt.setAttribute('font-size', '10');
      txt.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif");
      txt.setAttribute('font-weight', '600');
      txt.textContent = `${fib.level} (${fib.price.toFixed(2)})`;
      svg.appendChild(txt);
    }
  }
}
