import {
  q,
  buyOrder,
  sellOrder,
  type Position,
  type Order,
} from "@junduck/trading-core";
import type { Event } from "../types/Events.js";
import type { DataProvider } from "../providers/DataProvider.js";
import type { TradeProvider } from "../providers/TradeProvider.js";
import type { ExternalProvider } from "../providers/ExternalProvider.js";
import type { Logger } from "./Logger.js";
import type { Snapshot } from "./Snapshot.js";

export type AmendAction = Partial<Order> & Pick<Order, "id">;

/**
 * Reason for an order action.
 * - `risk`: Risk management or circuit breaker
 * - `algo`: Algorithm-driven trading decision
 * - `system`: System-initiated action
 */
export type OrderActionReason = "risk" | "algo" | "system";

/**
 * Order actions that can be queued in the context.
 * Actions are executed by the order handler at the end of the middleware chain.
 */
export type OrderAction =
  | { type: "submit"; order: Order; reason: OrderActionReason }
  | { type: "cancel"; orderId: string; reason: OrderActionReason }
  | { type: "cancel_all"; reason: OrderActionReason }
  | {
      type: "amend";
      update: AmendAction;
      reason: OrderActionReason;
    };

/**
 * Context passed through the middleware chain.
 *
 * Mental model (similar to Koa):
 * - Request: {position, snapshot} - current state of the trading system
 * - Response: pendingActions[] - actions to execute (create/cancel/modify orders)
 * - Middleware can await from dataProvider and tradeProvider for extra information
 *
 * At the end of the middleware chain, pendingActions are executed
 * (similar to how Koa handles res.body).
 *
 * @template E - Event type for this context (MarketEvent, OrderEvent, ExternalEvent, or Event)
 *
 * Event type is enforced at compile-time via generics.
 * Router ensures correct event type for each strategy.
 */
export class Context<E extends Event = Event> {
  /** Current event being processed (typed to specific event) */
  readonly event: E;

  /** Current position state (request) */
  readonly position: Position;

  /** Current snapshot with market data and portfolio valuation */
  readonly snapshot: Snapshot;

  /** Data provider for querying additional market data */
  readonly dataProvider: DataProvider;

  /** Trade provider for account info and order submission */
  readonly tradeProvider: TradeProvider;

  /** External providers for external signals */
  readonly externalProviders: ExternalProvider[];

  /** Logger for middleware to log messages at different levels */
  readonly logger: Logger;

  /**
   * Event-scoped state for sharing data between middleware within this event.
   * Each event gets a fresh state map - no cross-event races.
   * Middleware can store calculated indicators, flags, etc.
   *
   * Prefer using `get()` and `set()` methods for type-safe access.
   */
  readonly state: Map<string, unknown> = new Map();

  /**
   * Pending actions to be executed (response).
   * Middleware adds actions here via createOrder(), cancelOrder(), etc.
   * Actions are processed by the order handler at the end of the chain.
   */
  private readonly pending: OrderAction[] = [];

  constructor(options: {
    event: E;
    position: Position;
    snapshot: Snapshot;
    dataProvider: DataProvider;
    tradeProvider: TradeProvider;
    externalProviders?: ExternalProvider[];
    logger: Logger;
  }) {
    this.event = options.event;
    this.position = options.position;
    this.snapshot = options.snapshot;
    this.dataProvider = options.dataProvider;
    this.tradeProvider = options.tradeProvider;
    this.externalProviders = options.externalProviders ?? [];
    this.logger = options.logger;
  }

  // ================================================================================
  // State
  // ================================================================================

  /**
   * Get a value from event-scoped state with type safety.
   *
   * @param key - State key
   * @returns The value cast to T, or undefined if not set
   *
   * @example
   * ```ts
   * const macdMap = ctx.get<Map<string, MacdValue>>("macd");
   * ```
   */
  get<T>(key: string): T | undefined;
  /**
   * Get a symbol-specific value from a symbol-keyed Map in state.
   * Common pattern for indicator data stored per symbol.
   *
   * @param key - State key for the Map
   * @param symbol - Symbol to look up in the Map
   * @returns The value for the symbol, or undefined
   *
   * @example
   * ```ts
   * const signal = ctx.get<CrossoverValue>("crossover", "000001");
   * ```
   */
  get<T>(key: string, symbol: string): T | undefined;
  get<T>(key: string, symbol?: string): T | undefined {
    const value = this.state.get(key);
    if (symbol === undefined) {
      return value as T | undefined;
    }
    if (value instanceof Map) {
      return value.get(symbol) as T | undefined;
    }
    if (typeof value === "object" && value !== null) {
      return (value as Record<string, T>)[symbol];
    }
    return undefined;
  }

  /**
   * Set a value in event-scoped state.
   *
   * @param key - State key
   * @param value - Value to store
   */
  set(key: string, value: unknown): void {
    this.state.set(key, value);
  }

  // ================================================================================
  // Position
  // ================================================================================

  /** Available cash from position */
  get cash(): number {
    return this.position.cash;
  }

  /** Total commission paid */
  get totalCommission(): number {
    return this.position.totalCommission;
  }

  /** Total realised profit and loss */
  get realisedPnL(): number {
    return this.position.realisedPnL;
  }

  holdingQty(symbol: string): number {
    return q.qty(this.position, symbol);
  }

