import type {
  Position,
  MarketSnapshot,
  Order,
  OrderState,
} from "@junduck/trading-core";
import { createPosition, amendLongPositionLot } from "@junduck/trading-core";
import { Context, type OrderAction } from "../../src/core/Context.js";
import type {
  Event,
  MarketEvent,
  OrderEvent,
  NewsEvent,
} from "../../src/types/Events.js";
import type { DataProvider } from "../../src/providers/DataProvider.js";
import type { TradeProvider } from "../../src/providers/TradeProvider.js";
import type { NewsProvider } from "../../src/providers/NewsProvider.js";
import type { Logger } from "../../src/core/Logger.js";

/**
 * Mock next function for testing middleware.
 * Tracks whether next() was called and how many times.
 */
export class MockNext {
  private _called = false;
  private _callCount = 0;

  /**
   * The mock next function to pass to middleware.
   * Call this as: await middleware(mockCtx, mockNext.fn);
   */
  fn = async (): Promise<void> => {
    this._called = true;
    this._callCount++;
  };

  /** Check if next() was called at least once */
  get called(): boolean {
    return this._called;
  }

  /** Get the number of times next() was called */
  get callCount(): number {
    return this._callCount;
  }

  /** Reset the call tracking state */
  reset(): void {
    this._called = false;
    this._callCount = 0;
  }
}

/**
 * Mock context class with simplified testing APIs.
 * Extends Context to provide easier access to pending actions.
 */
export class MockContext extends Context {
  /**
   * Get all submitted orders (excluding cancels/amends).
   */
  getSubmittedOrders(): Order[] {
    return this.getPendingActions()
      .filter((pa) => pa.action.type === "submit")
      .map(
        (pa) => (pa.action as Extract<OrderAction, { type: "submit" }>).order
      );
  }

  /**
   * Get order IDs that were cancelled.
   */
  getCancelledOrderIds(): string[] {
    return this.getPendingActions()
      .filter((pa) => pa.action.type === "cancel")
      .map(
        (pa) => (pa.action as Extract<OrderAction, { type: "cancel" }>).orderId
      );
  }

  /**
   * Check if a cancel all orders action was queued.
   */
  hasCancelAllOrders(): boolean {
    return this.getPendingActions().some(
      (pa) => pa.action.type === "cancel_all"
    );
  }

  /**
   * Get amended order IDs.
   */
  getAmendedOrderIds(): string[] {
    return this.getPendingActions()
      .filter((pa) => pa.action.type === "amend")
      .map(
        (pa) => (pa.action as Extract<OrderAction, { type: "amend" }>).orderId
      );
  }

  /**
   * Check if there's a buy order for the given symbol.
   */
  hasBuyOrder(symbol: string): boolean {
    return this.getSubmittedOrders().some(
      (order) => order.symbol === symbol && order.side === "BUY"
    );
  }

  /**
   * Check if there's a sell order for the given symbol.
   */
  hasSellOrder(symbol: string): boolean {
    return this.getSubmittedOrders().some(
      (order) => order.symbol === symbol && order.side === "SELL"
    );
  }

  /**
   * Get all buy orders.
   */
  getBuyOrders(): Order[] {
    return this.getSubmittedOrders().filter((order) => order.side === "BUY");
  }

  /**
   * Get all sell orders.
   */
  getSellOrders(): Order[] {
    return this.getSubmittedOrders().filter((order) => order.side === "SELL");
  }

  /**
   * Get orders for a specific symbol.
   */
  getOrdersForSymbol(symbol: string): Order[] {
    return this.getSubmittedOrders().filter((order) => order.symbol === symbol);
  }

  /**
   * Get total number of pending actions.
   */
  getActionCount(): number {
    return this.getPendingActions().length;
  }

  /**
   * Clear all pending actions (useful for testing multiple scenarios).
   */
  clearPendingActions(): void {
    this.getPendingActions().length = 0;
  }
}

const DUMMY_TIME = new Date(0);

/**
 * No-op mock providers for testing.
 * Use these when middleware doesn't need actual provider functionality.
 */
