/**
 * MACD-based trading strategy with synchronous backtesting
 *
 * Demonstrates composable middleware architecture with synchronous execution:
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

import { macd } from "./algorithms/macd.js";
import {
  TradingBotSync,
  crossover,
  maxQty,
  type CrossoverValue,
} from "../src/index.js";
import { BacktestBrokerSync } from "../src/providers-backtest/BacktestBrokerSync.js";
import {
  JsonDataProviderSync,
  useUnixEpochExtractor,
} from "../src/providers-data/JsonDataProviderSync.js";
import { q } from "@junduck/trading-core";

function main() {
  console.log("🚀 MACD Trading Strategy Backtest (Sync)\n");

  // Create data provider loading from JSON file
  const dataProvider = new JsonDataProviderSync({
    filePath: "fixtures/ohlcv-5m-000001.json",
    mapping: {
      timestampField: useUnixEpochExtractor("timestamp", "s"),
    },
  });

  // Create backtest provider with initial capital
  const tradeProvider = new BacktestBrokerSync({
    initialCash: 100000,
    commission: { rate: 0.0003 }, // 0.03% commission
  });

  // Create trading bot
  const bot = new TradingBotSync({
    dataProvider,
    tradeProvider,
    symbols: ["000001"],
  });

  let eventCount = 0;
  let tradeCount = 0;

  // Register backtest market data processor
  bot.pre("market").use(tradeProvider.onMarketData());

  // Composable middleware pipeline:
  bot.on("market").use(macd(), crossover(), (ctx) => {
    const event = ctx.event;

    // Read crossover signal from state (written by crossover middleware)
    const signal = ctx.get<CrossoverValue>("crossover", "000001");
    if (!signal) return;

    eventCount++;
    const price = ctx.price("000001");
    if (!price) return;

    // Execute on bullish crossover: buy with all cash
    const currentPosition = ctx.holdingQty("000001");

    if (signal.signal === "bullish" && currentPosition === 0) {
      const quantity = maxQty(ctx.position, price);

      if (quantity > 0) {
        tradeCount++;
        ctx.buyMarket("000001", quantity);
      }
    }

    // Execute on bearish crossover: sell all holdings
    if (signal.signal === "bearish" && currentPosition > 0) {
      tradeCount++;
      ctx.sellMarket("000001", currentPosition);
    }
  });

  // Show initial configuration
  console.log("📊 Initial State:");
  console.log(`   Cash: ¥100,000.00`);
  console.log(`   Position: 0 shares\n`);

  console.log("🎬 Running backtest...\n");

  // Start backtest - runs synchronously
  bot.start();

  // Note: Orders submitted on the last bar cannot be matched
  // because BacktestBrokerSync matches orders when the next bar arrives

  // Print final results
  const finalPosition = bot.getPosition();
  const finalSnapshot = bot.getSnapshot();
  const totalEquity = finalSnapshot.equity;
  const totalReturn = ((totalEquity - 100000) / 100000) * 100;
  const finalHolding = q.qty(finalPosition, "000001");

  console.log("\n📊 Final Results:");
  console.log(`   Events Processed: ${eventCount}`);
  console.log(`   Trades Executed: ${tradeCount}`);
  console.log(`   Cash: ¥${finalPosition.cash.toFixed(2)}`);
  console.log(`   Position: ${finalHolding} shares`);
  if (finalHolding > 0) {
    const finalPrice = finalSnapshot.price("000001");
    const unrealizedValue = finalHolding * finalPrice;
    console.log(
      `   Unrealized Value: ¥${unrealizedValue.toFixed(
        2
      )} (@ ¥${finalPrice.toFixed(2)})`
    );
  }
  console.log(
    `   Total Commission: ¥${finalPosition.totalCommission.toFixed(2)}`
  );
  console.log(`   Realized PnL: ¥${finalPosition.realisedPnL.toFixed(2)}`);
  console.log(`   Total Equity: ¥${totalEquity.toFixed(2)}`);
  console.log(`   Total Return: ${totalReturn.toFixed(2)}%`);

  bot.stop();

  console.log("\n✨ Backtest completed!\n");
}

// Run the example
try {
  main();
} catch (error) {
  console.error("Fatal error:", error);
  process.exit(1);
}
