import { CircularBuffer, type MarketQuote } from "@junduck/trading-core";
import type { MarketAlgo } from "../core/compose.js";

/** Options for History algorithm */
export interface HistoryOptions {
  /** Maximum number of historical data points to store per symbol */
  maxLength: number;
  /** State key to store history (default: "history") */
  stateKey?: string;
}

export type QuoteBuffer = CircularBuffer<MarketQuote>;

/**
 * History tracking middleware that maintains circular buffers of market data per symbol.
 *
 * Business logic:
 * - Stores historical market quotes in fixed-size circular buffers per symbol
 * - When buffer is full, oldest data is overwritten by newest
 * - Only processes market events (stores price/volume data)
 * - Downstream algorithms can access historical data for indicators or analysis
 *
 * @param options - History configuration (maxLength required)
 * @returns Market algorithm middleware function (only works with market events)
 *
 * @example
 * ```ts
 * // Store last 100 market data points per symbol
 * bot.on("market").use(history({ maxLength: 100 }));
 *
 * // Access history in strategy
 * bot.on("market").use(
 *   history({ maxLength: 100 }),
 *   (ctx, next) => {
 *     const aaplHistory = ctx.get<QuoteBuffer>("history", "AAPL");
 *     if (aaplHistory && aaplHistory.length() >= 20) {
 *       const recentPrices = aaplHistory.toArray().slice(-20);
 *       // Analyze recent price movements
 *     }
 *     next();
 *   }
 * );
 * ```
 */
export function history(options: HistoryOptions): MarketAlgo {
  const { maxLength, stateKey = "history" } = options;

  // Business logic: Maintain circular buffers per symbol to track historical market data.
  // Each symbol's data stream is independent, requiring separate buffers.
  const buffers = new Map<string, QuoteBuffer>();

  return (ctx, next) => {
    // Business logic: Store market data in circular buffers for price/volume tracking
    // ctx.event is guaranteed to be MarketEvent by type system
    for (const quote of ctx.event.marketData) {
      const { symbol } = quote;

      // Initialize buffer for new symbols
      if (!buffers.has(symbol)) {
        buffers.set(symbol, new CircularBuffer<MarketQuote>(maxLength));
      }

      // Store the quote in the circular buffer
      buffers.get(symbol)!.push(quote);
    }

    // Store buffers in context state for downstream algorithms
    ctx.state.set(stateKey, buffers);

    next();
  };
}
