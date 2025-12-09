# Algorithm Design

Algorithms in `trading-front` are **middleware functions** similar to Express.js, designed specifically for event-driven trading systems. They compose together to form trading strategies that react to market events, order updates, and external signals.

## Core Concept

### Middleware Model

An algorithm is a function with the signature:

```ts
type Algo<E extends Event> = (ctx: Context<E>, next: Next) => void;
```

**Key differences from Express.js:**

| Express.js | trading-front |
|------------|---------------|
| HTTP request/response | Trading events (market/order/external) |
| `res.send()`, `res.json()` | `ctx.submitOrder()`, `ctx.cancelOrder()`, etc. |
| Linear execution (rarely calls `next()` after response) | **Onion model** (like Koa.js) - algorithms call `next()` and continue after |
| `req` and `res` are separate | `ctx` is unified - contains both "request" (event, position) and "response" (pending actions) |

### Execution Flow: The Onion Model

Unlike Express.js where middleware typically stops after sending a response, trading algorithms use **onion-style execution** (like Koa.js):

```text
┌─────────────────────────────────────────────┐
│ Algorithm A (before next)                   │
│  ┌───────────────────────────────────────┐  │
│  │ Algorithm B (before next)             │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │ Algorithm C (before next)       │  │  │
│  │  │                                 │  │  │
│  │  │ ... innermost algorithm ...     │  │  │
│  │  │                                 │  │  │
│  │  │ Algorithm C (after next)        │  │  │
│  │  └─────────────────────────────────┘  │  │
│  │ Algorithm B (after next)              │  │
│  └───────────────────────────────────────┘  │
│ Algorithm A (after next)                    │
└─────────────────────────────────────────────┘
```

**Example:**

```ts
bot.on("market").use(
  // Algorithm 1: Log entry
  (ctx, next) => {
    console.log("→ Processing event");
    next(); // Continue to next algorithm
    console.log("← Event processed");
  },

  // Algorithm 2: Calculate indicator
  (ctx, next) => {
    const price = ctx.price("AAPL");
    ctx.set("signal", price > 100 ? "buy" : "sell");
    next();
    // Could read state set by downstream algorithms here
  },

  // Algorithm 3: Execute trade
  (ctx, next) => {
    const signal = ctx.get<string>("signal");
    if (signal === "buy") {
      ctx.buyMarket("AAPL", 100);
    }
    next();
  }
);
```

**Output:**

```console
→ Processing event
← Event processed
```

All three algorithms execute, with pending orders collected and executed **after** the entire chain completes.

### Real-World Example: Event Counter

A practical demonstration from [examples/algorithms/event-counter.ts](../../examples/algorithms/event-counter.ts):

```ts
export function eventCounter(options = {}): UniversalAlgo {
  const { interval = 100 } = options;
  let count = 0;

  return (ctx, next) => {
    // ⬇ BEFORE: Pre-processing - runs before downstream algorithms
    if (ctx.event.type === "market") {
      count++;
      if (count % interval === 0) {
        ctx.logger.info(`Received ${count} market events, processing...`);
      }
    }

    // ➡ PASS CONTROL: Downstream algorithms run here
    next();

    // ⬆ AFTER: Post-processing - runs after downstream algorithms complete
    if (ctx.event.type === "market" && count % interval === 0) {
      const pending = ctx.getPending();
      ctx.logger.info(`Event ${count} processed, ${pending.length} pending actions`);
    }
  };
}
```

**Why the onion model matters:**

- Monitor what actions downstream algorithms queued (`ctx.getPending()`)
- Measure execution time (timestamp before vs after `next()`)
- Add error handling around downstream execution
- Implement rollback logic if needed

## Context: Request + Response

The `Context` object serves as both the "request" (input data) and "response" (output actions):

### Request Side (Read-only inputs)

```ts
// Current event being processed
ctx.event: MarketEvent | OrderEvent | ExternalEvent

// Portfolio state
ctx.position: Position
ctx.snapshot: Snapshot

// Market data
ctx.price("AAPL")        // Current price
ctx.equity               // Portfolio equity
ctx.holdingQty("AAPL")  // Position quantity
```

### Response Side (Output actions)

```ts
// Submit orders (collected as pending actions)
ctx.buyMarket("AAPL", 100)
ctx.sellMarket("AAPL", 50)
ctx.submitOrder(customOrder)

// Manage orders
ctx.cancelOrder(orderId)
ctx.amendOrder({ id: orderId, price: newPrice })
ctx.cancelAllOrders()
```

