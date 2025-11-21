import type { Context } from "./Context.js";
import { TradingErrors } from "./TradingError.js";

/**
 * Next function to call the next algorithm in the chain.
 */
export type Next = () => Promise<void>;

/**
 * Algorithm function signature.
 * Receives a context and a next algorithm to continue the chain.
 *
 * Event type is determined at runtime via router tag dispatch.
 * Use TypeScript type guards if you need to narrow event types.
 */
export type Algorithm = (ctx: Context, next: Next) => Promise<void>;

/**
 * A stack of algorithms composes a strategy for specific event
 */
export type Strategy = Algorithm[];

/**
 * Compose multiple algorithms into a single algorithm function.
 * Executes algorithm in order, with each calling next() to continue.
 *
 * @param strat - Array of algorithm to compose
 * @returns A single composed algorithm function
 */
export function compose(strat: Strategy): Algorithm {
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

  return async (ctx: Context, next: Next) => {
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
