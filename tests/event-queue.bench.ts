import { describe, bench } from "vitest";

/**
 * Benchmark: Sync vs Promise Queue Event Processing
 *
 * This benchmark compares synchronous vs promise-based event queue processing
 * to validate that our event queue implementation (TradingBot) doesn't introduce
 * significant overhead.
 *
 * Business logic:
 * - Target: 1000 events/second capability (sub-millisecond per event)
 * - Each event runs a trivial processing function (simulates middleware chain)
 * - Sync: Direct function calls
 * - Promise Queue: Chained promises (our implementation pattern)
 */

// Trivial processing function simulating a simple middleware
function processEvent(eventId: number, state: { counter: number }): void {
  state.counter += eventId;
}

// Async version of the processing function
async function processEventAsync(
  eventId: number,
  state: { counter: number }
): Promise<void> {
  state.counter += eventId;
}

describe("Event Queue Performance", () => {
  const EVENT_COUNT = 100;

  bench("sync: direct function calls", () => {
    const state = { counter: 0 };

    // Business logic: Synchronous sequential processing.
    // Events processed one after another with direct function calls.
    for (let i = 0; i < EVENT_COUNT; i++) {
      processEvent(i, state);
    }
  });

  bench("promise queue: chained promises (our pattern)", async () => {
    const state = { counter: 0 };
    let queue = Promise.resolve();

    // Business logic: Promise queue pattern (matches TradingBot implementation).
    // Each event chains to the previous event's completion.
    // This prevents race conditions when events arrive faster than processing.
    for (let i = 0; i < EVENT_COUNT; i++) {
      queue = queue.then(() => processEventAsync(i, state));
    }

    await queue;
  });

  bench("promise queue: fire all then await (parallel)", async () => {
    const state = { counter: 0 };

    // Business logic: Fire all promises immediately and await all.
    // This is what would happen WITHOUT queuing - all events process concurrently.
    // This demonstrates the race condition we're preventing.
    const promises: Promise<void>[] = [];
    for (let i = 0; i < EVENT_COUNT; i++) {
      promises.push(processEventAsync(i, state));
    }

    await Promise.all(promises);
  });

  bench("promise queue: await each (sequential)", async () => {
    const state = { counter: 0 };

    // Business logic: Await each promise sequentially.
    // Alternative implementation that's easier to understand but has same semantics.
    for (let i = 0; i < EVENT_COUNT; i++) {
      await processEventAsync(i, state);
    }
  });
});

/**
 * Benchmark: Slow Middleware Simulation
 *
 * Simulates scenarios where middleware takes time to process (e.g., network calls,
 * complex calculations). This validates that the queue handles backpressure correctly.
 */

async function slowProcessEvent(
  eventId: number,
  state: { counter: number },
  delayMs: number
): Promise<void> {
  // Simulate slow processing (e.g., network call, heavy computation)
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  state.counter += eventId;
}

describe("Event Queue with Slow Middleware", () => {
  const EVENT_COUNT = 10; // Reduced for slow tests
  const DELAY_MS = 1; // 1ms delay per event

  bench("promise queue: chained with slow middleware", async () => {
    const state = { counter: 0 };
    let queue = Promise.resolve();

    // Business logic: Queue ensures sequential processing even with async operations.
    // Events wait for previous event to complete (including delays).
    for (let i = 0; i < EVENT_COUNT; i++) {
      queue = queue.then(() => slowProcessEvent(i, state, DELAY_MS));
    }

    await queue;
  });

  bench("promise queue: parallel with slow middleware", async () => {
    const state = { counter: 0 };

    // Business logic: Without queue, all events start processing immediately.
    // This completes faster but can cause race conditions on shared state.
    const promises: Promise<void>[] = [];
    for (let i = 0; i < EVENT_COUNT; i++) {
      promises.push(slowProcessEvent(i, state, DELAY_MS));
    }

    await Promise.all(promises);
  });
});

/**
 * Benchmark: Real-World Event Simulation
 *
 * Simulates a more realistic middleware chain with multiple operations.
 */

interface TradingState {
  position: number;
  cash: number;
  totalTrades: number;
}

async function simulateMarketEvent(
  price: number,
  state: TradingState
): Promise<void> {
  // Simulate middleware chain operations
  const shouldBuy = state.cash > price && state.position < 100;

  if (shouldBuy) {
    state.position += 1;
    state.cash -= price;
    state.totalTrades += 1;
  }

  const shouldSell = state.position > 0 && price > 150;

  if (shouldSell) {
    state.position -= 1;
    state.cash += price;
    state.totalTrades += 1;
  }
}

describe("Real-World Trading Event Simulation", () => {
  const EVENT_COUNT = 100;

  bench("trading: promise queue (our pattern)", async () => {
    const state: TradingState = {
      position: 0,
      cash: 100000,
      totalTrades: 0,
    };
    let queue = Promise.resolve();

    // Business logic: Market events processed sequentially via queue.
    // Ensures position updates don't race.
    for (let i = 0; i < EVENT_COUNT; i++) {
      const price = 100 + Math.random() * 100; // Price between 100-200
      queue = queue.then(() => simulateMarketEvent(price, state));
    }

    await queue;
  });

  bench("trading: parallel processing (UNSAFE)", async () => {
    const state: TradingState = {
      position: 0,
      cash: 100000,
      totalTrades: 0,
    };

    // Business logic: Market events processed in parallel (NO QUEUE).
    // This is UNSAFE - demonstrates race conditions on position/cash.
    const promises: Promise<void>[] = [];
    for (let i = 0; i < EVENT_COUNT; i++) {
      const price = 100 + Math.random() * 100;
      promises.push(simulateMarketEvent(price, state));
    }

    await Promise.all(promises);
  });
});
