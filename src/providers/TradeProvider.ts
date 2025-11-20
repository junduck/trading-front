import type { Order, Position } from "@junduck/trading-core";
import type { OrderEvent } from "../types/Events.js";

/**
 * Abstract interface for trade execution and account management.
 *
 * Lifecycle: IDLE → CONNECTED → SUBSCRIBED → RUNNING → SUBSCRIBED → CONNECTED → IDLE
 *
 * Phase 1 (connect): Establish resources, register callback
 * Phase 2 (subscribe): Declare intent to receive order events
 * Phase 3 (begin): START event emission
 * Phase 4 (end): STOP event emission (can resume with begin)
 * Phase 5 (unsubscribe): Stop listening for order events
 * Phase 6 (disconnect): Release resources
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
   * Amend/modify an existing order.
   *
   * @param orderId - ID of the order to replace
   * @param updates - Order fields to update
   * @returns Updated order
   */
  abstract amendOrder(orderId: string, updates: Partial<Order>): Promise<Order>;

  /**
   * Phase 1: Establish connection and register event callback.
   *
   * Operations:
   * - Open WebSocket connections or broker API connections
   * - Authenticate with broker
   * - Register callback function
   * - NO event emission yet
   *
   * State: IDLE → CONNECTED
   *
   * Invariants after completion:
   * - isConnected() returns true
   * - Callback registered but not invoked
   * - Can query position and submit orders
   *
   * @param callback - Function called for each order event (after begin())
   */
  abstract connect(
    callback: (event: OrderEvent) => void | Promise<void>
  ): Promise<void>;

  /**
   * Phase 2: Subscribe to order events (declarative).
   *
   * Operations:
   * - Send subscription messages to broker
   * - Configure order update channels
   * - NO event emission yet
   *
   * State: CONNECTED → SUBSCRIBED
   *
   * Must be called after connect().
   */
  abstract subscribe(): Promise<void>;

  /**
   * Phase 3: START event emission (imperative trigger).
   *
   * Operations:
   * - Begin processing incoming order updates
   * - Enable event callbacks
   * - Start monitoring order fills
   *
   * State: SUBSCRIBED → RUNNING
   *
   * After this call, the registered callback will be invoked for order events.
   * For backtest providers, processes fills as market data arrives.
   * For live providers, monitors order updates from broker.
   *
   * Idempotent: calling begin() when already RUNNING is a no-op.
   * Must be called after connect() and subscribe().
   */
  abstract begin(): Promise<void>;

  /**
   * Phase 4: STOP event emission (imperative stop).
   *
   * Operations:
   * - Stop processing incoming order updates
   * - Keep subscription active (can resume later with begin())
   *
   * State: RUNNING → SUBSCRIBED
   *
   * After this call, no new events are emitted, but subscription remains configured.
   * Can call begin() again to resume event emission.
   *
   * Idempotent: calling end() when not RUNNING is a no-op.
   */
  abstract end(): Promise<void>;

  /**
   * Phase 5: Unsubscribe from order events.
   *
   * Operations:
   * - Send unsubscribe messages
   * - Stop listening for order updates
   *
   * State: SUBSCRIBED → CONNECTED
   *        RUNNING → CONNECTED (implicitly calls end() if needed)
   */
  abstract unsubscribe(): Promise<void>;

  /**
   * Phase 6: Release all resources and disconnect.
   *
   * Operations:
   * - Implicitly calls end() if RUNNING
   * - Implicitly calls unsubscribe() if SUBSCRIBED
   * - Close connections to broker
   * - Clear callback reference
   *
   * State: any → IDLE
   *
   * After this call, isConnected() returns false.
   * Can call connect() again to restart the lifecycle.
   */
  abstract disconnect(): Promise<void>;

  /**
   * Check if provider is currently connected.
   *
   * @returns true if in CONNECTED, SUBSCRIBED, or RUNNING state
   */
  abstract isConnected(): boolean;
}
