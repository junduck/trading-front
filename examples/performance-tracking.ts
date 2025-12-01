/**
 * Example: Real-time performance tracking in backtest
 *
 * Demonstrates how to use performanceTracker middleware to monitor
 * portfolio performance during a backtest session.
 */

import {
  TradingBot,
  BacktestBroker,
  performanceTracker,
  type PerformanceSnapshot,
  type OrderAlgo,
} from "../src/index.js";

// Example: Setup performance tracking
const broker = new BacktestBroker({
  initialCash: 100000,
  commission: 0.001,
});

// Create performance tracker middleware
const perfTracker = performanceTracker({
  initialCapital: 100000,
  riskFreeRate: 0.02, // 2% annual risk-free rate
  stateKey: "perf", // Write to ctx.state["perf"]
});

// Setup bot with performance tracking
const bot = new TradingBot({
  dataProvider: null as any, // Your data provider
  tradeProvider: broker,
});

// Register performance tracking middleware
// IMPORTANT: Add to order route since it tracks trade events
bot.order({
  strategy: [
    perfTracker, // Track performance on every trade

    // Real-time monitoring middleware reads from state
    async (ctx, next) => {
      const perf = ctx.get<PerformanceSnapshot>("perf");
      if (perf) {
        console.log(`[PERFORMANCE UPDATE]`);
        console.log(`  Equity: $${perf.equity.toFixed(2)}`);
        console.log(`  Total Return: ${(perf.totalReturn * 100).toFixed(2)}%`);
        console.log(`  Sharpe Ratio: ${perf.sharpeRatio.toFixed(2)}`);
        console.log(`  Max Drawdown: ${(perf.maxDrawdown * 100).toFixed(2)}%`);
        console.log(`  Total Trades: ${perf.totalTrades}`);
        console.log("---");
      }
      await next();
    },
  ],
});

// Register your trading strategy
bot.market({
  strategy: [
    broker.onMarketData(), // Match orders with market data
    // Your trading strategy here
  ],
});

/**
 * Example: External observability using a capture middleware
 *
 * If you need to access metrics outside the middleware chain,
 * use a simple middleware to extract from state.
 */
let latestPerformance: PerformanceSnapshot | null = null;

const capturePerformance: OrderAlgo = async (ctx, next) => {
  const perf = ctx.get<PerformanceSnapshot>("perf");
  if (perf) {
    latestPerformance = perf;
  }
  await next();
};

// Add to strategy
// bot.order({ strategy: [perfTracker, capturePerformance, ...] });

// After the backtest completes, access final metrics
function getResults() {
  if (!latestPerformance) {
    console.log("No trades executed");
    return;
  }

  console.log("\n=== FINAL RESULTS ===");
  console.log(
    `Total Return: ${(latestPerformance.totalReturn * 100).toFixed(2)}%`
  );
  console.log(`Sharpe Ratio: ${latestPerformance.sharpeRatio.toFixed(2)}`);
  console.log(`Sortino Ratio: ${latestPerformance.sortinoRatio.toFixed(2)}`);
  console.log(`Calmar Ratio: ${latestPerformance.calmarRatio.toFixed(2)}`);
  console.log(
    `Max Drawdown: ${(latestPerformance.maxDrawdown * 100).toFixed(2)}%`
  );
  console.log(
    `Volatility: ${(latestPerformance.volatility * 100).toFixed(2)}%`
  );
  console.log(`Total Trades: ${latestPerformance.totalTrades}`);
  console.log(
    `Total Commission: $${latestPerformance.totalCommission.toFixed(2)}`
  );

  return latestPerformance;
}

/**
 * Example: Using in live trading (same API!)
 *
 * The beauty of this design: same middleware works in live trading
 * for real-time risk monitoring without any code changes.
 */
async function liveTrading() {
  // const liveProvider = new LiveBroker({ ... });

  // Create performance tracker
  const perfTracker = performanceTracker({
    initialCapital: 100000,
    riskFreeRate: 0.02,
    stateKey: "perf",
  });

  // Risk monitoring middleware reads from state
  const riskMonitor: OrderAlgo = async (ctx, next) => {
    const perf = ctx.get<PerformanceSnapshot>("perf");
    if (perf) {
      // Real-time risk monitoring
      if (perf.drawdown > 0.1) {
        console.warn(
          `⚠️  WARNING: Drawdown exceeded 10%: ${(perf.drawdown * 100).toFixed(
            2
          )}%`
        );
        // Could trigger circuit breaker here via ctx.cancelAllOrders()
      }

      if (perf.sharpeRatio < 1.0 && perf.totalTrades > 100) {
        console.warn(
          `⚠️  WARNING: Sharpe ratio below 1.0: ${perf.sharpeRatio.toFixed(2)}`
        );
      }

      // Could send to monitoring dashboard, database, etc.
    }
    await next();
  };

  // Same middleware setup - works identically!
  // bot.order({ strategy: [perfTracker, riskMonitor, ...] });

  // External observability: capture to variable
  let current: PerformanceSnapshot | null = null;
  const capture: OrderAlgo = async (ctx, next) => {
    current = ctx.get<PerformanceSnapshot>("perf") ?? null;
    await next();
  };

  // Live monitoring
  setInterval(() => {
    if (current) {
      console.log(
        `Live Stats: Equity=$${current.equity.toFixed(
          2
        )} Sharpe=${current.sharpeRatio.toFixed(2)}`
      );
    }
  }, 60000); // Every minute
}