**Important:** Order actions are **queued**, not executed immediately. They're processed after the entire algorithm chain completes, similar to how Koa processes `ctx.body`.

## State Management

### Event-Scoped State: `ctx.state`

State stored in `ctx.state` is **ephemeral** - it only exists for the current event and is shared between algorithms in the chain:

```ts
// Algorithm 1: Calculate and store indicator
bot.on("market").use(
  (ctx, next) => {
    const macdValues = calculateMACD(ctx.event.marketData);
    ctx.set("macd", macdValues);  // Store in event-scoped state
    next();
  },

  // Algorithm 2: Read indicator and trade
  (ctx, next) => {
    const macd = ctx.get<MacdValue>("macd", "AAPL");
    if (macd?.histogram > 0) {
      ctx.buyMarket("AAPL", 100);
    }
    next();
  }
);
```

**Lifecycle:**

```text
Event 1 arrives → fresh ctx.state → algorithms process → state discarded
Event 2 arrives → fresh ctx.state → algorithms process → state discarded
```

**Common patterns:**

```ts
// Store Map for multi-symbol data
ctx.set("indicators", new Map<string, IndicatorValue>());

// Read with type safety
const value = ctx.get<Map<string, IndicatorValue>>("indicators");

// Convenience method for symbol-keyed Maps
const aapl = ctx.get<IndicatorValue>("indicators", "AAPL");
```

### Cross-Event State: Closures

To maintain state **across events**, use closures in your algorithm factory:

```ts
function movingAverage(period: number): MarketAlgo {
  // This state persists across all events
  const priceHistory = new Map<string, number[]>();

  return (ctx, next) => {
    const results = new Map<string, number>();

    for (const quote of ctx.event.marketData) {
      // Get or initialize history for this symbol
      if (!priceHistory.has(quote.symbol)) {
        priceHistory.set(quote.symbol, []);
      }

      const history = priceHistory.get(quote.symbol)!;
      history.push(quote.price);

      // Keep only recent prices
      if (history.length > period) {
        history.shift();
      }

      // Calculate average
      const avg = history.reduce((a, b) => a + b, 0) / history.length;
      results.set(quote.symbol, avg);
    }

    // Store results in event-scoped state for other algorithms
    ctx.set("ma", results);
    next();
  };
}

// Each instance maintains independent state
bot.on("market").use(
  movingAverage(20),  // MA-20 maintains its own price history
  movingAverage(50)   // MA-50 maintains separate price history
);
```

**When to use each:**

| Use Case | Storage |
|----------|---------|
| Share data between algorithms in the same event | `ctx.state` |
| Maintain indicator state (EMA, moving averages) | Closure |
| Track algorithm-specific flags or counters | Closure |
| Pass calculated values downstream | `ctx.state` |

## Algorithm Composition

### Basic Composition

Algorithms compose via the `use()` method or `compose()` function:

```ts
import { compose } from "trading-front";

// Using router
bot.on("market").use(
  calculateIndicators(),
  detectSignals(),
  executeStrategy()
);

// Using compose directly
const strategy = compose([
  calculateIndicators(),
  detectSignals(),
  executeStrategy()
]);
```

### Event Types

Algorithms are type-safe based on the event type they process:

```ts
// Market algorithms - access marketData
type MarketAlgo = Algo<MarketEvent>;
function emaIndicator(): MarketAlgo {
  return (ctx, next) => {
    // ctx.event is MarketEvent
    for (const quote of ctx.event.marketData) {
      // Process price data
    }
    next();
  };
}

// Order algorithms - access order execution
type OrderAlgo = Algo<OrderEvent>;
function trackExecutions(): OrderAlgo {
  return (ctx, next) => {
    // ctx.event is OrderEvent
    if (ctx.event.order.status === "filled") {
      // Handle fill
    }
    next();
  };
}

// Universal algorithms - work with any event
type UniversalAlgo = Algo<Event>;
function logger(): UniversalAlgo {
  return (ctx, next) => {
    console.log(`Event: ${ctx.event.type} at ${ctx.event.timestamp}`);
    next();
  };
}
```

### Routing

The router directs events to appropriate algorithm chains:

```ts
const bot = new TradingBot({...});

// Market event handlers
bot.on("market")
  .use(
    macd(),
    crossover(),
    trendFollowing()
  );

// Order event handlers
bot.on("order")
  .use(
    logExecutions(),
    updateMetrics()
  );

// External event handlers
bot.on("external")
  .use(
    processNewsSignal()
  );
```

