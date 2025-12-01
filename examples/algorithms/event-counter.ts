import type { UniversalAlgo } from "../../src/core/compose.js";

/** Options for event counter */
export interface EventCounterOptions {
  /** Interval to print counter (default: 100) */
  interval?: number;
}

/**
 * Event counter middleware that demonstrates the onion pattern.
 *
 * This is a simple demonstration showing how middleware can:
 * - Execute logic before the chain (pre-processing)
 * - Pass control to the next middleware
 * - Execute cleanup after the chain completes (post-processing)
 *
 * Business logic:
 * - Counts market events across the trading session
 * - Prints progress every N events to monitor activity
 * - Demonstrates the middleware pattern: before → next() → after
 *
 * @param options - Configuration options
 * @returns Universal algorithm middleware function (works with all event types)
 *
 * @example
 * ```ts
 * // Print every 100 market events
 * bot.use(eventCounter());
 *
 * // Print every 50 market events
 * bot.use(eventCounter({ interval: 50 }));
 * ```
 */
export function eventCounter(options: EventCounterOptions = {}): UniversalAlgo {
  const { interval = 100 } = options;

  let count = 0;

  return (ctx, next) => {
    // Business logic: Pre-processing - runs BEFORE downstream algorithms.
    // This is where you prepare state, log entry, or validate conditions.
    if (ctx.event.type === "market") {
      count++;

      if (count % interval === 0) {
        ctx.logger.info({
          msg: `Received ${count} market events, processing...`,
          timestamp: ctx.event.timestamp.toISOString(),
        });
      }
    }

    // Business logic: Pass control to next middleware in the chain.
    // This is where the actual trading algorithms run (downstream middleware).
    // Any actions queued by downstream algorithms will be collected here.
    next();

    // Business logic: Post-processing - runs AFTER downstream algorithms complete.
    // This is where you do cleanup, log results, or finalize state.
    // At this point, all pending actions from downstream algorithms are available.
    if (ctx.event.type === "market" && count % interval === 0) {
      const pending = ctx.getPending();
      ctx.logger.info({
        msg: `Event ${count} processed`,
        pendingOrderActions: pending.length,
      });
    }
  };
}
