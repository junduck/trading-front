import { CircularBuffer, type MarketQuote } from "@junduck/trading-core";
import type { Algorithm } from "../core/compose.js";

/** Options for History algorithm */
export interface HistoryOptions {
  /** Maximum number of historical data points to store per symbol */
  maxLength: number;
  /** State key to store history (default: "history") */
  stateKey?: string;
}

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
 * @returns Algorithm middleware function
 *
 * @example
 * ```ts
 * // Store last 100 market data points per symbol
 * agent.use(history({ maxLength: 100 }));
 *
 * // Access history in strategy
 * agent.market({
 *   symbol: "AAPL",
 *   strategy: [
 *     async (ctx) => {
 *       const history = ctx.state.get("history") as Map<string, CircularBuffer<MarketQuote>>;
 *       const aaplHistory = history?.get("AAPL");
 *       if (aaplHistory && aaplHistory.length() >= 20) {
 *         const recentPrices = aaplHistory.toArray().slice(-20);
 *         // Analyze recent price movements
 *       }
 *     }
 *   ]
 * });
 * ```
 */
export function history(options: HistoryOptions): Algorithm {
  const { maxLength, stateKey = "history" } = options;

  // Business logic: Maintain circular buffers per symbol to track historical market data.
  // Each symbol's data stream is independent, requiring separate buffers.
  const buffers = new Map<string, CircularBuffer<MarketQuote>>();

  return async (ctx, next) => {
    // Business logic: Only store market data, as history is for price/volume tracking
    if (ctx.event.type === "market") {
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
    }

    await next();
  };
}
