/**
 * Basic trading example demonstrating:
 * - New high-performance event system with tag dispatch
 * - Logger as global middleware
 * - Simple flip-flop strategy: buy when flat, sell when long
 *
 * Algorithm:
 * 1. Listen for AAPL market events
 * 2. If position is empty -> buy AAPL with half cash at market price
 * 3. If holding long AAPL -> sell all instead
 */

import { TradingBot, logger } from "../src/index.js";
import { MockDataProvider } from "../src/providers/MockDataProvider.js";
import { MockTradeProvider } from "../src/providers/MockTradeProvider.js";
import type { Order } from "@junduck/trading-core";

async function main() {
  console.log("🚀 Starting Trading TradingBot Example\n");

  // Create mock data provider
  const dataProvider = new MockDataProvider({
    initialPrices: {
      AAPL: 150.0,
      GOOGL: 2800.0,
    },
    volatility: 0.005, // 0.5% volatility
    autoEmit: false, // Manual control for this example
  });

  // Create mock trade provider with price integration
  const tradeProvider = new MockTradeProvider({
    initialCash: 100000,
    orderLatency: 50, // Fast execution for demo
    commissionPerShare: 0.01,
    slippageBps: 2, // 2 basis points slippage
    priceProvider: (symbol) => {
      // Provide current prices to mock trade provider
      if (symbol === "AAPL") return dataProvider["prices"].get(symbol) ?? 150;
      if (symbol === "GOOGL") return dataProvider["prices"].get(symbol) ?? 2800;
      return 100;
    },
  });

  // Create agent
  const agent = new TradingBot(dataProvider, tradeProvider, ["AAPL", "GOOGL"]);

  // Add logger as global preRoute middleware
  agent.use(logger());

  // Track AAPL quantity in closure (cross-event state)
  let aaplQuantity = 0;

  // Route 1: Listen for AAPL market events
  agent.market("AAPL", async (ctx) => {
    // Get current AAPL quantity from closure (cross-event state)
    const aaplQty = aaplQuantity;

    // Get AAPL price from market event - now type-safe!
    const aaplData = ctx.event.marketData.find(
      (d) => ctx.event.getSymbol(d) === "AAPL"
    );
    if (!aaplData) return;

    // Extract price (handle both quote and bar data)
    const price = ctx.snapshot.price.get("AAPL");
    if (!price) return;

    if (aaplQty === 0) {
      // Position is empty -> Buy with half cash
      const cash = ctx.position.cash;
      const halfCash = cash / 2;

      if (halfCash < 100) {
        console.log(
          `⏭️  Skipping buy: insufficient cash ($${cash.toFixed(2)})`
        );
        return;
      }

      const quantity = Math.floor(halfCash / price);

      if (quantity > 0) {
        console.log(
          `\n🛒 BUY SIGNAL: AAPL - ${quantity} shares @ $${price.toFixed(
            2
          )} (total: $${(quantity * price).toFixed(2)})`
        );

        const order: Order = {
          symbol: "AAPL",
          side: "BUY",
          effect: "OPEN_LONG",
          type: "MARKET",
          quantity,
          created: new Date(),
        };

        ctx.createOrder(order);
      }
    } else {
      // Holding long AAPL -> Sell all
      console.log(
        `\n💸 SELL SIGNAL: Selling all ${aaplQty} shares of AAPL @ $${price.toFixed(
          2
        )}`
      );

      const order: Order = {
        symbol: "AAPL",
        side: "SELL",
        effect: "CLOSE_LONG",
        type: "MARKET",
        quantity: aaplQty,
        created: new Date(),
      };

      ctx.createOrder(order);
    }
  });

  // Route 2: Track position updates from order fills
  agent.order("FILLED", async (ctx) => {
    const state = ctx.event.state;
    if (!state || state.symbol !== "AAPL") return;

    const qty = state.filledQuantity ?? 0;

    if (state.side === "BUY") {
      aaplQuantity += qty;
      console.log(`  ✓ Position updated: holding ${aaplQuantity} AAPL`);
    } else if (state.side === "SELL") {
      aaplQuantity -= qty;
      console.log(`  ✓ Position updated: holding ${aaplQuantity} AAPL`);
    }
  });

  // Listen to agent events
  agent.on("started", () => {
    console.log("✅ Agent started successfully\n");
  });

  agent.on("stopped", () => {
    console.log("\n🛑 Agent stopped\n");
  });

  agent.on("error", (error: any) => {
    console.error("\n❌ Agent error:", error);
  });

  // Start the agent
  await agent.start();

  console.log("📊 Initial Position:");
  console.log(`  Cash: $${agent.getPosition().cash.toFixed(2)}`);
  console.log(
    `  Commission: $${agent.getPosition().totalCommission.toFixed(2)}`
  );
  console.log(`  PnL: $${agent.getPosition().realisedPnL.toFixed(2)}`);
  console.log(`  AAPL Quantity: ${aaplQuantity}\n`);

  // Simulate trading sequence
  console.log("🎬 Simulating trading sequence...\n");

  // Step 1: Emit AAPL quote (triggers buy)
  console.log("📈 Step 1: Emit AAPL quote (should trigger BUY)\n");
  await dataProvider.emitQuote(["AAPL"]);

  // Wait for order processing
  await sleep(200);

  // Step 2: Emit AAPL quote again (triggers sell)
  console.log("\n📈 Step 2: Emit AAPL quote (should trigger SELL)\n");
  await dataProvider.emitQuote(["AAPL"]);

  // Wait for sell order processing
  await sleep(200);

  // Step 3: Check position after cycle
  console.log("\n📊 Position after first cycle:");
  const position1 = agent.getPosition();
  console.log(`  Cash: $${position1.cash.toFixed(2)}`);
  console.log(`  Commission: $${position1.totalCommission.toFixed(2)}`);
  console.log(`  PnL: $${position1.realisedPnL.toFixed(2)}`);
  console.log(`  Net Change: $${(position1.cash - 100000).toFixed(2)}`);
  console.log(`  AAPL Quantity: ${aaplQuantity}\n`);

  // Try another round with price movement
  console.log("🔄 Running another trading cycle with higher price...\n");

  // Update price
  dataProvider.setPrice("AAPL", 155.0);

  // Step 4: Buy again
  console.log("📈 Step 3: Emit AAPL quote @ $155 (should trigger BUY)\n");
  await dataProvider.emitQuote(["AAPL"]);
  await sleep(200);

  // Step 5: Sell again
  console.log("\n📈 Step 4: Emit AAPL quote @ $155 (should trigger SELL)\n");
  await dataProvider.emitQuote(["AAPL"]);
  await sleep(200);

  console.log("\n📊 Final Position:");
  const position2 = agent.getPosition();
  console.log(`  Cash: $${position2.cash.toFixed(2)}`);
  console.log(`  Commission: $${position2.totalCommission.toFixed(2)}`);
  console.log(`  PnL: $${position2.realisedPnL.toFixed(2)}`);
  console.log(`  Total Net Change: $${(position2.cash - 100000).toFixed(2)}`);
  console.log(`  AAPL Quantity: ${aaplQuantity}\n`);

  // Stop the agent
  await agent.stop();

  console.log("✨ Example completed successfully!\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the example
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