## Design Patterns

### 1. Indicator Pattern

Calculate indicators and store in state for downstream algorithms:

```ts
export function macd(options: MacdOptions = {}): MarketAlgo {
  const { stateKey = "macd" } = options;

  // Persistent state across events
  const emaCalculators = new Map<string, EMA>();

  return (ctx, next) => {
    const results = new Map<string, MacdValue>();

    for (const quote of ctx.event.marketData) {
      // Initialize or get calculator
      if (!emaCalculators.has(quote.symbol)) {
        emaCalculators.set(quote.symbol, new EMA({...}));
      }

      const ema = emaCalculators.get(quote.symbol)!;
      const value = ema.update(quote.price);
      results.set(quote.symbol, { macd: value, ... });
    }

    // Store in event-scoped state
    ctx.set(stateKey, results);
    next();
  };
}
```

### 2. Signal Detection Pattern

Read indicators from state, detect trading signals:

```ts
export function crossover(options: CrossoverOptions = {}): MarketAlgo {
  const { sourceKey = "macd", targetKey = "crossover" } = options;

  // Track previous values for crossover detection
  const previousValues = new Map<string, number>();

  return (ctx, next) => {
    // Read from state
    const macdData = ctx.get<Map<string, MacdValue>>(sourceKey);
    if (!macdData) return next();

    const signals = new Map<string, CrossoverSignal>();

    for (const [symbol, macd] of macdData) {
      const prev = previousValues.get(symbol) ?? 0;
      const curr = macd.histogram;

      // Detect crossover
      if (prev <= 0 && curr > 0) {
        signals.set(symbol, "bullish");
      } else if (prev >= 0 && curr < 0) {
        signals.set(symbol, "bearish");
      }

      previousValues.set(symbol, curr);
    }

    ctx.set(targetKey, signals);
    next();
  };
}
```

### 3. Strategy Execution Pattern

Read signals and submit orders:

```ts
function trendFollowing(): MarketAlgo {
  return (ctx, next) => {
    const signals = ctx.get<Map<string, string>>("crossover");

    for (const [symbol, signal] of signals ?? []) {
      if (signal === "bullish" && !ctx.hasHolding(symbol)) {
        // Enter position
        ctx.buyMarket(symbol, 100);
      } else if (signal === "bearish" && ctx.hasHolding(symbol)) {
        // Exit position
        const qty = ctx.holdingQty(symbol);
        ctx.sellMarket(symbol, qty);
      }
    }

    next();
  };
}
```

### 4. Conditional Routing

Execute algorithms only when conditions are met:

```ts
bot.on("market").use(
  // Always calculate indicators
  macd(),
  crossover(),

  // Only execute during trading hours
  (ctx, next) => {
    const hour = new Date(ctx.event.timestamp).getHours();
    if (hour >= 9 && hour < 16) {
      next(); // Continue to trading strategies
    }
    // else: skip remaining algorithms
  },

  // These only run during trading hours
  momentumStrategy(),
  riskManagement()
);
```

### 5. Position Monitoring Pattern

Monitor position changes in response to order executions (from [examples/algorithms/position-printer.ts](../../examples/algorithms/position-printer.ts)):

```ts
export function positionPrinter(): UniversalAlgo {
  return (ctx, next) => {
    // Business logic: Filter for order events with fill executions.
    // Only fills update the position, other order events don't.
    if (ctx.event.type === "order" && ctx.event.fill.length > 0) {
      // Log each fill
      for (const fill of ctx.event.fill) {
        ctx.logger.info({
          msg: "Order filled",
          symbol: fill.symbol,
          side: fill.side,
          quantity: fill.quantity,
          price: fill.price,
        });
      }

      // Position is automatically updated by the bot before this algorithm runs
      const { position } = ctx;

      // Print long positions
      if (position.long && position.long.size > 0) {
        for (const [symbol, longPos] of position.long) {
          ctx.logger.info({
            symbol,
            quantity: longPos.quantity,
            avgCost: longPos.totalCost / longPos.quantity,
            realisedPnL: longPos.realisedPnL,
          });
        }
      }
    }

    next();
  };
}
```

**Key insights:**

- The bot automatically updates `ctx.position` before running algorithms
- Only `OrderEvent` with fills (`ctx.event.fill.length > 0`) modify positions
- Position state reflects the result of applying fills to the previous position
- Use for monitoring, auditing, or triggering portfolio rebalancing

