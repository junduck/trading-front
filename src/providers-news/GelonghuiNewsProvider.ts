import type { ExternalEvent } from "../types/Events.js";
import { ExternalProvider } from "../providers/ExternalProvider.js";
import { TradingErrors } from "../core/TradingError.js";

/** Gelonghui API related stock information */
interface GelonghuiRelatedStock {
  market: string;
  code: string;
  name: string;
  canClick: boolean;
}

/** Gelonghui API related info (topics, subjects) */
interface GelonghuiRelatedInfo {
  id: number;
  type: string;
  name: string;
  link: string;
  coverImageUrl: string;
}

/** Gelonghui API count object for sentiment indicators */
interface GelonghuiCount {
  read: number;
  comment: number;
  favorite: number;
  like: number;
  share: number;
}

/** Gelonghui news item, compatible with LiveNews */
export interface GelonghuiNewsItem {
  id: number;
  title: string;
  content: string;
  contentPrefix: string;
  createTimestamp: number;
  updateTimestamp: number;
  relatedStocks: GelonghuiRelatedStock[] | null;
  relatedInfos: GelonghuiRelatedInfo[] | null;
  count: GelonghuiCount;
  level: number;

  symbols?: string[];
  timestamp: Date;
}

/** Gelonghui API response structure */
interface GelonghuiNewsResponse {
  statusCode: number;
  message: string;
  totalCount: number;
  result: Omit<GelonghuiNewsItem, "symbols" | "timestamp">[];
}

/** Options for Gelonghui news query */
export interface GelonghuiQueryOptions {
  limit?: number;
  liveId?: number;
}

/** Options for Gelonghui news subscription */
export interface GelonghuiSubscribeOptions {
  pollInterval?: number;
  limit?: number;
}

/**
 * News provider implementation for Gelonghui live news.
 * Polls Gelonghui's API for real-time financial news.
 * @platform node
 */
export class GelonghuiNewsProvider extends ExternalProvider {
  private static readonly BASE_URL = "https://www.gelonghui.com";
  private static readonly DEFAULT_POLL_INTERVAL = 15000; // 15 seconds
  private static readonly DEFAULT_LIMIT = 30;

  private connected = false;
  private callback?: (event: ExternalEvent) => void;
  private pollTimer: NodeJS.Timeout | null = null;
  private pollInterval = GelonghuiNewsProvider.DEFAULT_POLL_INTERVAL;
  private running = false;
  private limit = GelonghuiNewsProvider.DEFAULT_LIMIT;
  private highestSeenId = 0;

  /**
   * Query live news with optional pagination.
   */
  async query(options?: GelonghuiQueryOptions): Promise<GelonghuiNewsItem[]> {
    const limit = options?.limit ?? this.limit;
    return await this.fetchNews(limit, options?.liveId);
  }

  /**
   * Subscribe to live news and configure options.
   */
  async subscribe(options?: GelonghuiSubscribeOptions): Promise<void> {
    if (options?.pollInterval) {
      this.pollInterval = options.pollInterval;
    }
    if (options?.limit) {
      this.limit = options.limit;
    }

    if (!this.connected) {
      throw TradingErrors.provider({
        message: "Must call connect() before subscribing",
        sourceName: "GelonghuiNewsProvider",
        severity: "recover",
        category: "state",
      });
    }
  }

  /**
   * Unsubscribe from live news.
   */
  async unsubscribe(_options?: unknown): Promise<void> {
    await this.end();
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
   * Connect to news source with event callback.
   */
  async connect(callback: (event: ExternalEvent) => void): Promise<void> {
    this.callback = callback;
    this.connected = true;
  }

  /**
   * Disconnect from news source.
   */
  async disconnect(): Promise<void> {
    await this.end();
    this.connected = false;
    delete this.callback;
    this.highestSeenId = 0;
  }

  /**
   * Check if provider is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Fetch news from Gelonghui API.
   */
  private async fetchNews(
    limit: number,
    liveId?: number
  ): Promise<GelonghuiNewsItem[]> {
    const timestamp = Date.now();
    const params = new URLSearchParams({
      category: "all",
      limit: String(limit),
      timestamp: String(timestamp),
    });

    if (liveId !== undefined) {
      params.set("liveId", String(liveId));
    }

    const url = `${GelonghuiNewsProvider.BASE_URL}/api/live-channels/all/lives/v4?${params}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "Client-Lang": "zh-cn",
        platform: "web",
        Referer: "https://www.gelonghui.com/live/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      throw TradingErrors.provider({
        message: `Gelonghui API request failed: ${response.status}`,
        sourceName: "GelonghuiNewsProvider",
        severity: "recover",
      });
    }

    const data = (await response.json()) as GelonghuiNewsResponse;

    if (data.statusCode !== 200) {
      throw TradingErrors.provider({
        message: `Gelonghui API error: ${data.message}`,
        sourceName: "GelonghuiNewsProvider",
        severity: "recover",
      });
    }

    return data.result.map((item) => {
      const newsItem: GelonghuiNewsItem = {
        ...item,
        timestamp: new Date(item.updateTimestamp * 1000),
      };

      if (item.relatedStocks) {
        newsItem.symbols = item.relatedStocks.map(
          (stock) => `${stock.market.toLowerCase()}${stock.code}`
        );
      }

      return newsItem;
    });
  }

  /**
   * Start polling for news.
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
   * Poll for new news, then schedule next poll.
   */
  private async poll(): Promise<void> {
    if (!this.running || !this.callback) {
      return;
    }

    try {
      const items = await this.fetchNews(this.limit);

      // Filter to only new items (ID > highestSeenId)
      const newItems = items.filter((item) => item.id > this.highestSeenId);

      if (newItems.length > 0) {
        // Update highestSeenId (first item has highest ID)
        this.highestSeenId = newItems[0]!.id;

        const event: ExternalEvent = {
          type: "external",
          source: "gelonghui-news",
          data: newItems,
          timestamp: new Date(),
        };

        this.callback(event);
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
