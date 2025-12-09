import { describe, it, expect } from "vitest";
import { indicator } from "../src/algorithms/indicator.js";
import { Context } from "../src/core/Context.js";
import type { MarketEvent } from "../src/types/Events.js";
import type { Position } from "@junduck/trading-core";
import { Snapshot } from "../src/core/Snapshot.js";

describe("indicator", () => {
  const mockDataProvider = {} as any;
  const mockTradeProvider = {
    genOrderId: () => "test-order-id",
  } as any;
  const mockLogger = {} as any;

  const createContext = (marketData: any[]): Context<MarketEvent> => {
    const event: MarketEvent = {
      type: "market",
      timestamp: new Date(),
      marketData,
    };

    const position: Position = {
      cash: 10000,
      holdings: [],
      totalCommission: 0,
      realisedPnL: 0,
    };

    const snapshot = new Snapshot(position, event.marketData);

    return new Context({
      event,
      position,
      snapshot,
      dataProvider: mockDataProvider,
      tradeProvider: mockTradeProvider,
      logger: mockLogger,
    });
  };

  it("should calculate RSI indicator values", () => {
    const rsiMiddleware = indicator("RSI", {
      indicatorOpts: { period: 14 },
    });

    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    // Simulate price data for AAPL
    const prices = [100, 102, 101, 103, 105, 104, 106, 108, 107, 109, 111, 110, 112, 114, 113];

    for (const price of prices) {
      const ctx = createContext([
        { symbol: "AAPL", price, timestamp: new Date() },
      ]);

      rsiMiddleware(ctx, next);

      const rsiValues = ctx.state.get("RSI") as Map<string, number>;
      expect(rsiValues).toBeInstanceOf(Map);
      expect(rsiValues.has("AAPL")).toBe(true);
      expect(nextCalled).toBe(true);
      nextCalled = false;
    }
  });

  it("should handle multiple symbols independently", () => {
    const smaMiddleware = indicator("SMA", {
      indicatorOpts: { period: 3 },
      stateKey: "sma3",
    });

    const ctx = createContext([
      { symbol: "AAPL", price: 150, timestamp: new Date() },
      { symbol: "TSLA", price: 200, timestamp: new Date() },
    ]);

    let nextCalled = false;
    smaMiddleware(ctx, () => {
      nextCalled = true;
    });

    const smaValues = ctx.state.get("sma3") as Map<string, number>;
    expect(smaValues).toBeInstanceOf(Map);
    expect(smaValues.has("AAPL")).toBe(true);
    expect(smaValues.has("TSLA")).toBe(true);
    expect(nextCalled).toBe(true);
  });

  it("should use custom state key", () => {
    const emaMiddleware = indicator("EMA", {
      indicatorOpts: { period: 10 },
      stateKey: "myCustomEMA",
    });

    const ctx = createContext([
      { symbol: "AAPL", price: 150, timestamp: new Date() },
    ]);

    emaMiddleware(ctx, () => {});

    expect(ctx.state.has("myCustomEMA")).toBe(true);
    expect(ctx.state.has("EMA")).toBe(false);
  });

  it("should default state key to indicator name", () => {
    const emaMiddleware = indicator("EMA", {
      indicatorOpts: { period: 10 },
    });

    const ctx = createContext([
      { symbol: "AAPL", price: 150, timestamp: new Date() },
    ]);

    emaMiddleware(ctx, () => {});

    expect(ctx.state.has("EMA")).toBe(true);
  });

  it("should maintain state across multiple events for same symbol", () => {
    const smaMiddleware = indicator("SMA", {
      indicatorOpts: { period: 3 },
    });

    const prices = [100, 110, 120];
    const smaValues: number[] = [];

    for (const price of prices) {
      const ctx = createContext([
        { symbol: "AAPL", price, timestamp: new Date() },
      ]);

      smaMiddleware(ctx, () => {});

      const values = ctx.state.get("SMA") as Map<string, number>;
      smaValues.push(values.get("AAPL")!);
    }

    // After 3 prices, SMA should be (100 + 110 + 120) / 3 = 110
    expect(smaValues[2]).toBeCloseTo(110, 1);
  });

  it("should throw error for invalid indicator name", () => {
    expect(() => {
      indicator("InvalidIndicator" as any);
    }).toThrow('Indicator "InvalidIndicator" not found');
  });
});
