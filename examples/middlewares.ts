import type { Middleware } from "../src/core/Middleware.js";
import type { Order } from "@junduck/trading-core";

/**
 * Example middleware strategies for the basic trading example.
 * These are simple examples to demonstrate middleware concepts.
 */

/**
 * Middleware that buys at market price using half of available cash.
 * Only triggers on market.quote events.
 */
export const buyHalfCash: Middleware = async (ctx, next) => {
  // Only act on quote events
  if (ctx.event.type !== "market.quote") {
    return next();
  }

  const cash = ctx.position.cash;
  const halfCash = cash / 2;

  // Skip if not enough cash
  if (halfCash < 100) {
    console.log(`⏭️  Skipping buy: insufficient cash ($${cash.toFixed(2)})`);
    return next();
  }

  // Get the first symbol from the event
  const marketData = (ctx.event as any).marketData;
  if (!marketData || marketData.length === 0) {
    return next();
  }

  const quote = marketData[0];
  const symbol = (ctx.event as any).getSymbol(quote);
  const price = quote.ask; // Use ask price for buying

  // Calculate quantity (buy with half cash)
  const quantity = Math.floor(halfCash / price);

  if (quantity > 0) {
    console.log(
      `\n🛒 BUY SIGNAL: ${symbol} - ${quantity} shares @ $${price.toFixed(2)} (total: $${(quantity * price).toFixed(2)})`
    );

    const order: Order = {
      id: "",
      symbol,
      side: "BUY",
      effect: "OPEN_LONG",
      type: "MARKET",
      quantity,
      created: new Date(),
    };

    ctx.createOrder(order);
  }

  await next();
};

/**
 * Middleware that sells all positions.
 * Only triggers on market.quote events after a buy has been executed.
 */
export const sellAll: Middleware = async (ctx, next) => {
  // Only act on order fill events
  if (ctx.event.type !== "position.order") {
    return next();
  }

  const orderEvent = ctx.event as any;

  // Only act on fills
  if (orderEvent.event !== "FILLED") {
    return next();
  }

  // Only sell after a buy
  if (orderEvent.orderState.side !== "BUY") {
    return next();
  }

  const symbol = orderEvent.orderState.symbol;
  const quantity = orderEvent.orderState.filledQuantity;

  console.log(
    `\n💸 SELL SIGNAL: Selling all ${quantity} shares of ${symbol}`
  );

  const order: Order = {
    id: "",
    symbol,
    side: "SELL",
    effect: "CLOSE_LONG",
    type: "MARKET",
    quantity,
    created: new Date(),
  };

  ctx.createOrder(order);

  await next();
};
