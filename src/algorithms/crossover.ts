import type { MarketAlgorithm } from "../core/compose.js";
import type { MacdValue } from "./macd.js";

/** Crossover signal type */
export type CrossoverSignal = "bullish" | "bearish" | "none";

/** Crossover detection result for a symbol */
export interface CrossoverValue {
  /** Type of crossover detected */
  signal: CrossoverSignal;
  /** Current value that crossed */
  current: number;
  /** Previous value before crossing */
  previous: number;
}

/** Options for crossover detection */
export interface CrossoverOptions {
  /** State key to read indicator values from (default: "macd") */
  sourceKey?: string;
  /** State key to write crossover signals to (default: "crossover") */
  targetKey?: string;
  /** Field to track for crossover (default: "histogram") */
  field?: keyof MacdValue;
  /** Threshold for crossing zero (default: 0) */
  threshold?: number;
}

/**
 * Crossover detection middleware.
 *
 * Detects when an indicator value crosses above or below a threshold.
 * Commonly used with MACD histogram to generate trading signals.
 *
 * Business logic:
 * - Maintains per-symbol state to track previous values across events
 * - Detects bullish crossover: previous <= threshold && current > threshold
 * - Detects bearish crossover: previous >= threshold && current < threshold
 * - Only processes market events (indicators require price data)
 *
 * @param options - Crossover detection parameters
 * @returns Market algorithm middleware function (only works with market events)
 *
 * @example
 * ```ts
 * // Detect MACD histogram crossovers
 * agent.market({
 *   strategy: [
 *     macd(),
 *     crossover(),
 *   ]
 * });
 *
 * // Access crossover signals in strategy
 * agent.market({
 *   symbol: "AAPL",
 *   strategy: [
 *     macd(),
 *     crossover(),
 *     async (ctx) => {
 *       const signals = ctx.state.get("crossover") as Map<string, CrossoverValue>;
 *       const signal = signals?.get("AAPL");
 *       if (signal?.signal === "bullish") {
 *         // Buy signal
 *       } else if (signal?.signal === "bearish") {
 *         // Sell signal
 *       }
 *     }
 *   ]
 * });
 * ```
 */
export function crossover(options: CrossoverOptions = {}): MarketAlgorithm {
  const {
    sourceKey = "macd",
    targetKey = "crossover",
    field = "histogram",
    threshold = 0,
  } = options;

  // Business logic: Track previous values per symbol to detect crossovers.
  // Each symbol's price series is independent, so we maintain separate state.
  const previousValues = new Map<string, number>();

  return async (ctx, next) => {
    // Business logic: Crossover detection requires indicator values from market events.
    // ctx.event is guaranteed to be MarketEvent by type system.
    const sourceData = ctx.state.get(sourceKey) as
      | Map<string, MacdValue>
      | undefined;

    if (!sourceData) {
      // No source data available, skip crossover detection
      await next();
      return;
    }

    const crossoverSignals = new Map<string, CrossoverValue>();

    for (const [symbol, indicatorValue] of sourceData) {
      const currentValue = indicatorValue[field] as number;
      const prevValue = previousValues.get(symbol);

      if (prevValue === undefined) {
        // First observation for this symbol, no crossover possible yet
        previousValues.set(symbol, currentValue);
        crossoverSignals.set(symbol, {
          signal: "none",
          current: currentValue,
          previous: currentValue,
        });
        continue;
      }

      // Business logic: Detect crossovers by comparing previous and current values
      // against threshold. Bullish = crossing above, bearish = crossing below.
      let signal: CrossoverSignal = "none";

      if (prevValue <= threshold && currentValue > threshold) {
        signal = "bullish";
      } else if (prevValue >= threshold && currentValue < threshold) {
        signal = "bearish";
      }

      crossoverSignals.set(symbol, {
        signal,
        current: currentValue,
        previous: prevValue,
      });

      // Update previous value for next event
      previousValues.set(symbol, currentValue);
    }

    // Store crossover signals in context state for downstream algorithms
    ctx.state.set(targetKey, crossoverSignals);

    await next();
  };
}
