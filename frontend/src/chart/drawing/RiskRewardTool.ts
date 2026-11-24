import type { DrawingObject, TimePricePoint } from '../../types/market';
import type { CoordinateMapper } from './TrendlineTool';

export interface RiskRewardMetrics {
  isLong: boolean;
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  reward: number;
  risk: number;
  ratio: number;
  ratioText: string;
  targetPercent: number;
  stopPercent: number;
}

export function calculateRiskReward(
  p1: TimePricePoint,
  p2: TimePricePoint,
  isLong: boolean,
  customStopPrice?: number
): RiskRewardMetrics {
  const entryPrice = p1.price;
  const targetPrice = p2.price;
  const reward = Math.abs(targetPrice - entryPrice);

  let stopPrice = customStopPrice;
  if (stopPrice === undefined) {
    // Default 1:2 Risk-to-Reward ratio (risk is half the reward distance)
    stopPrice = isLong ? entryPrice - reward * 0.5 : entryPrice + reward * 0.5;
  }

  const risk = Math.abs(entryPrice - stopPrice);
  const ratio = risk > 0 ? reward / risk : 0;
  const ratioText = `1 : ${ratio.toFixed(2)}`;

  const targetPercent =
    entryPrice > 0 ? (Math.abs(targetPrice - entryPrice) / entryPrice) * 100 : 0;
  const stopPercent =
    entryPrice > 0 ? (Math.abs(stopPrice - entryPrice) / entryPrice) * 100 : 0;

  return {
    isLong,
    entryPrice,
    targetPrice,
    stopPrice,
    reward,
    risk,
    ratio,
    ratioText,
    targetPercent,
    stopPercent,
  };
}

export class RiskRewardTool {
  public static calculate(
    p1: TimePricePoint,
    p2: TimePricePoint,
    isLong: boolean,
    customStopPrice?: number
  ): RiskRewardMetrics {
    return calculateRiskReward(p1, p2, isLong, customStopPrice);
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

    const isLong = drawing.toolType !== 'short_pos';
    const metrics = calculateRiskReward(p1, p2, isLong);

    const yStop = mapper.priceToY(metrics.stopPrice);
    if (yStop === null) return;

    const leftX = Math.min(x1, x2);
    const boxW = Math.max(70, Math.abs(x2 - x1));

    // 1. Green Target (Take Profit) box
    const rectTarget = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rectTarget.setAttribute('x', String(leftX));
    rectTarget.setAttribute('y', String(Math.min(y1, y2)));
    rectTarget.setAttribute('width', String(boxW));
    rectTarget.setAttribute('height', String(Math.abs(y2 - y1)));
    rectTarget.setAttribute('fill', 'rgba(8, 153, 129, 0.22)');
    rectTarget.setAttribute('stroke', '#089981');
    rectTarget.setAttribute('stroke-width', '1.2');
    svg.appendChild(rectTarget);

    // 2. Red Stop Loss box
    const rectStop = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rectStop.setAttribute('x', String(leftX));
    rectStop.setAttribute('y', String(Math.min(y1, yStop)));
    rectStop.setAttribute('width', String(boxW));
    rectStop.setAttribute('height', String(Math.abs(yStop - y1)));
    rectStop.setAttribute('fill', 'rgba(242, 54, 69, 0.22)');
    rectStop.setAttribute('stroke', '#F23645');
    rectStop.setAttribute('stroke-width', '1.2');
    svg.appendChild(rectStop);

    // 3. Entry horizontal separator line
    const entryLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    entryLine.setAttribute('x1', String(leftX));
    entryLine.setAttribute('y1', String(y1));
    entryLine.setAttribute('x2', String(leftX + boxW));
    entryLine.setAttribute('y2', String(y1));
    entryLine.setAttribute('stroke', '#FFFFFF');
    entryLine.setAttribute('stroke-width', '1.5');
    svg.appendChild(entryLine);

    // 4. Summary Pill Badge
    const badgeText = `${isLong ? 'LONG' : 'SHORT'} R:R ${metrics.ratioText} | Hedef: ${metrics.targetPrice.toFixed(
      2
    )} (+%${metrics.targetPercent.toFixed(1)}) | Stop: ${metrics.stopPrice.toFixed(
      2
    )} (-%${metrics.stopPercent.toFixed(1)})`;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const approxW = badgeText.length * 6.5 + 16;
    const badgeBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    badgeBg.setAttribute('x', String(leftX));
    badgeBg.setAttribute('y', String(y1 - 10));
    badgeBg.setAttribute('rx', '4');
    badgeBg.setAttribute('width', String(approxW));
    badgeBg.setAttribute('height', '20');
    badgeBg.setAttribute('fill', isLong ? '#089981' : '#F23645');
    g.appendChild(badgeBg);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', String(leftX + 8));
    txt.setAttribute('y', String(y1 + 4));
    txt.setAttribute('fill', '#FFFFFF');
    txt.setAttribute('font-size', '10');
    txt.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif");
    txt.setAttribute('font-weight', '700');
    txt.textContent = badgeText;
    g.appendChild(txt);

    svg.appendChild(g);
  }
}
