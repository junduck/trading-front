import pino from "pino";
import {
  TradingBot,
  TradingError,
  TradingErrors,
  createDefaultLogger,
  createPinoErrorLogger,
  type Algorithm,
  type MarketEvent,
  MockDataProvider,
  MockTradeProvider,
} from "../src/index.js";

/**
 * Example 1: Middleware that handles errors internally (no throw)
 * If middleware handles the error, it doesn't throw - simple!
 */
const safeMiddleware: Algorithm = async (ctx, next) => {
  try {
    // Some risky operation
    const price = ctx.snapshot.price.get("AAPL");
    if (!price) {
      console.log("⚠️  Price not available, skipping this event");
      return; // Handle internally, don't throw
    }

    // Continue processing
    await next();
  } catch (error) {
    console.log("✅ Caught and handled error in middleware:", error);
    // Error is handled, don't re-throw
  }
};

/**
 * Example 2: Middleware that throws recoverable errors
 * The TradingBot will log the error and continue processing next events
 */
const recoverableErrorMiddleware: Algorithm<MarketEvent> = async (
  ctx,
  next
) => {
  const symbol = ctx.event.getSymbol(ctx.event.marketData[0]);

  // Throw a recoverable error - bot will log and continue
  if (symbol !== "AAPL") {
    throw TradingErrors.middleware(
      `Unexpected symbol: ${symbol}`,
      ctx.event,
      "recoverableErrorMiddleware",
      { severity: "recover" }
    );
  }

  await next();
};

/**
 * Example 3: Middleware that throws cancel-severity errors
 * When unsafe state is detected, throw cancel to clear pending orders
 */
const riskCheckMiddleware: Algorithm = async (ctx, next) => {
  await next(); // Let other middleware queue orders

  const pending = ctx._getPendingActions();
  const totalValue = pending
    .filter((a) => a.action.type === "create")
    .reduce((sum, a) => {
      if (a.action.type !== "create") return sum;
      const price = ctx.snapshot.price.get(a.action.order.symbol) ?? 0;
      return sum + price * a.action.order.quantity;
    }, 0);

  // If total order value exceeds position, throw cancel error
  // This will cancel all pending orders and log the error
  if (totalValue > ctx.position.cash * 0.5) {
    throw TradingErrors.validation(
      `Risk limit exceeded: trying to trade $${totalValue.toFixed(2)} with $${ctx.position.cash.toFixed(2)} cash`,
      ctx.event,
      {
        severity: "cancel_pending",
        metadata: { totalValue, availableCash: ctx.position.cash },
      }
    );
  }
};

/**
 * Example 4: Provider error that should halt the bot
 */
const providerHealthCheck: Algorithm = async (ctx, next) => {
  try {
    // Check if providers are healthy
    await ctx.dataProvider.connect();
    await next();
  } catch (error) {
    // Provider connection failed - halt the bot
    throw TradingErrors.provider(
      "Data provider connection failed",
      ctx.event,
      "DataProvider",
      {
        severity: "halt",
        category: "network",
        cause: error instanceof Error ? error : undefined,
      }
    );
  }
};

/**
 * Example 5: Custom pino logger with multiple transports
 */
async function main() {
  const dataProvider = new MockDataProvider();
  const tradeProvider = new MockTradeProvider({ initialCash: 100000 });

  // Create custom pino logger for error logging
  const logger = createDefaultLogger();

  // Custom logger that writes to file for AI analysis
  const fileLogger = pino(
    pino.destination({ dest: "./errors.log", sync: false })
  );

  const bot = new TradingBot(
    dataProvider,
    tradeProvider,
    ["AAPL", "GOOGL"],
    undefined,
    {
      // Custom error callbacks using pino
      errorCallbacks: [
        // Default pino logger with pretty printing
        createPinoErrorLogger(logger),

        // File logger for AI inspection
        createPinoErrorLogger(fileLogger),

        // Custom callback for monitoring service
        async (error: TradingError) => {
          // In production, send to Sentry, Datadog, etc.
          // await fetch('https://monitoring.example.com/errors', {
          //   method: 'POST',
          //   body: JSON.stringify(error.toJSON())
          // });
          logger.info("📡 Would send to monitoring service: %s", error.message);
        },
      ],
    }
  );

  // Register additional error callback after construction
  bot.onError((error) => {
    logger.debug("➕ Additional error handler triggered: %s", error.severity);
  });

  // Add middleware
  bot.use(safeMiddleware);
  bot.market(["AAPL"], recoverableErrorMiddleware);
  bot.use(riskCheckMiddleware);

  // Start bot
  await bot.start();

  logger.info("✅ Bot started. Error handling is active.");
  logger.info("Errors will be handled according to their severity:");
  logger.info("  - recover: Log and continue");
  logger.info("  - cancel: Cancel pending orders, log, continue");
  logger.info("  - halt: Cancel pending, disconnect, graceful exit");
  logger.info("  - fatal: Immediate termination");

  // Let it run for a bit
  await new Promise((resolve) => setTimeout(resolve, 5000));

  await bot.stop();
  logger.info("✅ Bot stopped gracefully");
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
