import type { Order, Position } from "@junduck/trading-core";
import type { OrderEvent } from "../types/Events.js";

/**
 * Abstract interface for trade execution and account management.
 * Implementations handle order submission, portfolio management,
 * and emit order events (order updates, fills).
 */
export abstract class TradeProvider {
  /**
   * Get the current position state from the account.
   *
   * @returns Current position including cash, commission, and realized PnL
   */
  abstract getPosition(): Promise<Position>;

  /**
   * Submit an order for execution.
   *
   * @param order - Order to submit
   * @returns Submitted order with broker-assigned ID
   */
  abstract submitOrder(order: Order): Promise<Order>;

  /**
   * Get a specific order by ID.
   *
   * @param orderId - Order ID
   * @returns Order details
   */
  abstract getOrder(orderId: string): Promise<Order>;

  /**
   * Get all open orders.
   *
   * @param options - Vendor specific options
   */
  abstract getOpenOrders(options?: unknown): Promise<Order[]>;

  /**
   * Cancel a pending order.
   *
   * @param orderId - ID of the order to cancel
   * @returns True if order was successfully cancelled
   */
  abstract cancelOrder(orderId: string): Promise<boolean>;

  /**
   * Cancel all open orders.
   *
   * @returns Number of orders cancelled
   */
  abstract cancelAllOrders(): Promise<number>;

  /**
   * Amend/modify an existing order.
   *
   * @param orderId - ID of the order to replace
   * @param updates - Order fields to update
   * @returns Updated order
   */
  abstract amendOrder(orderId: string, updates: Partial<Order>): Promise<Order>;

  /**
   * Subscribe to order events (order updates, fills) and begin event loop.
   * Must be called after connect().
   */
  abstract subscribe(): Promise<void>;

  /**
   * Unsubscribe from order events (order updates, fills).
   */
  abstract unsubscribe(): Promise<void>;

  /**
   * Connect to the trade provider with event callback.
   *
   * @param callback - Callback function called for each order event
   */
  abstract connect(callback: (event: OrderEvent) => void): Promise<void>;

  /**
   * Disconnect from the trade provider.
   */
  abstract disconnect(): Promise<void>;

  /**
   * Check if provider is currently connected.
   */
  abstract isConnected(): boolean;
}