### 6. Wrapper Pattern

Create higher-order algorithms that add behavior:

```ts
function withLogging<E extends Event>(
  name: string,
  algo: Algo<E>
): Algo<E> {
  return (ctx, next) => {
    ctx.logger.info(`[${name}] Start`);
    algo(ctx, () => {
      ctx.logger.info(`[${name}] Complete`);
      next();
    });
  };
}

// Usage
bot.on("market").use(
  withLogging("MACD", macd()),
  withLogging("Crossover", crossover())
);
```

## Best Practices

### 1. Always Call `next()`

Unless you intentionally want to stop the chain:

```ts
// ✅ Good: Always call next
(ctx, next) => {
  ctx.set("processed", true);
  next();
}

// ❌ Bad: Forgot next() - breaks the chain
(ctx, next) => {
  ctx.set("processed", true);
  // Chain stops here!
}

// ✅ Good: Conditional execution
(ctx, next) => {
  if (shouldContinue) {
    next(); // Continue chain
  }
  // Intentionally stop chain when condition is false
}
```

### 2. Never Call `next()` Multiple Times

```ts
// ❌ Bad: Multiple next() calls
(ctx, next) => {
  next();
  next(); // Error: "next() called multiple times"
}

// ❌ Bad: Conditional duplicate
(ctx, next) => {
  if (condition) {
    next();
  }
  next(); // Duplicate if condition is true
}
```

### 3. Use Type-Safe State Access

```ts
// ✅ Good: Type-safe access
const macd = ctx.get<MacdValue>("macd", "AAPL");
if (macd?.histogram > 0) {
  // TypeScript knows macd is MacdValue
}

// ❌ Bad: Untyped access
const macd = ctx.get("macd", "AAPL");
// TypeScript doesn't know the type
```

### 4. Handle Missing State Gracefully

```ts
// ✅ Good: Check for missing data
(ctx, next) => {
  const indicators = ctx.get<Map<string, Value>>("indicators");
  if (!indicators) {
    // Indicator algorithm didn't run or no data available
    return next();
  }

  // Process indicators...
  next();
}
```

### 5. Document Business Logic

```ts
export function rsiStrategy(threshold = 30): MarketAlgo {
  const rsiCalculators = new Map<string, RSI>();

  return (ctx, next) => {
    // Business logic: Buy when RSI crosses below oversold threshold,
    // indicating potential reversal from oversold condition.
    // Only enter if we don't already have a position to avoid pyramiding.

    for (const quote of ctx.event.marketData) {
      // ... implementation
    }

    next();
  };
}
```

### 6. Separate Concerns

Break complex strategies into focused algorithms:

```ts
// ✅ Good: Focused responsibilities
bot.on("market").use(
  calculateRSI(),      // Pure calculation
  calculateMACD(),     // Pure calculation
  detectSignals(),     // Signal generation
  positionSizing(),    // Risk management
  executeOrders()      // Order submission
);

// ❌ Bad: Monolithic algorithm
bot.on("market").use(
  (ctx, next) => {
    // Calculate RSI, MACD, detect signals, size positions,
    // submit orders all in one function - hard to test and reuse
    next();
  }
);
```

## Examples

Working examples are available in [examples/algorithms/](../../examples/algorithms/):

- **[macd.ts](../../examples/algorithms/macd.ts)** - MACD indicator calculation with EMA state management
- **[event-counter.ts](../../examples/algorithms/event-counter.ts)** - Demonstrates onion pattern with pre/post processing
- **[position-printer.ts](../../examples/algorithms/position-printer.ts)** - Monitors position changes on order fills

See [examples/macd-backtest.ts](../../examples/macd-backtest.ts) for a complete backtesting example using these algorithms.

## Summary

- **Algorithms are middleware** with `(ctx, next) => void` signature
- **Onion execution model**: Code before `next()` runs top-down, code after runs bottom-up
- **Context is request + response**: Read from `ctx.event/position/snapshot`, write via `ctx.submitOrder()` etc.
- **Event-scoped state** via `ctx.state` for sharing data within an event
- **Cross-event state** via closures for maintaining algorithm state
- **Type-safe routing** ensures algorithms only process compatible events
- **Composition** via `use()` or `compose()` for building strategies
- **Always call `next()`** to continue the chain (unless intentionally stopping)
