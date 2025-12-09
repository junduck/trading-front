import { BaseProvider } from "./BaseProvider.js";
import type { MarketEvent } from "../types/Events.js";

/**
 * Abstract interface for subscribing to market data.
 */
export abstract class DataProvider extends BaseProvider<MarketEvent> {
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
}
