import type { Context } from "./Context.js";
import type { Event } from "../types/Events.js";
import { TradingErrors } from "./TradingError.js";

/**
 * Next function to call the next algorithm in the chain.
 */
export type Next = () => Promise<void>;

/**
 * Algorithm function signature.
 * Receives a context and a next algorithm to continue the chain.
 *
 * @template E - Event type for type-safe event access
 */
export type Algorithm<E extends Event = Event> = (
  ctx: Context<E>,
  next: Next
) => Promise<void>;

/**
 * A stack of algorithms composes a strategy for specific event
 */
export type Strategy<E extends Event = Event> = Algorithm<E>[];

/**
 * Compose multiple algorithms into a single algorithm function.
 * Executes algorithm in order, with each calling next() to continue.
 *
 * @template E - Event type for type-safe event access
 * @param strat - Array of algorithm to compose
 * @returns A single composed algorithm function
 */
export function compose<E extends Event = Event>(
  strat: Strategy<E>
): Algorithm<E> {
  // Composition-time validation errors (before event loop starts)
  // These are programming errors and should fail fast with standard Error
  if (!Array.isArray(strat)) {
    throw new Error("Algorithm stack must be an array");
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
        throw TradingErrors.system(
          "next() called multiple times",
          ctx.event,
          "fatal",
          "logic"
        );
      }
      index = i;

      const fn = i < strat.length ? strat[i] : next;
      if (!fn) return;

      await fn(ctx, () => dispatch(i + 1));
    };

    await dispatch(0);
  };
}
