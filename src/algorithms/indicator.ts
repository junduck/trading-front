import * as indiLib from "@junduck/trading-indi/indicators";
import type { BarData } from "@junduck/trading-indi";
import type { MarketAlgo } from "../core/compose.js";

/** Supported indicator instance with onData method */
type IndicatorInstance = {
  onData(bar: BarData): number;
};

/** Indicator class constructor */
type IndicatorClass = new (opts?: any) => IndicatorInstance;

/** Indicator names available from @junduck/trading-indi/indicators (excludes useXXX hooks) */
export type IndicatorName = {
  [K in keyof typeof indiLib]: K extends `use${string}` ? never : K;
}[keyof typeof indiLib];

/** Extract constructor options type from an indicator class */
type IndicatorConstructorOpts<N extends IndicatorName> =
  (typeof indiLib)[N] extends new (opts: infer Opts) => any
    ? Opts extends undefined
      ? Record<string, never> // No options
      : Opts
    : (typeof indiLib)[N] extends new (opts?: infer Opts) => any
    ? Opts extends undefined
      ? Record<string, never> // Optional but undefined
      : Opts
    : Record<string, never>; // Fallback: no options

/** Options for indicator middleware - typed to the specific indicator's constructor */
export type IndicatorOptions<N extends IndicatorName> = {
  /** State key to store indicator values (default: indicator name) */
  stateKey?: string;
} & IndicatorConstructorOpts<N>;

/**
 * Generic indicator middleware for @junduck/trading-indi.
 *
 * Business logic:
 * - Each symbol maintains independent indicator state across events
 * - Converts market quotes to BarData format for indicator processing
 * - Stores per-symbol indicator values in context.state
 *
 * @param name - Indicator class name from trading-indi (e.g., "RSI", "MACD", "ATR")
 * @param options - Configuration for state key and indicator parameters
 * @returns Market algorithm middleware function
 *
 * @example
 * ```ts
 * // RSI with default period (14)
 * bot.on("market").use(indicator("RSI"));
 *
 * // RSI with custom period
 * bot.on("market").use(
 *   indicator("RSI", { period: 20 })
 * );
 *
 * // Access indicator values in strategy
 * bot.on("market").use(
 *   indicator("RSI", { period: 14 }),
 *   (ctx, next) => {
 *     const rsi = ctx.get<number>("RSI", "AAPL");
 *     if (rsi !== undefined) {
 *       if (rsi < 30) {
 *         // Oversold - potential buy signal
 *       } else if (rsi > 70) {
 *         // Overbought - potential sell signal
 *       }
 *     }
 *     next();
 *   }
 * );
 * ```
 */
export function indicator<N extends IndicatorName>(
  name: N,
  options: IndicatorOptions<N> = {} as IndicatorOptions<N>
): MarketAlgo {
  const { stateKey = name, ...indicatorOpts } = options;

  // Get the indicator class from trading-indi/indicators deep import
  const IndicatorClass = indiLib[name] as IndicatorClass;

  // Business logic: Maintain stateful indicator instances per symbol.
  // Each symbol's price series is independent, so we need separate
  // indicator instances to track state across events.
  const instances = new Map<string, IndicatorInstance>();

  return (ctx, next) => {
    // Business logic: Store indicator values per symbol.
    // ctx.event is guaranteed to be MarketEvent by type system.
    const values = new Map<string, number>();

    for (const quote of ctx.event.marketData) {
      const { symbol, price } = quote;

      // Initialize indicator for new symbols
      if (!instances.has(symbol)) {
        instances.set(symbol, new IndicatorClass(indicatorOpts));
      }

      const instance = instances.get(symbol)!;

      // Business logic: use close if exists. otherwise take price
      const bar: BarData = { ...quote, close: price };
      if ((quote as any).close !== undefined) {
        bar.close = (quote as any).close;
      }

      // Update indicator with current bar and store result
      const value = instance.onData(bar);
      values.set(symbol, value);
    }

    // Store calculated values in context state for downstream algorithms.
    // Business logic: State is event-scoped, so values are fresh for each event
    // and won't leak between different event processing cycles.
    ctx.state.set(stateKey, values);

    next();
  };
}
