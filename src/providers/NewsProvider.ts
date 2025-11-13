import type { NewsEvent } from "../types/Events.js";
import type { LiveNews } from "../types/News.js";

/**
 * Abstract interface for querying and subscribing to news data.
 * Implementations provide access to news events filtered by topics and symbols,
 * and emit news events.
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
   * Subscribe to news and begin event loop.
   * Must be called after connect().
   */
  abstract subscribe(): Promise<void>;

  /**
   * Unsubscribe from news.
   */
  abstract unsubscribe(): Promise<void>;

  /**
   * Connect to the news source with event callback.
   *
   * @param callback - Callback function called for each news event
   */
  abstract connect(callback: (event: NewsEvent) => void): Promise<void>;

  /**
   * Disconnect from the news source.
   */
  abstract disconnect(): Promise<void>;

  /**
   * Check if provider is currently connected.
   */
  abstract isConnected(): boolean;
}