const noopDataProvider: DataProvider = {
  queryQuote: async () => [],
  queryBar: async () => [],
  connect: async () => {},
  subscribeSymbols: async () => {},
  subscribe: async () => {},
  begin: async () => {},
  end: async () => {},
  unsubscribeSymbols: async () => {},
  unsubscribe: async () => {},
  disconnect: async () => {},
  isConnected: () => false,
};

const noopTradeProvider: TradeProvider = {
  genOrderId: () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  getPosition: async () => createPosition(0),
  submitOrder: async (order) => order,
  getOrder: async () => ({} as Order),
  getOpenOrders: async () => [],
  cancelOrder: async () => true,
  cancelAllOrders: async () => 0,
  emergencyCancel: () => {},
  amendOrder: async (_, updates) => updates as Order,
  connect: async () => {},
  subscribe: async () => {},
  begin: async () => {},
  end: async () => {},
  unsubscribe: async () => {},
  disconnect: async () => {},
  isConnected: () => false,
};

const noopLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
} as any;

/**
 * Options for creating a mock context.
 */
export interface MockContextOptions {
  /** Event to use (required) */
  event: Event;
  /** Position state (default: empty position with 10000 cash) */
  position?: Position;
  /** Market snapshot (default: derived from event if market event, else empty) */
  snapshot?: MarketSnapshot;
  /** Data provider (default: noop provider) */
  dataProvider?: DataProvider;
  /** Trade provider (default: noop provider) */
  tradeProvider?: TradeProvider;
  /** News provider (default: undefined) */
  newsProvider?: NewsProvider;
  /** Logger (default: noop logger) */
  logger?: Logger;
  /** Pre-populate state (default: empty) */
  initialState?: Map<string, unknown>;
}

/**
 * Creates a mock context for testing middleware.
 *
 * Returns a MockContext instance with simplified testing APIs:
 * - getSubmittedOrders() - Get all submitted orders
 * - hasBuyOrder(symbol) - Check if buy order exists
 * - hasSellOrder(symbol) - Check if sell order exists
 * - getCancelledOrderIds() - Get cancelled order IDs
 * - hasCancelAllOrders() - Check if cancel all was called
 * - And more...
 *
 * @example
 * ```ts
 * // Test a middleware that sets state and calls next()
 * const ctx = createMockContext({
 *   event: createMarketEvent("AAPL", 150)
 * });
 * const next = new MockNext();
 *
 * await myMiddleware(ctx, next.fn);
 *
 * expect(next.called).toBe(true);
 * expect(ctx.state.get("myKey")).toBe("myValue");
 * expect(ctx.getActionCount()).toBe(0);
 * ```
 *
 * @example
 * ```ts
 * // Test a middleware that creates orders (simplified!)
 * const ctx = createMockContext({
 *   event: createMarketEvent("AAPL", 150),
 * });
 *
 * await myTradingMiddleware(ctx, async () => {});
 *
 * // Simplified assertions
 * expect(ctx.hasBuyOrder("AAPL")).toBe(true);
 * expect(ctx.getSubmittedOrders()).toHaveLength(1);
 * expect(ctx.getSubmittedOrders()[0].quantity).toBe(100);
 * ```
 */
export function createMockContext(options: MockContextOptions): MockContext {
  const { event, initialState } = options;

  // Default position: 10000 cash
  const position = options.position ?? createCashPosition(10000);

  // Default snapshot: derive from event if market event
  let snapshot = options.snapshot;
  if (!snapshot) {
    const priceMap = new Map<string, number>();
    if (event.type === "market") {
      for (const quote of event.marketData) {
        if (quote.price !== undefined) {
          priceMap.set(quote.symbol, quote.price);
        }
      }
    }
    snapshot = {
      timestamp: event.timestamp,
      price: priceMap,
    };
  }

  const ctx = new MockContext({
    event,
    position,
    snapshot,
    dataProvider: options.dataProvider ?? noopDataProvider,
    tradeProvider: options.tradeProvider ?? noopTradeProvider,
    newsProvider: options.newsProvider,
    logger: options.logger ?? noopLogger,
  });

  // Pre-populate state if provided
  if (initialState) {
    for (const [key, value] of initialState.entries()) {
      ctx.state.set(key, value);
    }
  }

  return ctx;
}

/**
 * Creates a market event for testing.
 *
 * @param symbol - Symbol for the quote
 * @param price - Price for the quote
 * @param timestamp - Event timestamp (default: now)
 */
