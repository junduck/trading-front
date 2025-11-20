import type { NewsEvent } from "../types/Events.js";
import type { LiveNews } from "../types/News.js";

/**
 * Abstract interface for querying and subscribing to news data.
 *
 * Lifecycle: IDLE → CONNECTED → SUBSCRIBED → RUNNING → SUBSCRIBED → CONNECTED → IDLE
 *
 * Phase 1 (connect): Establish resources, register callback
 * Phase 2 (subscribe): Declare what topics/symbols to listen for
 * Phase 3 (begin): START event emission
 * Phase 4 (end): STOP event emission (can resume with begin)
 * Phase 5 (unsubscribe): Remove subscriptions
 * Phase 6 (disconnect): Release resources
 */
export abstract class NewsProvider {
  /**
   * Query news data with provider-specific options.
   *
   * @param options - Provider-specific query options (e.g., topics, symbols, date range)
   * @returns Array of news items matching the query criteria
   */
  abstract queryLiveNews(options?: unknown): Promise<LiveNews[]>;

  /**
   * Phase 1: Establish connection and register event callback.
   *
   * Operations:
   * - Open WebSocket connections or news feed connections
   * - Authenticate with news provider
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
   * @param callback - Function called for each news event (after begin())
   */
  abstract connect(
    callback: (event: NewsEvent) => void | Promise<void>
  ): Promise<void>;

  /**
   * Phase 2: Subscribe to news events (declarative).
   *
   * Operations:
   * - Send subscription messages to news provider
   * - Configure topic/symbol filters
   * - NO event emission yet
   *
   * State: CONNECTED → SUBSCRIBED
   *
   * Can be called multiple times to add more subscriptions.
   * Must be called after connect().
   *
   * @param options - Provider-specific subscription options (topics, symbols, etc.)
   */
  abstract subscribe(options?: unknown): Promise<void>;

  /**
   * Phase 3: START event emission (imperative trigger).
   *
   * Operations:
   * - Begin processing incoming news
   * - Enable event callbacks
   * - Start monitoring news feed
   *
   * State: SUBSCRIBED → RUNNING
   *
   * After this call, the registered callback will be invoked for news events.
   *
   * Idempotent: calling begin() when already RUNNING is a no-op.
   * Must be called after connect() and subscribe().
   */
  abstract begin(): Promise<void>;

  /**
   * Phase 4: STOP event emission (imperative stop).
   *
   * Operations:
   * - Stop processing incoming news
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
   * Phase 5: Unsubscribe from news events.
   *
   * Operations:
   * - Send unsubscribe messages
   * - Clear topic/symbol filters
   *
   * State: SUBSCRIBED → CONNECTED
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
   * - Close connections to news provider
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
