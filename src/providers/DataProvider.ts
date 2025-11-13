import type { MarketBar, MarketQuote } from "@junduck/trading-core";
import type { MarketEvent } from "../types/Events.js";

/**
 * Abstract interface for querying and subscribing to market data.
 * Implementations provide access to current and historical market information,
 * and emit market events.
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
   * Subscribe to real-time market events for specific symbols.
   * Must be called after connect().
   *
   * @param symbols - Array of symbols to subscribe to
   */
  abstract subscribeSymbols(symbols: string[]): Promise<void>;

  /**
   * Subscribe to real-time market events with provider-specific options.
   * Examples: industry, asset class, market data type, etc.
   *
   * @param options - Provider-specific subscription options
   */
  abstract subscribe(options?: unknown): Promise<void>;

  /**
   * Unsubscribe from market events for specific symbols.
   *
   * @param symbols - Array of symbols to unsubscribe from
   */
  abstract unsubscribeSymbols(symbols: string[]): Promise<void>;

  /**
   * Unsubscribe from market events events with provider-specific options.
   *
   * @param symbols - Array of symbols to unsubscribe from
   */
  abstract unsubscribe(options?: unknown): Promise<void>;

  /**
   * Connect to the data source with event callback.
   *
   * @param callback - Callback function called for each market event
   */
  abstract connect(callback: (event: MarketEvent) => void): Promise<void>;

  /**
   * Disconnect from the data source.
   */
  abstract disconnect(): Promise<void>;

  /**
   * Check if provider is currently connected.
   */
  abstract isConnected(): boolean;
}
