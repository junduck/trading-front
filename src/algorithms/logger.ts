import type { Algorithm } from "../core/Algorithm.js";

/** Options for configuring the logger middleware */
export interface LoggerOptions {
  /** Whether to log event details (default: true) */
  logEvent?: boolean;
  /** Whether to log position state (default: true) */
  logPosition?: boolean;
  /** Whether to log market snapshot (default: true) */
  logSnapshot?: boolean;
  /** Whether to log pending actions (default: true) */
  logPendingActions?: boolean;
}

/**
 * Algorithm that logs all events and context state.
 * Useful for debugging and monitoring agent behavior.
 *
 * @param options - Configuration options for the logger
 * @returns Algorithm function
 *
 * @example
 * ```ts
 * agent.use(logger());
 * // Or with options
 * agent.use(logger({ logSnapshot: false }));
 * ```
 */
export function logger(options: LoggerOptions = {}): Algorithm {
  const {
    logEvent = true,
    logPosition = true,
    logSnapshot = true,
    logPendingActions = true,
  } = options;

  return async (ctx, next) => {
    ctx.logger.info({
      msg: "Event processing started",
      eventType: ctx.event.type,
      timestamp: new Date().toISOString(),
    });

    if (logEvent) {
      ctx.logger.debug({
        msg: "Event details",
        event: ctx.event,
      });
    }

    if (logPosition) {
      ctx.logger.info({
        msg: "Position state",
        cash: ctx.position.cash,
        totalCommission: ctx.position.totalCommission,
        realisedPnL: ctx.position.realisedPnL,
      });
    }

    if (logSnapshot) {
      const prices: Record<string, number> = {};
      for (const [symbol, price] of ctx.snapshot.price) {
        prices[symbol] = price;
      }
      ctx.logger.debug({
        msg: "Market snapshot",
        prices,
        timestamp: ctx.snapshot.timestamp.toISOString(),
      });
    }

    await next();

    if (logPendingActions) {
      const pendingActions = ctx.getPendingActions();
      if (pendingActions.length > 0) {
        ctx.logger.info({
          msg: "Pending actions",
          actions: pendingActions.map((pa) => ({
            trackingId: pa.trackingId,
            action: pa.action,
          })),
        });
      }
    }
  };
}
