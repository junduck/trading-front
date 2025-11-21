# Composable Middleware Architecture

This example demonstrates the composable middleware pattern in `trading-front`, where each middleware has a single responsibility and communicates through context state.

## Pipeline Flow

```text
Market Event
    ↓
[1] BacktestProvider.onMarketData()
    → Matches pending orders with market prices
    → Executes fills
    ↓
[2] macd()
    → Reads: market data (price)
    → Calculates: MACD indicator values
    → Writes: state.macd (Map<symbol, MacdValue>)
    ↓
[3] crossover()
    → Reads: state.macd
    → Detects: crossover signals (bullish/bearish/none)
    → Writes: state.crossover (Map<symbol, CrossoverValue>)
    ↓
[4] Trading Strategy
    → Reads: state.crossover
    → Executes: buy/sell orders based on signals
```

## Benefits

### 1. **Single Responsibility**

Each middleware does one thing well:

- `macd()` - Calculate MACD indicator
- `crossover()` - Detect crossovers
- Strategy - Execute trades

### 2. **Reusability**

Middleware can be composed in different ways:

```ts
// MACD with crossover detection
bot.use(macd());
bot.use(crossover());

// RSI with crossover detection
bot.use(rsi());
bot.use(crossover({ sourceKey: "rsi", field: "value" }));

// Multiple indicators
bot.use(macd());
bot.use(rsi());
bot.use(crossover({ sourceKey: "macd" }));
bot.use(crossover({ sourceKey: "rsi", targetKey: "rsiCrossover" }));
```

### 3. **Testability**

Each middleware can be tested independently:

```ts
// Test crossover logic in isolation
const algo = crossover();
const ctx = createContext(macdData);
await algo(ctx, async () => {});
expect(ctx.state.get("crossover").get("AAPL").signal).toBe("bullish");
```

### 4. **Clean Separation of Concerns**

- **Indicators** = Pure calculations (no trading logic)
- **Signal Detection** = Pattern recognition (no trading logic)
- **Strategy** = Trading decisions (reads signals, executes orders)

### 5. **Easy to Extend**

Add new middleware without modifying existing code:

```ts
// Add a new filter middleware
bot.use(macd());
bot.use(crossover());
bot.use(volumeFilter()); // Only pass signals if volume > threshold
// Strategy reads filtered signals
```

## Example Usage

See [macd-backtest.ts](./macd-backtest.ts) for a complete example.

```ts
import { TradingBot, macd, crossover } from "../src/index.js";

const bot = new TradingBot({ dataProvider, tradeProvider, symbols: ["AAPL"] });

// Compose middleware pipeline
bot.use(tradeProvider.onMarketData());
bot.use(macd());           // Write state.macd
bot.use(crossover());      // Read state.macd, write state.crossover

// Trading strategy reads state.crossover
bot.market({
  symbol: "AAPL",
  strategy: [
    async (ctx) => {
      const signals = ctx.state.get("crossover");
      const signal = signals?.get("AAPL");
      const price = ctx.snapshot.price.get("AAPL");
      const cash = ctx.position.cash;

      if (signal?.signal === "bullish") {
        // Buy at market using convenience method
        const quantity = Math.floor(cash / price);
        ctx.buyMarket("AAPL", quantity);
      } else if (signal?.signal === "bearish") {
        // Sell at market using convenience method
        ctx.sellMarket("AAPL", position);
      }
    }
  ]
});
```

## Convenience Methods

The `Context` provides convenience methods to simplify common order patterns:

### Market Orders

```ts
ctx.buyMarket(symbol, quantity)   // Buy at market price
ctx.sellMarket(symbol, quantity)  // Sell at market price
```

### Limit Orders

```ts
ctx.buy(symbol, quantity, price)   // Buy with limit price
ctx.sell(symbol, quantity, price)  // Sell with limit price
```

**Features:**

- Automatically generates unique order IDs (format: `timestamp-random6chars`)
- Sets appropriate `side` and `effect` fields
- Uses event timestamp as order creation time
- Returns tracking ID for monitoring order status

**Example:**

```ts
// Before: Manual order creation
const order: Order = {
  symbol: "AAPL",
  side: "BUY",
  effect: "OPEN_LONG",
  type: "MARKET",
  quantity: 100,
  created: ctx.event.timestamp,
};
ctx.submitOrder(order);

// After: Using convenience method
ctx.buyMarket("AAPL", 100);
```

## Key Principles

1. **Middleware writes to state, never modifies input**
2. **Strategies read from state, execute actions**
3. **State is event-scoped** (fresh for each market event)
4. **Middleware order matters** (dependencies form a DAG)
5. **Pure functions** where possible (easier to test and reason about)
