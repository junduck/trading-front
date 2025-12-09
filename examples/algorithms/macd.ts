import { EMA } from "@junduck/trading-core/algorithm";
import type { MarketAlgo } from "../../src/core/compose.js";

/** MACD values for a symbol */
export interface MacdValue {
  /** MACD line (fast EMA - slow EMA) */
  macd: number;
  /** Signal line (EMA of MACD line) */
  signal: number;
  /** Histogram (MACD - signal) */
  histogram: number;
  /** Fast EMA value */
  fastEma: number;
  /** Slow EMA value */
  slowEma: number;
}

/** Options for MACD calculation */
export interface MacdOptions {
  /** Fast EMA period (default: 12) */
  fastPeriod?: number;
  /** Slow EMA period (default: 26) */
  slowPeriod?: number;
  /** Signal line period (default: 9) */
  signalPeriod?: number;
  /** State key to store MACD values (default: "macd") */
  stateKey?: string;
}

/**
 * MACD (Moving Average Convergence Divergence) indicator middleware.
 *
 * MACD is a momentum oscillator that shows the relationship between two EMAs.
 * It consists of three components:
 * - MACD line: Difference between fast and slow EMAs (shows trend direction)
 * - Signal line: EMA of MACD line (smoothed for crossover signals)
 * - Histogram: MACD - Signal (visualizes momentum strength)
 *
 * Business logic:
 * - Each symbol maintains independent EMA state across events
 * - Values stabilize after warmup period (max of slowPeriod + signalPeriod)
 * - Stored in context.state for downstream algorithms to access
 * - Only processes market events (price-based indicator)
 *
 * @param options - MACD calculation parameters
 * @returns Market algorithm middleware function (only works with market events)
 *
 * @example
 * ```ts
 * // Use default periods (12, 26, 9)
 * bot.on("market").use(macd());
 *
 * // Custom periods
 * bot.on("market").use(
 *   macd({ fastPeriod: 8, slowPeriod: 21, signalPeriod: 5 })
 * );
 *
 * // Access MACD values in strategy
 * bot.on("market").use(
 *   macd(),
 *   (ctx, next) => {
 *     const macdValues = ctx.get<Map<string, MacdValue>>("macd");
 *     const aapl = macdValues?.get("AAPL");
 *     if (aapl) {
 *       // Bullish crossover: histogram crosses above zero
 *       if (aapl.histogram > 0) {
 *         // Buy signal
 *       }
 *     }
 *     next();
 *   }
 * );
 * ```
 */
export function macd(options: MacdOptions = {}): MarketAlgo {
  const {
    fastPeriod = 12,
    slowPeriod = 26,
    signalPeriod = 9,
    stateKey = "macd",
  } = options;

  // Business logic: Maintain stateful EMA calculators per symbol.
  // Each symbol's price series is independent, so we need separate
  // online algorithm instances to track state across events.
  const fastEmas = new Map<string, EMA>();
  const slowEmas = new Map<string, EMA>();
  const signalEmas = new Map<string, EMA>();

  return (ctx, next) => {
    // Business logic: MACD is a price-based indicator for market events.
    // ctx.event is guaranteed to be MarketEvent by type system.
    const macdValues = new Map<string, MacdValue>();

    for (const quote of ctx.event.marketData) {
      const { symbol, price } = quote;

      // Skip quotes with undefined prices (data integrity check)
      if (price === undefined) continue;

      // Initialize EMA calculators for new symbols.
      // Business logic: Online EMA algorithms maintain internal state,
      // so each symbol needs dedicated instances to track its price history.
      if (!fastEmas.has(symbol)) {
        fastEmas.set(symbol, new EMA({ period: fastPeriod }));
        slowEmas.set(symbol, new EMA({ period: slowPeriod }));
        signalEmas.set(symbol, new EMA({ period: signalPeriod }));
      }

      const fastEma = fastEmas.get(symbol)!;
      const slowEma = slowEmas.get(symbol)!;
      const signalEma = signalEmas.get(symbol)!;

      // Update EMAs with current price
      const fastValue = fastEma.update(price);
      const slowValue = slowEma.update(price);

      // Business logic: MACD line = fast EMA - slow EMA
      // Measures the convergence/divergence between short-term and long-term trends.
      // Positive values indicate bullish momentum, negative values indicate bearish momentum.
      const macdLine = fastValue - slowValue;

      // Business logic: Signal line = EMA of MACD line
      // Smooths the MACD to generate crossover signals. When MACD crosses above
      // signal, it's a bullish signal; crossing below is bearish.
      const signalValue = signalEma.update(macdLine);

      // Business logic: Histogram = MACD - Signal
      // Represents the distance between MACD and signal lines. Growing histogram
      // indicates strengthening momentum, shrinking indicates weakening.
      // Zero-crossings are traditional buy/sell signals.
      const histogram = macdLine - signalValue;

      macdValues.set(symbol, {
        macd: macdLine,
        signal: signalValue,
        histogram,
        fastEma: fastValue,
        slowEma: slowValue,
      });
    }

    // Store calculated values in context state for downstream algorithms.
    // Business logic: State is event-scoped, so values are fresh for each event
    // and won't leak between different event processing cycles.
    ctx.state.set(stateKey, macdValues);

    next();
  };
}
