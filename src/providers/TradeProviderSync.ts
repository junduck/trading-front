import { BaseProviderSync } from "./BaseProviderSync.js";
import type { OrderEvent } from "../types/Events.js";
import type {
  Order,
  PartialOrder,
  Position,
} from "@junduck/trading-core/trading";

export abstract class TradeProviderSync extends BaseProviderSync<OrderEvent> {
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
  abstract getPosition(): Position;

  /**
   * Get all open orders.
   *
   * @param options - Vendor specific options
   */
  abstract getOpenOrders(): Order[];

  /**
   * Emergency panic button - synchronous, never throws, best-effort cancel all.
   *
   * Called during error handling when normal cancelAllOrders() is too risky.
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
  abstract submitOrder(orders: Order[]): number;

  /**
   * Amend/modify an existing order.
   *
   * @param orderId - ID of the order to replace
   * @param updates - Order fields to update
   * @returns Number of orders successfully amended
   */
  abstract amendOrder(updates: PartialOrder[]): number;

  /**
   * Cancel a pending order.
   *
   * @param ids - ID of the order to cancel
   * @returns Number of orders successfully cancelled
   */
  abstract cancelOrder(ids: string[]): number;

  /**
   * Cancel all open orders.
   *
   * @returns Number of orders cancelled
   */
  abstract cancelAllOrders(): number;
}
