# Concurrency Model and State Consistency

## Executive Summary

This document analyzes the concurrency and state consistency properties of the TradingBot architecture. The key finding: **no event sequencing queue is required** because JavaScript's single-threaded execution model, combined with synchronous middleware and snapshot-based contexts, provides sufficient consistency guarantees for signal-based trading strategies.

## Architecture Overview

### Event Sources

The TradingBot processes events from three concurrent sources:

1. **Market Events**: Price updates, order book changes
2. **Order Events**: Fill confirmations, order state updates (OPEN, PARTIAL, FILLED, CANCELLED, REJECT)
3. **External Events**: Signals from external providers (news, ML predictions, etc.)

### Event Processing Model

```typescript
private async onMarketEvent(event: MarketEvent) {
  this.snapshot.updateQuotes(event.marketData, this.position);  // Synchronous
  await this.mainLoop(event);  // Async I/O only
}

private async onOrderEvent(event: OrderEvent) {
  // Process fills - synchronous state updates
  for (const fill of event.fill) {
    processFill(this.position, fill);
  }
  this.snapshot.updatePosition(symbols, this.position);
  this.snapshot.updateOpen(event);
  await this.mainLoop(event);
}
```

**Key properties:**

- State updates (`position`, `snapshot`) are synchronous
- Middleware execution is synchronous
- Context captures immutable snapshot at event arrival
- Only I/O operations (order submission) are asynchronous

## JavaScript Concurrency Guarantees

### Single-Threaded Execution

JavaScript's event loop provides the following guarantee: **synchronous code runs to completion without interleaving**. Context switches occur only at explicit suspension points (`await`).

**Example execution timeline:**

```text
T1: MarketEvent arrives
T2:   updateQuotes() executes atomically
T3:   Context snapshot created (position = P1)
T4:   await mainLoop() - SUSPENDS
T5: OrderEvent arrives (queued during T4)
T6:   processFill() executes atomically
T7:   Position updated (position = P2)
T8:   Context snapshot created (position = P2)
T9:   await mainLoop() - SUSPENDS
T10: MarketEvent resumes with snapshot from T3 (position = P1)
T11: OrderEvent resumes with snapshot from T8 (position = P2)
```

**Critical observation:** At T10, the MarketEvent middleware executes with position P1, even though the actual position is now P2. This is by design, not a bug.

## The Stale State Problem (And Why It's Acceptable)

### Fundamental Limitation

In any distributed trading system, local state is **always an estimation** of remote state. Consider:

```typescript
// Local known position
position.BTC = 1.0

// Actual state at broker (unknown to client)
- Pending fill in network buffer: +0.5 BTC
- Order being matched right now: +0.3 BTC
- Incoming market order about to fill yours: +0.2 BTC
```

**Truth:** Even with perfect local event sequencing, you never have ground truth. Network latency and broker processing delays ensure your position view is always behind reality.

### Implications for Trading Strategies

The snapshot-based model is correct because:

1. **Cannot wait indefinitely**: Strategies must act on available information, not hypothetical future fills
2. **Broker rate limits**: Querying `getPosition()` on every event is impractical (rate limited, slow)
3. **Matches reality**: This model accurately reflects distributed trading conditions

**Acceptable behavior example:**

```typescript
T1: Bullish signal detected, position.BTC = 0
    → Submit BUY 0.1 BTC

T2: Bullish signal detected again, position.BTC = 0 (fill not arrived yet)
    → Submit BUY 0.1 BTC again

T3: Fill arrives: position.BTC = 0.1
T4: Fill arrives: position.BTC = 0.2

// Result: Total position 0.2 BTC
```

Each decision at T1 and T2 was correct given available information. The duplicate submission is not a race condition—it's the consequence of distributed system latency.

**If this behavior is undesired**, strategies should implement their own controls:

```typescript
// Strategy-level throttling (explicit opt-in)
const lastSubmitTime = snapshot.lastSubmit;
if (lastSubmitTime && Date.now() - lastSubmitTime.getTime() < 5000) {
  return; // Skip signal if recently submitted
}

ctx.buy('BTC', 0.1);
```

## State Tracking Facilities

### Position Tracking

**Position state** (`this.position`) is maintained via fill processing:

```typescript
for (const fill of event.fill) {
  processFill(this.position, fill);  // Synchronous update
}
```

**Guarantees:**

- Position reflects all fills received from broker
- Updates are atomic (no interleaving during fill processing)

**Limitations:**

- Position is behind broker's actual position (network delay)
- Pending unfilled orders are not reflected in position

### Open Order Tracking

**Open order map** (`snapshot.openMap`) tracks orders that may be working at broker:

