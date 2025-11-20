import type { MarketBar, MarketQuote } from "@junduck/trading-core";
import type { MarketEvent } from "../types/Events.js";

/**
 * Abstract interface for querying and subscribing to market data.
 *
 * Lifecycle: IDLE → CONNECTED → SUBSCRIBED → RUNNING → SUBSCRIBED → CONNECTED → IDLE
 *
 * Phase 1 (connect): Establish resources, register callback
 * Phase 2 (subscribe): Declare what symbols/topics to listen for
 * Phase 3 (begin): START event emission
 * Phase 4 (end): STOP event emission (can resume with begin)
 * Phase 5 (unsubscribe): Remove subscriptions
 * Phase 6 (disconnect): Release resources
 */
export abstract class DataProvider {
  /**
   * Query current market quote data for a single symbol.
   *
   * @param symbol - Trading symbol to query
   * @returns Market data for the symbol
   */
  abstract queryQuote(
    symbol: string,
    options?: unknown
  ): Promise<MarketQuote[]>;

  /**
   * Query current market bar data for a single symbol.
   *
   * @param symbol - Trading symbol to query
   * @returns Market data for the symbol
   */
  abstract queryBar(symbol: string, options?: unknown): Promise<MarketBar[]>;

  /**
   * Phase 1: Establish connection and register event callback.
   *
   * Operations:
   * - Open WebSocket connections or file handles
   * - Authenticate with data source
   * - Register callback function
   * - NO event emission yet
   *
   * State: IDLE → CONNECTED
   *
   * Invariants after completion:
   * - isConnected() returns true
   * - Callback registered but not invoked
   * - Resources allocated but idle
   *
   * @param callback - Function called for each market event (after begin())
   */
  abstract connect(
    callback: (event: MarketEvent) => void | Promise<void>
  ): Promise<void>;

  /**
   * Phase 2a: Subscribe to market events for specific symbols (declarative).
   *
   * Operations:
   * - Send subscription messages to broker/exchange
   * - Configure symbol filters
   * - NO event emission yet (even if messages arrive)
   *
   * State: CONNECTED → SUBSCRIBED (if first subscription)
   *
   * Can be called multiple times to add more subscriptions.
   * Must be called after connect().
   *
   * @param symbols - Array of symbols to subscribe to
   */
  abstract subscribeSymbols(symbols: string[]): Promise<void>;

  /**
   * Phase 2b: Subscribe to market events with provider-specific options.
   *
   * Examples: subscribe to industry sectors, asset classes, or market data types.
   *
   * Operations:
   * - Configure topic/channel subscriptions
   * - NO event emission yet
   *
   * State: CONNECTED → SUBSCRIBED (if first subscription)
   *
   * Must be called after connect().
   *
   * @param options - Provider-specific subscription options
   */
  abstract subscribe(options?: unknown): Promise<void>;

  /**
   * Phase 3: START event emission (imperative trigger).
   *
   * Operations:
   * - Begin processing incoming messages
   * - Start data replay (for backtest providers)
   * - Enable event callbacks
   * - Start internal timers (if applicable)
   *
   * State: SUBSCRIBED → RUNNING
   *
   * After this call, the registered callback will be invoked for market events.
   * For backtest providers, may block until all historical data is replayed.
   * For live providers, runs indefinitely until end() is called.
   *
   * Idempotent: calling begin() when already RUNNING is a no-op.
   * Must be called after connect() and subscribe().
   */
  abstract begin(): Promise<void>;

  /**
   * Phase 4: STOP event emission (imperative stop).
   *
   * Operations:
   * - Stop processing incoming messages
   * - Stop timers/intervals
   * - Flush pending events
   * - Keep subscriptions active (can resume later with begin())
   *
   * State: RUNNING → SUBSCRIBED
   *
   * After this call, no new events are emitted, but subscriptions remain configured.
   * Can call begin() again to resume event emission.
   *
   * Idempotent: calling end() when not RUNNING is a no-op.
   */
  abstract end(): Promise<void>;

  /**
   * Phase 5a: Unsubscribe from market events for specific symbols.
   *
   * Operations:
   * - Send unsubscribe messages
   * - Remove symbols from subscription set
   *
   * State: SUBSCRIBED → CONNECTED (if no subscriptions remain)
   *        RUNNING → CONNECTED (implicitly calls end() if needed)
   *
   * @param symbols - Array of symbols to unsubscribe from
   */
  abstract unsubscribeSymbols(symbols: string[]): Promise<void>;

  /**
   * Phase 5b: Unsubscribe from market events with provider-specific options.
   *
   * State: SUBSCRIBED → CONNECTED (if no subscriptions remain)
   *        RUNNING → CONNECTED (implicitly calls end() if needed)
   *
   * @param options - Provider-specific unsubscription options
   */
  abstract unsubscribe(options?: unknown): Promise<void>;

  /**
   * Phase 6: Release all resources and disconnect.
   *
   * Operations:
   * - Implicitly calls end() if RUNNING
   * - Implicitly calls unsubscribe() if SUBSCRIBED
   * - Close WebSocket or file handles
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
