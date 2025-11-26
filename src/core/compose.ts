import type { Context } from "./Context.js";
import { TradingErrors } from "./TradingError.js";
import type {
  Event,
  MarketEvent,
  OrderEvent,
  NewsEvent,
} from "../types/Events.js";

/**
 * Next function to call the next algorithm in the chain.
 */
export type Next = () => Promise<void>;

/**
 * Algorithm function signature.
 * Receives a context and a next algorithm to continue the chain.
 *
 * @template E - Event type this algorithm is compatible with
 *
 * Event type is enforced at compile-time via generics.
 * Use specific types (MarketAlgo, OrderAlgo) to restrict event compatibility.
 */
export type Algo<E extends Event = Event> = (
  ctx: Context<E>,
  next: Next
) => void | Promise<void>;

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
 * Algorithm that only works with news events.
 * Use this for algorithms that need access to news data.
 */
export type NewsAlgo = Algo<NewsEvent>;

/**
 * Universal algorithm that works with any event type.
 * Use this for cross-cutting concerns like logging or metrics.
 */
export type UniversalAlgo = Algo<Event>;

/**
 * A stack of algorithms composes a strategy for specific event
 */
export type Strategy<E extends Event = Event> = Algo<E>[];

/**
 * Compose multiple algorithms into a single algorithm function.
 * Executes algorithm in order, with each calling next() to continue.
 *
 * @template E - Event type for the composed strategy
 * @param strat - Array of algorithm to compose
 * @returns A single composed algorithm function
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

  return async (ctx: Context<E>, next: Next) => {
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
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

      await fn(ctx, () => dispatch(i + 1));
    };

    await dispatch(0);
  };
}