```typescript
updateOpen(event: OrderEvent): void {
  for (const orderState of event.updated) {
    switch (orderState.status) {
      case "OPEN":
      case "PARTIAL":
        this.openMap.set(orderState.id, orderState);
        break;
      case "FILLED":
      case "CANCELLED":
      case "REJECT":
        this.openMap.delete(orderState.id);
        break;
    }
  }
}
```

**Guarantees:**

- Reflects broker-confirmed order states received via OrderEvent
- Provides best-effort view of working orders

**Limitations (IMPORTANT):**

- **Estimation only**: Actual broker state may differ due to network delays
- **Not updated on submission**: Only updated when broker confirms via OrderEvent
- **Race window**: Orders submitted but not yet confirmed are not tracked
- **Rejection window**: Rejected orders may remain in map until rejection event arrives

**Intended usage:**

```typescript
// Risk management example: check total exposure
const openOrders = snapshot.openOrders;
const pendingBuyQty = openOrders
  .filter(o => o.symbol === 'BTC' && o.side === 'BUY')
  .reduce((sum, o) => sum + o.remainingQuantity, 0);

const totalExposure = position.BTC + pendingBuyQty;
if (totalExposure >= maxExposure) {
  return; // Skip signal
}
```

This is **advisory**, not authoritative. The framework does not enforce limits—strategies are responsible for risk management logic.

## What Is NOT a Race Condition

### 1. Concurrent I/O Operations

```typescript
await this.processOrders(pending);  // Network I/O
```

Order submission is pure I/O. If two events submit orders concurrently, the broker receives two requests—this is normal operation, not a race condition.

### 2. Snapshot Divergence

```typescript
const ctx = new Context({
  position: this.position,      // Snapshot at event arrival
  snapshot: this.snapshot,      // Snapshot at event arrival
});
```

Middleware executes with an immutable view. If another event modifies position during middleware execution, that's expected—events arrive at different times and process independently.

### 3. Local Variables

Pending actions are local to each event's context:

```typescript
const pending = ctx.getPending();  // Local array
await processOrders(pending);      // No shared state mutation
```

No read-modify-write cycles across await points on shared state.

## Determinism and Backtesting

### Determinism Guarantee

**Given:**

- Identical event arrival order
- Identical middleware logic
- Synchronous middleware execution

**Result:** Identical trading decisions and order submissions

This enables backtesting:

```typescript
const bt = new BacktestBroker(...); // Backtest provider is simulated trade provider
bot.pre("market", bt.marketPreHook()).use(); // Insert backtest pre-hook on market event

// now use bot in real-time data stream or data playback
```

**Caveat:** Live trading may produce different event orderings (market data vs. fills arriving in different orders). Backtesting provides **deterministic replay of a specific event sequence**, not prediction of live behavior.

## When Sequencing Would Be Required

### High-Frequency Market Making

HFT strategies with tight inventory control require different architecture:

**Problem: Inventory overshoot**

```typescript
T1: position = 0.15 BTC, market mid moves
    → Submit SELL 0.15 (to flatten)
T2: Fill arrives: position = 0.25 BTC (buyer hit our ask)
T3: Market mid moves again
    → Submit SELL 0.25 (based on new position)
T4: Both orders fill → position = -0.15 BTC (SHORT)
```

**HFT requirements:**

- Synchronous position checks before every order
- Track pending unfilled orders (not just fills)
- Strict sequencing: event N+1 must see all effects of event N
- Real-time broker state queries (not snapshots)

This is a **business requirement** for specific strategy types, not a framework deficiency.

## Design Rationale

The current architecture prioritizes:

1. **Simplicity**: No global event queue, no complex locking
2. **Performance**: Concurrent event processing, no artificial serialization
3. **Honesty**: Clear about what is tracked and what isn't
4. **Flexibility**: Strategies implement domain-specific controls if needed
5. **Determinism**: Backtesting works via synchronous middleware

**Trade-offs accepted:**

- Position view is eventually consistent (not real-time)
- Strategies must tolerate duplicate signals during fill propagation delay
- No framework-enforced risk limits (delegated to strategies)

## Conclusion

**The TradingBot does not have race conditions** in the traditional sense (undefined behavior from concurrent shared state access). JavaScript's single-threaded execution prevents true data races.

**The TradingBot does have eventual consistency** between local state and broker state. This is inherent to distributed trading and cannot be eliminated—only obscured with additional layers of complexity.

**The design is correct for signal-based trading strategies** where decisions are based on market conditions and signals, not microsecond-level inventory precision.

**Strategies requiring tighter control** (HFT market making, high-frequency arbitrage) should implement custom logic using available facilities (`snapshot.openOrders`, `snapshot.lastSubmit`, strategy-level state tracking).

The framework remains honest about its guarantees: it provides best-effort tracking and deterministic replay, delegating business-specific constraints to user strategies.
