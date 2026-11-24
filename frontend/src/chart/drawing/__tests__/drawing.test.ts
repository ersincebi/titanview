import { describe, expect, it } from 'vitest';
import type { Candle, DrawingObject, SymbolQuoteSummary, TimePricePoint } from '../../../types/market';
import { BarReplay } from '../../BarReplay';
import { DrawingManager, formatVolume, snapPriceToCandle } from '../DrawingManager';
import {
  DEFAULT_FIB_LEVELS,
  calculateFibLevels,
  FibRetracementTool,
} from '../FibRetracementTool';
import {
  calculateHorizontalLineMetrics,
  HorizontalLineTool,
} from '../HorizontalLineTool';
import {
  calculateRiskReward,
  RiskRewardTool,
} from '../RiskRewardTool';
import {
  calculateSupplyDemandBounds,
  SupplyDemandBoxTool,
} from '../SupplyDemandBoxTool';
import {
  calculateTrendlineMetrics,
  TrendlineTool,
} from '../TrendlineTool';

describe('Stage 7 — Drawing Tools & Calculations', () => {
  describe('TrendlineTool', () => {
    it('calculates metrics accurately for upward trendline', () => {
      const p1: TimePricePoint = { time: 1000, price: 100 };
      const p2: TimePricePoint = { time: 1500, price: 125 };
      const res = calculateTrendlineMetrics(p1, p2);

      expect(res.priceDiff).toBe(25);
      expect(res.pctChange).toBe(25);
      expect(res.direction).toBe('UP');
      expect(res.timeSpan).toBe(500);
      expect(res.slope).toBe(25 / 500);
    });

    it('calculates metrics accurately for downward trendline', () => {
      const p1: TimePricePoint = { time: 1000, price: 200 };
      const p2: TimePricePoint = { time: 1200, price: 180 };
      const res = TrendlineTool.calculate(p1, p2);

      expect(res.priceDiff).toBe(-20);
      expect(res.pctChange).toBe(-10);
      expect(res.direction).toBe('DOWN');
      expect(res.timeSpan).toBe(200);
    });

    it('handles flat horizontal trendline and zero price safely', () => {
      const p1: TimePricePoint = { time: 1000, price: 150 };
      const p2: TimePricePoint = { time: 2000, price: 150 };
      const res = TrendlineTool.calculate(p1, p2);

      expect(res.priceDiff).toBe(0);
      expect(res.pctChange).toBe(0);
      expect(res.direction).toBe('FLAT');
      expect(res.slope).toBe(0);

      const zeroP1: TimePricePoint = { time: 1000, price: 0 };
      const zeroP2: TimePricePoint = { time: 2000, price: 50 };
      const zeroRes = TrendlineTool.calculate(zeroP1, zeroP2);
      expect(zeroRes.pctChange).toBe(0);
    });
  });

  describe('HorizontalLineTool', () => {
    it('formats price levels correctly', () => {
      const pt: TimePricePoint = { time: 1000, price: 304.567 };
      const res = calculateHorizontalLineMetrics(pt, 2);
      expect(res.price).toBe(304.567);
      expect(res.formattedPrice).toBe('304.57');

      const res4 = HorizontalLineTool.calculate(pt, 4);
      expect(res4.formattedPrice).toBe('304.5670');
    });
  });

  describe('FibRetracementTool', () => {
    it('calculates all 7 standard Fibonacci levels for an uptrend swing', () => {
      // Swing Low at 100 (p1), Swing High at 200 (p2)
      const p1: TimePricePoint = { time: 1000, price: 100 };
      const p2: TimePricePoint = { time: 2000, price: 200 };
      const levels = calculateFibLevels(p1, p2);

      expect(levels.length).toBe(7);

      const byLevel = (lvl: number) => levels.find((l) => l.level === lvl)!.price;

      expect(byLevel(0)).toBeCloseTo(200, 3);
      expect(byLevel(0.236)).toBeCloseTo(176.4, 3);
      expect(byLevel(0.382)).toBeCloseTo(161.8, 3);
      expect(byLevel(0.5)).toBeCloseTo(150, 3);
      expect(byLevel(0.618)).toBeCloseTo(138.2, 3); // Golden ratio retracement
      expect(byLevel(0.786)).toBeCloseTo(121.4, 3);
      expect(byLevel(1.0)).toBeCloseTo(100, 3);
    });

    it('calculates Fibonacci levels for a downtrend swing', () => {
      // Swing High at 200 (p1), Swing Low at 100 (p2)
      const p1: TimePricePoint = { time: 1000, price: 200 };
      const p2: TimePricePoint = { time: 2000, price: 100 };
      const levels = FibRetracementTool.calculate(p1, p2);

      const byLevel = (lvl: number) => levels.find((l) => l.level === lvl)!.price;

      expect(byLevel(0)).toBeCloseTo(100, 3);
      expect(byLevel(0.5)).toBeCloseTo(150, 3);
      expect(byLevel(0.618)).toBeCloseTo(161.8, 3);
      expect(byLevel(1.0)).toBeCloseTo(200, 3);
    });
  });

  describe('SupplyDemandBoxTool', () => {
    it('calculates zone bounds, height and type for demand and supply boxes', () => {
      const p1: TimePricePoint = { time: 1000, price: 150 };
      const p2: TimePricePoint = { time: 2000, price: 180 };
      const demand = calculateSupplyDemandBounds(p1, p2);

      expect(demand.minPrice).toBe(150);
      expect(demand.maxPrice).toBe(180);
      expect(demand.priceHeight).toBe(30);
      expect(demand.pctHeight).toBeCloseTo(20, 2);
      expect(demand.zoneType).toBe('DEMAND');

      const supply = SupplyDemandBoxTool.calculate(
        { time: 2000, price: 180 },
        { time: 3000, price: 160 }
      );
      expect(supply.minPrice).toBe(160);
      expect(supply.maxPrice).toBe(180);
      expect(supply.zoneType).toBe('SUPPLY');
    });
  });

  describe('RiskRewardTool', () => {
    it('calculates Long position risk/reward with default 1:2 ratio', () => {
      const entry: TimePricePoint = { time: 1000, price: 100 };
      const target: TimePricePoint = { time: 2000, price: 120 };
      const res = calculateRiskReward(entry, target, true);

      expect(res.isLong).toBe(true);
      expect(res.entryPrice).toBe(100);
      expect(res.targetPrice).toBe(120);
      expect(res.reward).toBe(20);
      expect(res.stopPrice).toBe(90); // default half reward distance
      expect(res.risk).toBe(10);
      expect(res.ratio).toBe(2.0);
      expect(res.ratioText).toBe('1 : 2.00');
      expect(res.targetPercent).toBe(20);
      expect(res.stopPercent).toBe(10);
    });

    it('calculates Short position risk/reward with default 1:2 ratio', () => {
      const entry: TimePricePoint = { time: 1000, price: 100 };
      const target: TimePricePoint = { time: 2000, price: 80 };
      const res = RiskRewardTool.calculate(entry, target, false);

      expect(res.isLong).toBe(false);
      expect(res.entryPrice).toBe(100);
      expect(res.targetPrice).toBe(80);
      expect(res.reward).toBe(20);
      expect(res.stopPrice).toBe(110);
      expect(res.risk).toBe(10);
      expect(res.ratio).toBe(2.0);
    });

    it('supports custom stop price override', () => {
      const entry: TimePricePoint = { time: 1000, price: 100 };
      const target: TimePricePoint = { time: 2000, price: 130 };
      // custom stop at 90 (risk=10, reward=30 => 1:3 ratio)
      const res = RiskRewardTool.calculate(entry, target, true, 90);
      expect(res.risk).toBe(10);
      expect(res.reward).toBe(30);
      expect(res.ratio).toBe(3.0);
      expect(res.ratioText).toBe('1 : 3.00');
    });
  });

  describe('DrawingManager', () => {
    const mockCandles: Candle[] = [
      { time: 1000, open: 100, high: 110, low: 95, close: 105, volume: 1000 },
      { time: 2000, open: 105, high: 115, low: 102, close: 112, volume: 1200 },
    ];

    const mockMapper = {
      timeToX: (t: number) => (t - 1000) / 2,
      xToTime: (x: number) => 1000 + x * 2,
      priceToY: (p: number) => 500 - p * 2,
      yToPrice: (y: number) => (500 - y) / 2,
      getCandles: () => mockCandles,
    };

    it('snaps price to closest candle OHLC when magnet is used', () => {
      // At time 1000, candle has open:100, high:110, low:95, close:105
      // If user clicks 109 -> closest is high:110
      expect(snapPriceToCandle(109, 1000, mockCandles)).toBe(110);
      // If user clicks 96 -> closest is low:95
      expect(snapPriceToCandle(96, 1000, mockCandles)).toBe(95);
      // If user clicks 101 -> closest is open:100
      expect(snapPriceToCandle(101, 1000, mockCandles)).toBe(100);
      // If user clicks 104.5 -> closest is close:105
      expect(snapPriceToCandle(104.5, 1000, mockCandles)).toBe(105);
      // If time not found, returns original price
      expect(snapPriceToCandle(999, 9999, mockCandles)).toBe(999);
    });

    it('manages drawing lifecycle and 1-point vs 2-point tool inputs', async () => {
      let completedDrawing: DrawingObject | undefined;
      let toolResetCount = 0;

      const mgr = new DrawingManager({
        mapper: mockMapper,
        autoPersist: false,
        onDrawingCompleted: (d) => {
          completedDrawing = d;
        },
        onToolReset: () => {
          toolResetCount++;
        },
      });

      // 1. Single-point tool: 'hline'
      mgr.setTool('hline');
      expect(mgr.getTool()).toBe('hline');
      const hline = mgr.handlePointInput({ time: 1000, price: 105 });
      expect(hline).not.toBeNull();
      expect(hline?.toolType).toBe('hline');
      expect(hline?.points.length).toBe(1);
      expect(mgr.getTool()).toBe('cursor');
      expect(completedDrawing?.toolType).toBe('hline');
      expect(toolResetCount).toBe(1);

      // 2. Two-point tool: 'trendline'
      mgr.setTool('trendline');
      const step1 = mgr.handlePointInput({ time: 1000, price: 100 });
      expect(step1).toBeNull(); // waiting for 2nd point
      expect(mgr.getTool()).toBe('trendline');

      const step2 = mgr.handlePointInput({ time: 2000, price: 115 });
      expect(step2).not.toBeNull();
      expect(step2?.toolType).toBe('trendline');
      expect(step2?.points.length).toBe(2);
      expect(mgr.getTool()).toBe('cursor');
      expect(toolResetCount).toBe(2);

      // 3. Collection state
      expect(mgr.getDrawings().length).toBe(2);

      // 4. Removing drawing by ID
      await mgr.removeDrawingById(step2!.id);
      expect(mgr.getDrawings().length).toBe(1);

      // 5. Magnet mode integration during point input
      mgr.setMagnet(true);
      expect(mgr.isMagnetEnabled()).toBe(true);
      mgr.setTool('hline');
      // Click at 108.8 -> snaps to high:110
      const magnetHline = mgr.handlePointInput({ time: 1000, price: 108.8 });
      expect(magnetHline?.points[0].price).toBe(110);

      // 6. Clear all drawings for current symbol
      await mgr.clearAll();
      expect(mgr.getDrawings().length).toBe(0);

      // 7. Hidden toggle
      mgr.setHidden(true);
      expect(mgr.isHidden()).toBe(true);
      mgr.setHidden(false);
      expect(mgr.isHidden()).toBe(false);
    });
  });

  describe('BarReplay', () => {
    const generateCandles = (count: number): Candle[] => {
      const out: Candle[] = [];
      let price = 100;
      for (let i = 0; i < count; i++) {
        price += (i % 2 === 0 ? 1 : -0.5);
        out.push({
          time: 1700000000 + i * 900,
          open: price - 0.5,
          high: price + 1,
          low: price - 1,
          close: price,
          volume: 1000 + i * 10,
        });
      }
      return out;
    };

    it('initializes slice, advances step-by-step and calculates progress', () => {
      const full = generateCandles(100);
      let steppedBar: Candle | undefined;
      let stateChangedTo = '';

      const replay = new BarReplay({
        defaultSpeed: '2x',
        onStep: (_, next) => {
          steppedBar = next;
        },
        onStateChange: (st) => {
          stateChangedTo = st;
        },
      });

      expect(replay.isActive()).toBe(false);

      // Start at default ~65%
      const sliced = replay.start(full);
      expect(replay.isActive()).toBe(true);
      expect(replay.getState()).toBe('paused');
      expect(stateChangedTo).toBe('paused');
      expect(sliced.length).toBe(65);
      expect(replay.getProgress().current).toBe(65);
      expect(replay.getProgress().total).toBe(100);
      expect(replay.getProgress().percent).toBe(65);

      // Advance 1 step
      const next1 = replay.step();
      expect(next1).not.toBeNull();
      expect(next1?.time).toBe(full[65].time);
      expect(steppedBar?.time).toBe(full[65].time);
      expect(replay.getCurrentCandles().length).toBe(66);
      expect(replay.getProgress().current).toBe(66);

      // Jump to a specific time
      const jumped = replay.jumpToTimestamp(full[80].time);
      expect(jumped.length).toBe(80);
      expect(replay.getCurrentCandles().length).toBe(80);

      // Stop and restore
      const restored = replay.stop();
      expect(restored.length).toBe(100);
      expect(replay.isActive()).toBe(false);
      expect(replay.getState()).toBe('idle');
    });

    it('switches speed and reports speed correctly', () => {
      const replay = new BarReplay({ defaultSpeed: '1x' });
      expect(replay.getSpeed()).toBe('1x');
      replay.setSpeed('5x');
      expect(replay.getSpeed()).toBe('5x');
    });
  });

  describe('Stage 9 — Ruler, Brush, Object Tree and Volume Formatting', () => {
    it('formats volume with B, M, K units accurately', () => {
      expect(formatVolume(2500000000)).toBe('2.50B');
      expect(formatVolume(14200000)).toBe('14.20M');
      expect(formatVolume(78500)).toBe('78.5K');
      expect(formatVolume(620)).toBe('620');
    });

    it('creates and renders ruler with price diff, percentage, bar count and volume', () => {
      const candles: Candle[] = [
        { time: 1000, open: 100, high: 105, low: 98, close: 102, volume: 10000 },
        { time: 1100, open: 102, high: 108, low: 101, close: 107, volume: 15000 },
        { time: 1200, open: 107, high: 115, low: 106, close: 114, volume: 25000 },
      ];

      const mapper = {
        timeToX: (t: number) => t - 900,
        xToTime: (x: number) => x + 900,
        priceToY: (p: number) => 500 - p * 2,
        yToPrice: (y: number) => (500 - y) / 2,
        getCandles: () => candles,
      };

      const manager = new DrawingManager({
        mapper,
        autoPersist: false,
      });

      manager.setTool('ruler');
      manager.handlePointInput({ time: 1000, price: 100 });
      const completed = manager.handlePointInput({ time: 1200, price: 114 });

      expect(completed).not.toBeNull();
      expect(completed?.toolType).toBe('ruler');
      expect(completed?.points).toHaveLength(2);
      expect(completed?.points[0].price).toBe(100);
      expect(completed?.points[1].price).toBe(114);

      // Verify Object Tree holds the drawing
      expect(manager.getDrawings()).toHaveLength(1);
    });

    it('supports Brush tool with freehand points and Object Tree management', () => {
      const mapper = {
        timeToX: (t: number) => t,
        xToTime: (x: number) => x,
        priceToY: (p: number) => p,
        yToPrice: (y: number) => y,
      };

      const manager = new DrawingManager({
        mapper,
        autoPersist: false,
      });

      // Add a brush drawing with multiple points
      const brushObj: DrawingObject = {
        id: 'brush_1',
        symbol: 'THYAO.IS',
        timeframe: '15m',
        toolType: 'brush',
        points: [
          { time: 100, price: 50 },
          { time: 110, price: 55 },
          { time: 120, price: 53 },
          { time: 130, price: 60 },
        ],
        color: '#0284C7',
      };
      void manager.addDrawing(brushObj);

      expect(manager.getDrawings()).toHaveLength(1);
      expect(manager.getDrawings()[0].toolType).toBe('brush');
      expect(manager.getDrawings()[0].points).toHaveLength(4);

      // Test Object Tree toggle visibility
      manager.setHidden(true);
      expect(manager.isHidden()).toBe(true);
      manager.setHidden(false);
      expect(manager.isHidden()).toBe(false);

      // Test removing by ID
      void manager.removeDrawingById('brush_1');
      expect(manager.getDrawings()).toHaveLength(0);
    });

    it('supports interactive drawing selection, color modification, delete, and undo/redo', async () => {
      const mapper = {
        timeToX: (t: number) => t,
        xToTime: (x: number) => x,
        priceToY: (p: number) => p,
        yToPrice: (y: number) => y,
      };

      let selectedCallbackObj: DrawingObject | null = null;
      const manager = new DrawingManager({
        mapper,
        autoPersist: false,
        onSelectionChanged: (d) => {
          selectedCallbackObj = d;
        },
      });

      const d1: DrawingObject = {
        id: 'trend_1',
        symbol: 'THYAO.IS',
        timeframe: '15m',
        toolType: 'trendline',
        points: [
          { time: 100, price: 50 },
          { time: 200, price: 70 },
        ],
        color: '#0284C7',
      };
      await manager.addDrawing(d1);

      // Select drawing
      manager.selectDrawing('trend_1');
      expect(manager.getSelectedDrawingId()).toBe('trend_1');
      expect(manager.getSelectedDrawing()?.id).toBe('trend_1');
      expect((selectedCallbackObj as DrawingObject | null)?.id).toBe('trend_1');

      // Update color
      await manager.updateSelectedDrawingColor('#089981');
      expect(manager.getSelectedDrawing()?.color).toBe('#089981');

      // Undo color change
      manager.undo();
      expect(manager.getDrawings()[0].color).toBe('#0284C7');

      // Redo color change
      manager.redo();
      expect(manager.getDrawings()[0].color).toBe('#089981');

      // Delete selected drawing
      manager.selectDrawing('trend_1');
      await manager.deleteSelectedDrawing();
      expect(manager.getDrawings()).toHaveLength(0);
      expect(manager.getSelectedDrawingId()).toBeNull();
      expect(selectedCallbackObj).toBeNull();
    });
  });
});
