import type { Position, MarketSnapshot, Order } from "@junduck/trading-core";
import type { Event } from "../types/Events.js";
import type { DataProvider } from "../providers/DataProvider.js";
import type { TradeProvider } from "../providers/TradeProvider.js";
import type { NewsProvider } from "../providers/NewsProvider.js";
import type { Logger } from "./Logger.js";

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
      orderId: string;
      updates: Partial<Order>;
      reason: OrderActionReason;
    };

/**
 * A pending action with tracking information.
 */
export interface PendingAction {
  /** The action to be executed */
  action: OrderAction;
  /** Unique ID for tracking this pending action */
  trackingId: string;
}

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
 * Event type is determined at runtime via router tag dispatch.
 * Router ensures correct event type for each strategy.
 */
export class Context {
  /** Current event being processed (type determined by router) */
  readonly event: Event;

  /** Current position state (request) */
  readonly position: Position;

  /** Current LOCF market snapshot (request) */
  readonly snapshot: MarketSnapshot;

  /** Data provider for querying additional market data */
  readonly dataProvider: DataProvider;

  /** Trade provider for account info and order submission */
  readonly tradeProvider: TradeProvider;

  /** News provider for querying news data (optional) */
  readonly newsProvider?: NewsProvider | undefined;

  /** Logger for middleware to log messages at different levels */
  readonly logger: Logger;

  // TODO: High-performance market data time series cache
  // Add: symbol -> {time, data}[] for historical data access

  /**
   * Event-scoped state for sharing data between middleware within this event.
   * Each event gets a fresh state map - no cross-event races.
   * Middleware can store calculated indicators, flags, etc.
   */
  readonly state: Map<string, unknown> = new Map();

  /**
   * Pending actions to be executed (response).
   * Middleware adds actions here via createOrder(), cancelOrder(), etc.
   * Actions are processed by the order handler at the end of the chain.
   */
  private readonly pendingActions: PendingAction[] = [];
  private trackingIdCounter = 0;

  constructor(options: {
    event: Event;
    position: Position;
    snapshot: MarketSnapshot;
    dataProvider: DataProvider;
    tradeProvider: TradeProvider;
    newsProvider?: NewsProvider | undefined;
    logger: Logger;
  }) {
    this.event = options.event;
    this.position = options.position;
    this.snapshot = options.snapshot;
    this.dataProvider = options.dataProvider;
    this.tradeProvider = options.tradeProvider;
    this.newsProvider = options.newsProvider;
    this.logger = options.logger;
  }

  /**
   * Create a new order to be processed by the order handler at the end of the middleware chain.
   * Middleware should use this instead of directly calling tradeProvider.submitOrder().
   *
   * @param order - Order to create
   * @param reason - Reason for submitting the order
   * @returns Tracking ID for checking action status later
   */
  submitOrder(order: Order, reason: OrderActionReason = "algo"): string {
    const trackingId = `${Date.now()}-${this.trackingIdCounter++}`;
    this.pendingActions.push({
      action: { type: "submit", order, reason },
      trackingId,
    });
    return trackingId;
  }

  /**
   * Cancel an existing order.
   *
   * @param orderId - ID of the order to cancel
   * @param reason - Reason for canceling the order
   * @returns Tracking ID for checking action status later
   */
  cancelOrder(orderId: string, reason: OrderActionReason = "algo"): string {
    const trackingId = `${Date.now()}-${this.trackingIdCounter++}`;
    this.pendingActions.push({
      action: { type: "cancel", orderId, reason },
      trackingId,
    });
    return trackingId;
  }

  /**
   * Cancel all open orders (circuit breaker).
   * Use this for emergency situations or risk management.
   *
   * @param reason - Reason for canceling all orders
   * @returns Tracking ID for checking action status later
   */
  cancelAllOrders(reason: OrderActionReason = "risk"): string {
    const trackingId = `${Date.now()}-${this.trackingIdCounter++}`;
    this.pendingActions.push({
      action: { type: "cancel_all", reason },
      trackingId,
    });
    return trackingId;
  }

