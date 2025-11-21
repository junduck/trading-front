import type { MarketBar, MarketQuote } from "@junduck/trading-core";
import { DataProvider } from "../providers/DataProvider.js";
import type { MarketEvent } from "../types/Events.js";
import { SinaHqParser } from "./SinaHqParser.js";
import { TradingErrors } from "../core/TradingError.js";

/**
 * Sina HQ quote data.
 * Note: Some fields may not be available for all markets (e.g., HK lacks bid/ask depth).
 */
export interface SinaHqQuote {
  symbol: string;
  name: string;

  open: number;
  preClose: number;
  price: number;
  high: number;
  low: number;
  bid: number;
  ask: number;

  totalVolume: number;
  totalTurnover: number;

  bid_price?: number[];
  bid_volume?: number[];
  ask_price?: number[];
  ask_volume?: number[];

  timestamp: Date;
}

/** Options for Sina HQ subscription */
export interface SinaHqSubscribeOptions {
  symbols?: string[];
  pollInterval?: number;
}

/**
 * Data provider implementation for Sina Finance real-time quotes.
 * Polls Sina's HQ service for market data.
 * @platform node
 */
export class SinaHqProvider extends DataProvider {
  private static readonly BASE_URL = "https://hq.sinajs.cn";
  private static readonly DEFAULT_POLL_INTERVAL = 3000;

  private connected = false;
  private callback?: (event: MarketEvent) => void | Promise<void>;
  private subscribedSymbols = new Set<string>();
  private pollTimer: NodeJS.Timeout | null = null;
  private pollInterval = SinaHqProvider.DEFAULT_POLL_INTERVAL;
  private running = false;
  private parser = new SinaHqParser();

  /**
   * Query current market quote data for a single symbol.
   */
  async queryQuote(symbol: string, _options?: unknown): Promise<MarketQuote[]> {
    const quotes = await this.fetchQuotes([symbol]);
    return quotes;
  }

  /**
   * Query current market bar data for a single symbol.
   * Note: Sina HQ doesn't provide bar data directly, this returns empty array.
   */
  async queryBar(_symbol: string, _options?: unknown): Promise<MarketBar[]> {
    return [];
  }

  /**
   * Subscribe to real-time market events for specific symbols.
   */
  async subscribeSymbols(symbols: string[]): Promise<void> {
    if (!this.connected) {
      throw TradingErrors.provider({
        message: "Must call connect() before subscribing",
        sourceName: "SinaHqProvider",
        severity: "recover",
      });
    }

    for (const symbol of symbols) {
      this.subscribedSymbols.add(symbol);
    }
  }

  /**
   * Subscribe with provider-specific options.
   */
  async subscribe(options?: SinaHqSubscribeOptions): Promise<void> {
    if (options?.symbols) {
      await this.subscribeSymbols(options.symbols);
    }
    if (options?.pollInterval) {
      this.pollInterval = options.pollInterval;
    }
  }

  /**
   * Unsubscribe from market events for specific symbols.
   */
  async unsubscribeSymbols(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      this.subscribedSymbols.delete(symbol);
    }
  }

  /**
   * Unsubscribe using provider-specific options.
   */
  async unsubscribe(options?: SinaHqSubscribeOptions): Promise<void> {
    await this.end();
    if (options?.symbols) {
      await this.unsubscribeSymbols(options.symbols);
    } else {
      this.subscribedSymbols.clear();
    }
  }

  async begin(): Promise<void> {
    if (this.running) return;
    this.startPolling();
  }

  async end(): Promise<void> {
    if (!this.running) return;
    this.stopPolling();
  }

  /**
   * Connect to the data source with event callback.
   */
  async connect(
    callback: (event: MarketEvent) => void | Promise<void>
  ): Promise<void> {
    this.callback = callback;
    this.connected = true;
  }

  /**
   * Disconnect from the data source.
   */
  async disconnect(): Promise<void> {
    await this.end();
    this.subscribedSymbols.clear();
    this.connected = false;
    delete this.callback;
  }

  /**
   * Check if provider is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Fetch quotes from Sina HQ service.
   */
  private async fetchQuotes(symbols: string[]): Promise<SinaHqQuote[]> {
    if (symbols.length === 0) {
      return [];
    }

    const list = symbols.join(",");
    const rn = Date.now();
    const url = `${SinaHqProvider.BASE_URL}/?rn=${rn}&list=${list}`;

    // TODO: here we lose browser compatibility
    const response = await fetch(url, {
      headers: {
        Referer: "https://finance.sina.com.cn",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      throw TradingErrors.provider({
        message: "SinaHq request failed: ${response.status}",
        sourceName: "SinaHqProvider",
        severity: "recover",
      });
    }

    const buffer = await response.arrayBuffer();
    const decoder = new TextDecoder("gbk");
    const text = decoder.decode(buffer);
    return this.parser.parseResponse(text);
  }

  /**
   * Start polling for subscribed symbols.
   */
  private startPolling(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.poll();
  }

  /**
   * Stop polling.
   */
  private stopPolling(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Poll for current subscribed symbols, then schedule next poll.
   */
  private async poll(): Promise<void> {
    if (!this.running || this.subscribedSymbols.size === 0 || !this.callback) {
      return;
    }

    try {
      const symbols = Array.from(this.subscribedSymbols);
      const quotes = await this.fetchQuotes(symbols);

      if (quotes.length > 0) {
        const event: MarketEvent = {
          type: "market",
          timestamp: new Date(),
          marketData: quotes,
        };

        const result = this.callback(event);
        if (result instanceof Promise) {
          await result;
        }
      }
    } catch {
      // Ignore errors in polling
    }

    // Schedule next poll after interval
    if (this.running) {
      this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
    }
  }
}
