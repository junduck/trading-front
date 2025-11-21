/**
 * MACD-based trading strategy with backtesting
 *
 * Demonstrates composable middleware architecture:
 * 1. macd() - Calculates MACD indicator and writes to state.macd
 * 2. crossover() - Detects crossovers and writes to state.crossover
 * 3. Strategy - Reads state.crossover and executes trades
 *
 * Strategy:
 * - Buy with all available cash when MACD histogram crosses above 0 (bullish signal)
 * - Sell all holdings when MACD histogram crosses below 0 (bearish signal)
 * - Trade symbol "000001" using market orders
 * - Uses 5-minute OHLCV data from JSON file
 */

import {
  TradingBot,
  macd,
  crossover,
  type CrossoverValue,
} from "../src/index.js";
import { BacktestProvider } from "../src/providers-backtest/BacktestProvider.js";
import {
  JsonDataProvider,
  useUnixEpochExtractor,
} from "../src/providers-data/JsonDataProvider.js";
import type { MarketEvent, OrderEvent } from "../src/types/Events.js";
import { appraisePosition } from "@junduck/trading-core";

async function main() {
  console.log("🚀 MACD Trading Strategy Backtest\n");

  // Create data provider loading from JSON file
  const dataProvider = new JsonDataProvider({
    filePath: "./fixtures/ohlcv-5m-000001.json",
    mapping: {
      timestampField: useUnixEpochExtractor("timestamp", "s"),
    },
  });

  // Create backtest provider with initial capital
  const tradeProvider = new BacktestProvider({
    initialCash: 100000,
    commissionRate: 0.0003, // 0.03% commission
  });

  // Create trading bot
  const bot = new TradingBot({
    dataProvider,
    tradeProvider,
    symbols: ["000001"],
  });

  // Composable middleware pipeline:
  // 1. BacktestProvider processes orders on market data
  bot.use(tradeProvider.onMarketData());

  // 2. MACD calculates indicator values -> state.macd
  bot.use(macd());

  // 3. Crossover detects signals -> state.crossover
  bot.use(crossover());

  // Track position for order sizing
  let position = 0;
  let eventCount = 0;
  let tradeCount = 0;

  // Trading strategy: Read state.crossover and execute trades
  bot.market({
    symbol: "000001",
    strategy: [
      async (ctx) => {
        const event = ctx.event as MarketEvent;

        // Read crossover signals from state (written by crossover middleware)
        const crossoverSignals = ctx.state.get("crossover") as
          | Map<string, CrossoverValue>
          | undefined;
        const signal = crossoverSignals?.get("000001");

        if (!signal) return;

        eventCount++;
        const price = ctx.snapshot.price.get("000001");
        if (!price) return;

        // Print crossover signals for first few events and periodically
        if (eventCount <= 5 || eventCount % 500 === 0) {
          console.log(
            `[${eventCount}] ${event.timestamp.toISOString()} Price: ¥${price.toFixed(
              2
            )}, Signal: ${signal.signal}, Hist: ${signal.current.toFixed(4)}`
          );
        }

        // Execute on bullish crossover: buy with all cash
        if (signal.signal === "bullish" && position === 0) {
          const cash = ctx.position.cash;

          if (cash < 100) {
            console.log(
              `[${event.timestamp.toISOString()}] ⏭️  Insufficient cash: ¥${cash.toFixed(
                2
              )}`
            );
            return;
          }

          const quantity = Math.floor(cash / price);

          if (quantity > 0) {
            tradeCount++;
            const cost = quantity * price;
            console.log(
              `[${event.timestamp.toISOString()}] 🟢 BUY SIGNAL (crossover: bullish, hist: ${signal.current.toFixed(
                4
              )})`
            );
            console.log(
              `   Buying ${quantity} shares @ ¥${price.toFixed(
                2
              )} = ¥${cost.toFixed(2)}`
            );

            ctx.buyMarket("000001", quantity);
          }
        }

        // Execute on bearish crossover: sell all holdings
        if (signal.signal === "bearish" && position > 0) {
          tradeCount++;
          const proceeds = position * price;
          console.log(
            `[${event.timestamp.toISOString()}] 🔴 SELL SIGNAL (crossover: bearish, hist: ${signal.current.toFixed(
              4
            )})`
          );
          console.log(
            `   Selling ${position} shares @ ¥${price.toFixed(
              2
            )} = ¥${proceeds.toFixed(2)}`
          );

          ctx.sellMarket("000001", position);
        }
      },
    ],
  });

  // Track position updates from filled orders
  bot.order({
    status: "FILLED",
    strategy: [
      async (ctx) => {
        const event = ctx.event as OrderEvent;
        const state = event.state;

        if (!state || state.symbol !== "000001") return;

        const qty = state.filledQuantity ?? 0;

        if (state.side === "BUY") {
          position += qty;
          console.log(`   ✓ Position: ${position} shares`);
        } else if (state.side === "SELL") {
          position -= qty;
          console.log(`   ✓ Position: ${position} shares`);
        }
      },
    ],
  });

  // Event listeners
  bot.on("started", () => {
    console.log("✅ Trading bot started\n");
  });

  bot.on("stopped", () => {
    console.log("\n🛑 Trading bot stopped");
  });

  bot.on("error", (error: any) => {
    console.error("\n❌ Error:", error);
  });

  // Start backtest
  await bot.start();

  console.log("📊 Initial State:");
  console.log(`   Cash: ¥${bot.getPosition().cash.toFixed(2)}`);
  console.log(`   Position: ${position} shares\n`);

  console.log("🎬 Running backtest...\n");

  // Backtest runs synchronously in begin(), so this waits for completion
  // (No need to wait for "stopped" event separately)

  // Print final results
  const finalPosition = bot.getPosition();
  const finalSnapshot = bot.getSnapshot();
  const totalEquity = appraisePosition(finalPosition, finalSnapshot);
  const totalReturn = ((totalEquity - 100000) / 100000) * 100;

  console.log("\n📊 Final Results:");
  console.log(`   Events Processed: ${eventCount}`);
  console.log(`   Trades Executed: ${tradeCount}`);
  console.log(`   Cash: ¥${finalPosition.cash.toFixed(2)}`);
  console.log(`   Position: ${position} shares`);
  console.log(
    `   Total Commission: ¥${finalPosition.totalCommission.toFixed(2)}`
  );
  console.log(`   Realized PnL: ¥${finalPosition.realisedPnL.toFixed(2)}`);
  console.log(`   Total Equity: ¥${totalEquity.toFixed(2)}`);
  console.log(`   Total Return: ${totalReturn.toFixed(2)}%`);

  await bot.stop();

  console.log("\n✨ Backtest completed!\n");
}

// Run the example
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
