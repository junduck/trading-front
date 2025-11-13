import type { NewsEvent } from "../types/Events.js";
import type { LiveNews } from "../types/News.js";
import { NewsProvider } from "./NewsProvider.js";


/** Configuration options for MockNewsProvider */
export interface MockNewsProviderConfig {
  /** Whether to emit periodic updates (default: false) */
  autoEmit?: boolean;
  /** Interval for auto-emit in milliseconds (default: 5000) */
  emitInterval?: number;
}

/**
 * Mock NewsProvider for testing and development.
 * Generates random news items with topics or symbols.
 */
export class MockNewsProvider extends NewsProvider {
  private connected = false;
  private callback: ((event: NewsEvent) => void) | undefined = undefined;
  private subscribedSymbols: Set<string> = new Set();
  private intervalId: NodeJS.Timeout | undefined = undefined;

  private readonly autoEmit: boolean;
  private readonly emitInterval: number;

  constructor(config: MockNewsProviderConfig = {}) {
    super();
    this.autoEmit = config.autoEmit ?? false;
    this.emitInterval = config.emitInterval ?? 5000;
  }

  async connect(callback: (event: NewsEvent) => void): Promise<void> {
    this.callback = callback;
    this.connected = true;

    if (this.autoEmit) {
      this.startAutoEmit();
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.stopAutoEmit();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async queryLiveNews(options?: unknown): Promise<LiveNews[]> {
    if (!this.connected) {
      throw new Error("MockNewsProvider is not connected");
    }

    const opts = (options as { topics?: string[]; symbols?: string[]; limit?: number }) || {};
    const limit = opts.limit ?? 10;
    const items: LiveNews[] = [];

    // Query by topics if provided
    if (opts.topics && opts.topics.length > 0) {
      for (let i = 0; i < limit; i++) {
        const topic = opts.topics[Math.floor(Math.random() * opts.topics.length)];
        items.push({
          title: `${topic} Breaking News`,
          content: `Latest update on ${topic}: ${Math.floor(Math.random() * 10000)}`,
          symbols: [],
          timestamp: new Date(),
        });
      }
    }
    // Query by symbols if provided
    else if (opts.symbols && opts.symbols.length > 0) {
      for (let i = 0; i < limit; i++) {
        const symbol = opts.symbols[Math.floor(Math.random() * opts.symbols.length)];
        items.push({
          title: `${symbol} Update`,
          content: `News about ${symbol}: ${Math.floor(Math.random() * 10000)}`,
          symbols: [symbol!],
          timestamp: new Date(),
        });
      }
    }
    // Default: return some random news
    else {
      for (let i = 0; i < limit; i++) {
        items.push({
          title: `Market Update`,
          content: `General market news: ${Math.floor(Math.random() * 10000)}`,
          symbols: [],
          timestamp: new Date(),
        });
      }
    }

    return items;
  }

  /** Manually emit a news event for testing */
  async emitNews(symbols?: string[]): Promise<void> {
    const targetSymbols = symbols ?? Array.from(this.subscribedSymbols);

    if (targetSymbols.length === 0) return;

    const newsItems: LiveNews[] = [];

    const symbol = targetSymbols[Math.floor(Math.random() * targetSymbols.length)];
    newsItems.push({
      title: `${symbol} Breaking News`,
      content: `Latest update on ${symbol}: ${Math.floor(Math.random() * 10000)}`,
      symbols: [symbol!],
      timestamp: new Date(),
    });

    const event: NewsEvent = {
      type: "news",
      timestamp: new Date(),
      newsData: newsItems,
    };

    if (this.callback) {
      this.callback(event);
    }
  }

  /** Start auto-emitting news data */
  private startAutoEmit(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.emitNews().catch((err) => console.error("Error in auto-emit:", err));
    }, this.emitInterval) as unknown as NodeJS.Timeout;
  }

  /** Stop auto-emitting news data */
  private stopAutoEmit(): void {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
}
