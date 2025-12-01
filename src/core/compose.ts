import type { Context } from "./Context.js";
import { TradingErrors } from "./TradingError.js";
import type {
  Event,
  MarketEvent,
  OrderEvent,
  ExternalEvent,
} from "../types/Events.js";

/**
 * Next function to call the next algorithm in the chain.
 */
export type Next = () => void;

/**
 * Middleware function signature (synchronous).
 * Receives a context and a next function to continue the chain.
 *
 * @template E - Event type this algorithm is compatible with
 */
export type Algo<E extends Event = Event> = (
  ctx: Context<E>,
  next: Next
) => void;

/**
 * Algorithm that only works with market events.
 * Use this for algorithms that need access to marketData.
 */
export type MarketAlgo = Algo<MarketEvent>;

/**
 * Algorithm that only works with order events.
 * Use this for algorithms that need access to order state/execution.
 */
export type OrderAlgo = Algo<OrderEvent>;

/**
 * Algorithm that only works with external events.
 * Use this for algorithms that need access to external signal data.
 */
export type ExternalAlgo = Algo<ExternalEvent>;

/**
 * Universal algorithm that works with any event type.
 * Use this for cross-cutting concerns like logging or metrics.
 */
export type UniversalAlgo = Algo<Event>;

/**
 * Pre-hook function signature (async).
 * Runs before the sync middleware chain, typically for I/O operations.
 * Calling next() triggers the sync middleware chain.
 */
export type PreHook<E extends Event = Event> = (
  ctx: Context<E>,
  next: Next
) => Promise<void>;

/**
 * A stack of algorithms composes a strategy for specific event
 */
export type Strategy<E extends Event = Event> = Algo<E>[];

/**
 * Compose multiple sync middlewares into a single function.
 * Executes middleware in order, with each calling next() to continue.
 *
 * @template E - Event type for the composed strategy
 * @param strat - Array of middleware to compose
 * @returns A single composed middleware function
 */
export function compose<E extends Event = Event>(strat: Strategy<E>): Algo<E> {
  // Composition-time validation errors (before event loop starts)
  // These are programming errors and should not throw TradingError
  if (!Array.isArray(strat)) {
    throw new Error("Strategy must be an array of algorithms");
  }

  for (const fn of strat) {
    if (typeof fn !== "function") {
      throw new Error("Algorithm must be composed of functions");
    }
  }

  return (ctx: Context<E>, next: Next) => {
    let index = -1;

    const dispatch = (i: number): void => {
      if (i <= index) {
        // Runtime error during event handling - use TradingError
        throw TradingErrors.system({
          message: "next() called multiple times",
          event: ctx.event,
          severity: "fatal",
          category: "logic",
        });
      }
      index = i;

      const fn = i < strat.length ? strat[i] : next;
      if (!fn) return;

      fn(ctx, () => dispatch(i + 1));
    };

    dispatch(0);
  };
}

/**
 * Compose middleware with async pre-hook.
 * Pre-hook runs first (async), then middleware chain executes (sync).
 *
 * @template E - Event type for the composed strategy
 * @param pre - Async pre-hook for I/O operations
 * @param strat - Array of sync middleware to compose
 * @returns Async function that runs pre-hook then sync middleware chain
 *
 * @example
 * const strategy = composeWithPre(
 *   async (ctx, next) => {
 *     await fetchData(ctx);  // async I/O
 *     next();                // triggers sync chain
 *   },
 *   [algo1, algo2, algo3]    // sync middleware
 * );
 */
export function composeWithPre<E extends Event = Event>(
  pre: PreHook<E>,
  strat: Strategy<E>
): (ctx: Context<E>, next: Next) => Promise<void> {
  const syncComposed = compose(strat);

  return async (ctx: Context<E>, next: Next) => {
    await pre(ctx, () => {
      syncComposed(ctx, next);
    });
  };
}