  /**
   * Modify an existing order.
   *
   * @param orderId - ID of the order to modify
   * @param updates - Order fields to update
   * @param reason - Reason for amending the order
   * @returns Tracking ID for checking action status later
   */
  amendOrder(
    orderId: string,
    updates: Partial<Order>,
    reason: OrderActionReason = "algo"
  ): string {
    const trackingId = `${Date.now()}-${this.trackingIdCounter++}`;
    this.pendingActions.push({
      action: { type: "amend", orderId, updates, reason },
      trackingId,
    });
    return trackingId;
  }

  /**
   * Get all pending actions (typically used by the order handler middleware).
   *
   * @returns Array of pending actions
   * @internal
   */
  getPendingActions(): PendingAction[] {
    return this.pendingActions;
  }

  /**
   * Buy at market price (open long position).
   *
   * @param symbol - Symbol to buy
   * @param quantity - Quantity to buy
   * @param reason - Reason for the order (default: "algo")
   * @returns Tracking ID for checking action status later
   *
   * @example
   * ```ts
   * ctx.buyMarket("AAPL", 100);
   * ```
   */
  buyMarket(
    symbol: string,
    quantity: number,
    reason: OrderActionReason = "algo"
  ): string {
    const order: Order = {
      id: this.tradeProvider.genOrderId(),
      symbol,
      side: "BUY",
      effect: "OPEN_LONG",
      type: "MARKET",
      quantity,
      created: this.event.timestamp,
    };

    return this.submitOrder(order, reason);
  }

  /**
   * Sell at market price (close long position).
   *
   * @param symbol - Symbol to sell
   * @param quantity - Quantity to sell
   * @param reason - Reason for the order (default: "algo")
   * @returns Tracking ID for checking action status later
   *
   * @example
   * ```ts
   * ctx.sellMarket("AAPL", 100);
   * ```
   */
  sellMarket(
    symbol: string,
    quantity: number,
    reason: OrderActionReason = "algo"
  ): string {
    const order: Order = {
      id: this.tradeProvider.genOrderId(),
      symbol,
      side: "SELL",
      effect: "CLOSE_LONG",
      type: "MARKET",
      quantity,
      created: this.event.timestamp,
    };

    return this.submitOrder(order, reason);
  }

  /**
   * Buy with limit order (open long position).
   *
   * @param symbol - Symbol to buy
   * @param quantity - Quantity to buy
   * @param price - Limit price
   * @param reason - Reason for the order (default: "algo")
   * @returns Tracking ID for checking action status later
   *
   * @example
   * ```ts
   * ctx.buy("AAPL", 100, 150.00);
   * ```
   */
  buy(
    symbol: string,
    quantity: number,
    price: number,
    reason: OrderActionReason = "algo"
  ): string {
    const order: Order = {
      id: this.tradeProvider.genOrderId(),
      symbol,
      side: "BUY",
      effect: "OPEN_LONG",
      type: "LIMIT",
      quantity,
      price,
      created: this.event.timestamp,
    };

    return this.submitOrder(order, reason);
  }

  /**
   * Sell with limit order (close long position).
   *
   * @param symbol - Symbol to sell
   * @param quantity - Quantity to sell
   * @param price - Limit price
   * @param reason - Reason for the order (default: "algo")
   * @returns Tracking ID for checking action status later
   *
   * @example
   * ```ts
   * ctx.sell("AAPL", 100, 155.00);
   * ```
   */
  sell(
    symbol: string,
    quantity: number,
    price: number,
    reason: OrderActionReason = "algo"
  ): string {
    const order: Order = {
      id: this.tradeProvider.genOrderId(),
      symbol,
      side: "SELL",
      effect: "CLOSE_LONG",
      type: "LIMIT",
      quantity,
      price,
      created: this.event.timestamp,
    };

    return this.submitOrder(order, reason);
  }
}
