import { BaseProvider } from "./BaseProvider.js";
import type { OrderEvent } from "../types/Events.js";
import type {
  Order,
  PartialOrder,
  Position,
} from "@junduck/trading-core/trading";

/**
 * Abstract interface for trade execution and account management.
 */
export abstract class TradeProvider extends BaseProvider<OrderEvent> {
  /**
   * Generate a unique order ID.
   * Provider-specific
   *
   * @returns Unique order ID
   */
  abstract genOrderId(): string;

  /**
   * Get the current position state from the account.
   *
   * @returns Current position including cash, commission, and realized PnL
   */
  abstract getPosition(): Promise<Position>;

  /**
   * Get all open orders.
   *
   * @param options - Vendor specific options
   */
  abstract getOpenOrders(): Promise<Order[]>;

  /**
   * Emergency panic button - synchronous, never throws, best-effort cancel all.
   *
   * Called during error handling when normal async cancelAllOrders() is too risky.
   * Provider should implement whatever "best effort" means for their business:
   * - Spawn background task to retry cancelAllOrders()
   * - Send notifications/alerts to user
   * - Call emergency API endpoints
   * - Whatever makes sense for the provider's domain
   *
   * Semantic contract:
   * - MUST be synchronous (fire and forget)
   * - MUST never throw
   * - Provider decides implementation details
   */
  abstract emergencyCancel(): void;

  /**
   * Submit an order for execution.
   *
   * @param order - Order to submit
   * @returns Number of orders submitted
   */
  abstract submitOrder(orders: Order[]): Promise<number>;

  /**
   * Amend/modify an existing order.
   *
   * @param orderId - ID of the order to replace
   * @param updates - Order fields to update
   * @returns True if order was successfully amended
   */
  abstract amendOrder(updates: PartialOrder[]): Promise<number>;

  /**
   * Cancel a pending order.
   *
   * @param ids - ID of the order to cancel
   * @returns True if order was successfully cancelled
   */
  abstract cancelOrder(ids: string[]): Promise<number>;

  /**
   * Cancel all open orders.
   *
   * @returns Number of orders cancelled
   */
  abstract cancelAllOrders(): Promise<number>;
}
