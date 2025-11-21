import { describe, it, expect } from "vitest";
import type { Algorithm } from "../src/core/compose.js";
import {
  createMockContext,
  createMarketEvent,
  createMultiMarketEvent,
  MockNext,
  createCashPosition,
} from "./utils/MockContext.js";

/**
 * Demonstration test suite showing how to test middleware/algorithms
 * without setting up a full backtest pipeline.
 */
describe("MockContext testing facility demo", () => {
  describe("Testing state manipulation", () => {
    it("tests middleware that sets state and calls next()", async () => {
      // Example middleware that calculates and stores a simple indicator
      const simpleIndicatorMiddleware: Algorithm = async (ctx, next) => {
        if (ctx.event.type === "market") {
          const price = ctx.snapshot.price.get("AAPL");
          if (price !== undefined) {
            // Store indicator in state
            ctx.state.set("simpleMA", price * 1.1);
          }
        }
        await next();
      };

      // Create mock context with market event
      const ctx = createMockContext({
        event: createMarketEvent("AAPL", 100),
      });
      const next = new MockNext();

      // Execute middleware
      await simpleIndicatorMiddleware(ctx, next.fn);

      // Verify side effects
      expect(next.called).toBe(true);
      expect(ctx.state.get("simpleMA")).toBeCloseTo(110);
      expect(ctx.getPendingActions()).toHaveLength(0);
    });

    it("tests middleware chain with state passing", async () => {
      // First middleware: calculate indicator
      const indicatorMw: Algorithm = async (ctx, next) => {
        if (ctx.event.type === "market") {
          const price = ctx.snapshot.price.get("AAPL");
          if (price) {
            ctx.state.set("sma", price);
            ctx.state.set("trend", price > 100 ? "bullish" : "bearish");
          }
        }
        await next();
      };

      // Second middleware: read indicator from state
      const strategyMw: Algorithm = async (ctx, next) => {
        const trend = ctx.state.get("trend");
        const sma = ctx.state.get("sma");

        expect(trend).toBe("bullish");
        expect(sma).toBe(150);

        await next();
      };

      const ctx = createMockContext({
        event: createMarketEvent("AAPL", 150),
      });
      const next = new MockNext();

      // Execute middleware chain
      await indicatorMw(ctx, async () => {
        await strategyMw(ctx, next.fn);
      });

      expect(next.called).toBe(true);
    });

    it("tests middleware with pre-populated state", async () => {
      // Middleware that reads state from previous middleware
      const strategyMw: Algorithm = async (ctx, next) => {
        const signal = ctx.state.get("signal") as string;

        if (signal === "buy") {
          ctx.buyMarket("AAPL", 100);
        }

        await next();
      };

      // Create context with pre-populated state
      const initialState = new Map<string, unknown>();
      initialState.set("signal", "buy");

      const ctx = createMockContext({
        event: createMarketEvent("AAPL", 150),
        initialState,
      });
      const next = new MockNext();

      await strategyMw(ctx, next.fn);

      expect(next.called).toBe(true);
      expect(ctx.getPendingActions()).toHaveLength(1);
    });
  });

  describe("Testing order creation", () => {
    it("tests middleware that creates market orders", async () => {
      // Trading strategy middleware
      const buyStrategy: Algorithm = async (ctx, next) => {
        if (ctx.event.type === "market") {
          const price = ctx.snapshot.price.get("AAPL");
          if (price && price < 120) {
            ctx.buyMarket("AAPL", 100);
          }
        }
        await next();
      };

      const ctx = createMockContext({
        event: createMarketEvent("AAPL", 110),
        position: createCashPosition(50000),
      });
      const next = new MockNext();

      await buyStrategy(ctx, next.fn);

      // ✨ Simplified assertions with MockContext
      expect(next.called).toBe(true);
      expect(ctx.hasBuyOrder("AAPL")).toBe(true);
      expect(ctx.getSubmittedOrders()).toHaveLength(1);
      expect(ctx.getSubmittedOrders()[0].quantity).toBe(100);
      expect(ctx.getSubmittedOrders()[0].type).toBe("MARKET");
    });

    it("tests middleware that creates limit orders", async () => {
      const limitOrderStrategy: Algorithm = async (ctx, next) => {
        if (ctx.event.type === "market") {
          const price = ctx.snapshot.price.get("AAPL");
          if (price) {
            // Buy at 5% below current price
            ctx.buy("AAPL", 100, price * 0.95);
          }
        }
        await next();
      };

      const ctx = createMockContext({
        event: createMarketEvent("AAPL", 100),
      });

      await limitOrderStrategy(ctx, async () => {});

      // ✨ Simplified access to submitted orders
      expect(ctx.getSubmittedOrders()).toHaveLength(1);
      const order = ctx.getSubmittedOrders()[0];
      expect(order.type).toBe("LIMIT");
      expect(order.price).toBe(95);
      expect(order.quantity).toBe(100);
    });

    it("tests middleware that creates multiple orders", async () => {
      const multiOrderStrategy: Algorithm = async (ctx, next) => {
        if (ctx.event.type === "market") {
          // Buy multiple symbols
          ctx.buyMarket("AAPL", 100);
          ctx.buyMarket("GOOGL", 50);
          ctx.buyMarket("MSFT", 75);
        }
        await next();
      };

      const ctx = createMockContext({
        event: createMultiMarketEvent([
          ["AAPL", 150],
          ["GOOGL", 2800],
          ["MSFT", 380],
        ]),
      });
      const next = new MockNext();

      await multiOrderStrategy(ctx, next.fn);

      // ✨ Simplified checks for multiple orders
      expect(next.called).toBe(true);
      expect(ctx.getBuyOrders()).toHaveLength(3);
      expect(ctx.hasBuyOrder("AAPL")).toBe(true);
      expect(ctx.hasBuyOrder("GOOGL")).toBe(true);
      expect(ctx.hasBuyOrder("MSFT")).toBe(true);

      // Check specific order details
      expect(ctx.getOrdersForSymbol("AAPL")[0].quantity).toBe(100);
      expect(ctx.getOrdersForSymbol("GOOGL")[0].quantity).toBe(50);
    });

    it("tests middleware that cancels orders", async () => {
      const cancelStrategy: Algorithm = async (ctx, next) => {
        // Cancel specific order
        ctx.cancelOrder("order-123", "risk");
        await next();
      };

      const ctx = createMockContext({
        event: createMarketEvent("AAPL", 100),
      });
      const next = new MockNext();

      await cancelStrategy(ctx, next.fn);

      // ✨ Simplified cancel checking
      expect(ctx.getCancelledOrderIds()).toContain("order-123");
      expect(ctx.getActionCount()).toBe(1);
    });
  });

  describe("Testing next() behavior", () => {
    it("tests middleware that doesn't call next() (circuit breaker)", async () => {
      // Risk management middleware that stops the chain
      const circuitBreaker: Algorithm = async (ctx, next) => {
        if (ctx.event.type === "market") {
          const price = ctx.snapshot.price.get("AAPL");
          // Circuit breaker: if price drops too much, don't execute strategies
          if (price && price < 50) {
            ctx.cancelAllOrders("risk");
            // Don't call next() - stop the middleware chain
            return;
          }
        }
        await next();
      };

      const ctx = createMockContext({
        event: createMarketEvent("AAPL", 30),
      });
      const next = new MockNext();

      await circuitBreaker(ctx, next.fn);

      // ✨ Simplified circuit breaker verification
      expect(next.called).toBe(false);
      expect(ctx.hasCancelAllOrders()).toBe(true);
    });

    it("tests middleware that conditionally calls next()", async () => {
      const conditionalMw: Algorithm = async (ctx, next) => {
        if (ctx.event.type === "market") {
          await next();
        }
        // Skip next() for non-market events
      };

      // Test with market event - should call next()
      const marketCtx = createMockContext({
        event: createMarketEvent("AAPL", 100),
      });
      const marketNext = new MockNext();

      await conditionalMw(marketCtx, marketNext.fn);
      expect(marketNext.called).toBe(true);

      // Test with order event - should NOT call next()
      const orderCtx = createMockContext({
        event: {
          type: "order",
          timestamp: new Date(),
          state: undefined,
        },
      });
      const orderNext = new MockNext();

      await conditionalMw(orderCtx, orderNext.fn);
      expect(orderNext.called).toBe(false);
    });
  });

  describe("Testing with multiple symbols", () => {
    it("tests multi-symbol strategy", async () => {
      const multiSymbolStrategy: Algorithm = async (ctx, next) => {
        if (ctx.event.type === "market") {
          // Buy symbols that are below 150
          for (const quote of ctx.event.marketData) {
            if (quote.price && quote.price < 150) {
              ctx.buyMarket(quote.symbol, 100);
            }
          }
        }
        await next();
      };

      const ctx = createMockContext({
        event: createMultiMarketEvent([
          ["AAPL", 140], // Buy
          ["GOOGL", 2800], // Skip
          ["MSFT", 120], // Buy
          ["TSLA", 200], // Skip
        ]),
      });
      const next = new MockNext();

      await multiSymbolStrategy(ctx, next.fn);

      // ✨ Simplified multi-symbol checks
      expect(ctx.getBuyOrders()).toHaveLength(2);
      expect(ctx.hasBuyOrder("AAPL")).toBe(true);
      expect(ctx.hasBuyOrder("MSFT")).toBe(true);
      expect(ctx.hasBuyOrder("GOOGL")).toBe(false); // Not bought
      expect(ctx.hasBuyOrder("TSLA")).toBe(false); // Not bought
    });
  });

  describe("Testing with position state", () => {
    it("tests strategy that considers current position", async () => {
      const positionAwareStrategy: Algorithm = async (ctx, next) => {
        const cash = ctx.position.cash;

        if (cash > 10000) {
          ctx.buyMarket("AAPL", 100);
        }

        await next();
      };

      // Test with sufficient cash
      const richCtx = createMockContext({
        event: createMarketEvent("AAPL", 100),
        position: createCashPosition(50000),
      });

      await positionAwareStrategy(richCtx, async () => {});

      // ✨ Simplified order checking
      expect(richCtx.hasBuyOrder("AAPL")).toBe(true);

      // Test with insufficient cash
      const poorCtx = createMockContext({
        event: createMarketEvent("AAPL", 100),
        position: createCashPosition(5000),
      });

      await positionAwareStrategy(poorCtx, async () => {});

      // ✨ Simplified negative check
      expect(poorCtx.hasBuyOrder("AAPL")).toBe(false);
      expect(poorCtx.getActionCount()).toBe(0);
    });
  });
});