  holdingCost(symbol: string): number {
    return q.cost(this.position, symbol);
  }

  longQty(symbol: string): number {
    return q.longQty(this.position, symbol);
  }

  shortQty(symbol: string): number {
    return q.shortQty(this.position, symbol);
  }

  longCost(symbol: string): number {
    return q.longCost(this.position, symbol);
  }

  shortProceeds(symbol: string): number {
    return q.shortProceeds(this.position, symbol);
  }

  longPnL(symbol: string): number {
    return q.longPnL(this.position, symbol);
  }

  shortPnL(symbol: string): number {
    return q.shortPnL(this.position, symbol);
  }

  hasHolding(symbol: string): boolean {
    return q.hasLong(this.position, symbol);
  }

  hasShort(symbol: string): boolean {
    return q.hasShort(this.position, symbol);
  }

  // ================================================================================
  // Valuation
  // ================================================================================

  /**
   * Get the current price for a symbol.
   * @param symbol - Symbol to look up
   * @returns Price, or 0 if not available
   */
  price(symbol: string): number {
    return this.snapshot.price(symbol);
  }

  /**
   * Get the market value for long position.
   * @param symbol - Symbol to look up
   * @returns Market value (quantity × price), or 0 if no position
   */
  value(symbol: string): number {
    return this.snapshot.value(symbol);
  }

  /**
   * Get the market liability for short position.
   * @param symbol - Symbol to look up
   * @returns Liability (quantity × price), or 0 if no position
   */
  liab(symbol: string): number {
    return this.snapshot.liab(symbol);
  }

  /**
   * Get current position equity (cash + market value - liabilities).
   */
  get equity(): number {
    return this.snapshot.equity;
  }

  /**
   * @param order - Order to create
   * @param reason - Reason for submitting the order
   */
  submitOrder(order: Order, reason: OrderActionReason = "algo") {
    this.pending.push({ type: "submit", order, reason });
  }

  /**
   * Cancel an existing order.
   *
   * @param orderId - ID of the order to cancel
   * @param reason - Reason for canceling the order
   */
  cancelOrder(orderId: string, reason: OrderActionReason = "algo") {
    this.pending.push({ type: "cancel", orderId, reason });
  }

  /**
   * Cancel all open orders (circuit breaker).
   *
   * @param reason - Reason for canceling all orders
   */
  cancelAllOrders(reason: OrderActionReason = "risk") {
    this.pending.push({ type: "cancel_all", reason });
  }

  /**
   * Modify an existing order.
   *
   * @param orderId - ID of the order to modify
   * @param updates - Order fields to update
   * @param reason - Reason for amending the order
   * @returns order id
   */
  amendOrder(update: AmendAction, reason: OrderActionReason = "algo") {
    this.pending.push({ type: "amend", update, reason });
  }

  /**
   * Get all pending actions (typically used by the order handler middleware).
   *
   * @returns Array of pending actions
   * @internal
   */
  getPending(): OrderAction[] {
    return this.pending;
  }

  /**
   * Buy at market price (open long position).
   *
   * @param symbol - Symbol to buy
   * @param quantity - Quantity to buy
   * @param reason - Reason for the order (default: "algo")
   * @returns order id
   */
  buyMarket(
    symbol: string,
    quant: number,
    reason: OrderActionReason = "algo"
  ): string {
    const id = this.tradeProvider.genOrderId();
    const order = buyOrder({
      id,
      symbol,
      quant,
      created: this.event.timestamp,
    });
    this.submitOrder(order, reason);

    return id;
  }

  /**
   * Sell at market price (close long position).
   *
   * @param symbol - Symbol to sell
   * @param quantity - Quantity to sell
   * @param reason - Reason for the order (default: "algo")
   * @returns order id
   */
  sellMarket(
    symbol: string,
    quant: number,
    reason: OrderActionReason = "algo"
  ): string {
    const id = this.tradeProvider.genOrderId();
    const order = sellOrder({
      id,
      symbol,
      quant,
      created: this.event.timestamp,
    });
    this.submitOrder(order, reason);

    return id;
  }

  /**
   * Buy with limit order (open long position).
   *
   * @param symbol - Symbol to buy
   * @param quantity - Quantity to buy
   * @param price - Limit price
   * @param reason - Reason for the order (default: "algo")
   * @returns order id
   */
  buy(
    symbol: string,
    quant: number,
    price: number,
    reason: OrderActionReason = "algo"
  ): string {
    const id = this.tradeProvider.genOrderId();
    const order = buyOrder({
      id,
      symbol,
      quant,
      price,
      created: this.event.timestamp,
    });
    this.submitOrder(order, reason);

    return id;
  }

  /**
   * Sell with limit order (close long position).
   *
   * @param symbol - Symbol to sell
   * @param quantity - Quantity to sell
   * @param price - Limit price
   * @param reason - Reason for the order (default: "algo")
   * @returns order id
   */
  sell(
    symbol: string,
    quant: number,
    price: number,
    reason: OrderActionReason = "algo"
  ): string {
    const id = this.tradeProvider.genOrderId();
    const order = sellOrder({
      id,
      symbol,
      quant,
      price,
      created: this.event.timestamp,
    });
    this.submitOrder(order, reason);

    return id;
  }
}