export function createMarketEvent(
  symbol: string,
  price: number,
  timestamp = new Date()
): MarketEvent {
  return {
    type: "market",
    timestamp,
    marketData: [{ symbol, price, timestamp }],
  };
}

/**
 * Creates a market event with multiple symbols.
 *
 * @param quotes - Array of [symbol, price] tuples
 * @param timestamp - Event timestamp (default: now)
 */
export function createMultiMarketEvent(
  quotes: Array<[string, number]>,
  timestamp = new Date()
): MarketEvent {
  return {
    type: "market",
    timestamp,
    marketData: quotes.map(([symbol, price]) => ({ symbol, price, timestamp })),
  };
}

/**
 * Creates an order event for testing.
 *
 * @param orderState - Partial order state (will fill in defaults)
 * @param timestamp - Event timestamp (default: now)
 */
export function createOrderEvent(
  orderState: Partial<OrderState> & { id: string; symbol: string },
  timestamp = new Date()
): OrderEvent {
  // Build OrderState with proper defaults, respecting discriminated union
  const side = orderState.side ?? "BUY";

  const baseOrder = {
    id: orderState.id,
    symbol: orderState.symbol,
    type: orderState.type ?? ("MARKET" as const),
    quantity: orderState.quantity ?? 100,
    price: orderState.price,
    stopPrice: orderState.stopPrice,
    created: orderState.created ?? timestamp,
    filledQuantity: orderState.filledQuantity ?? 100,
    remainingQuantity: orderState.remainingQuantity ?? 0,
    status: orderState.status ?? ("FILLED" as const),
    modified: orderState.modified ?? timestamp,
  };

  const state: OrderState =
    side === "BUY"
      ? { side: "BUY", effect: "OPEN_LONG", ...baseOrder }
      : { side: "SELL", effect: "CLOSE_LONG", ...baseOrder };

  return {
    type: "order",
    timestamp,
    state,
  };
}

/**
 * Creates a news event for testing.
 *
 * @param title - News title
 * @param content - News content
 * @param symbols - Related symbols (optional)
 * @param timestamp - Event timestamp (default: now)
 */
export function createNewsEvent(
  title: string,
  content: string,
  symbols?: string[],
  timestamp = new Date()
): NewsEvent {
  return {
    type: "news",
    timestamp,
    newsData: [{ title, content, symbols, timestamp }],
  };
}

/**
 * Creates a position with only cash, no holdings.
 */
export function createCashPosition(cash: number): Position {
  return createPosition(cash);
}

/**
 * Creates a position with equal-weighted holdings.
 * All symbols receive the same number of shares.
 */
export function createEqualWeightedPosition(
  symbols: string[],
  shares: number,
  cash = 0
): Position {
  const position = createPosition(cash);
  for (const symbol of symbols) {
    amendLongPositionLot(
      position,
      symbol,
      { quantity: shares, price: 100, totalCost: shares * 100 },
      DUMMY_TIME
    );
  }
  return position;
}

/**
 * Creates a position with linear-weighted holdings.
 * Shares increase linearly: base, base+step, base+2*step, etc.
 */
export function createLinearWeightedPosition(
  symbols: string[],
  base: number,
  step: number,
  cash = 0
): Position {
  const position = createPosition(cash);
  for (let i = 0; i < symbols.length; i++) {
    const shares = base + i * step;
    amendLongPositionLot(
      position,
      symbols[i],
      { quantity: shares, price: 100, totalCost: shares * 100 },
      DUMMY_TIME
    );
  }
  return position;
}

/**
 * Creates a position with exponential-weighted holdings.
 * Shares grow exponentially: base, base*(1+growth), base*(1+growth)^2, etc.
 */
export function createExpWeightedPosition(
  symbols: string[],
  base: number,
  growth: number,
  cash = 0
): Position {
  const position = createPosition(cash);
  for (let i = 0; i < symbols.length; i++) {
    const shares = Math.round(base * Math.pow(1 + growth, i));
    amendLongPositionLot(
      position,
      symbols[i],
      { quantity: shares, price: 100, totalCost: shares * 100 },
      DUMMY_TIME
    );
  }
  return position;
}
