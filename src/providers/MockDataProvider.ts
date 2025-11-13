import type { MarketBar, MarketQuote } from "@junduck/trading-core";
import type { MarketEvent } from "../types/Events.js";
import { DataProvider } from "./DataProvider.js";

/** Configuration options for MockDataProvider */
export interface MockDataProviderConfig {
  /** Initial prices for symbols (default: 100 for all) */
  initialPrices?: Record<string, number>;
  /** Price volatility percentage (default: 0.01 = 1%) */
  volatility?: number;
  /** Whether to emit periodic updates (default: false) */
  autoEmit?: boolean;
  /** Interval for auto-emit in milliseconds (default: 1000) */
  emitInterval?: number;
}

/**
 * Mock DataProvider for testing and development.
 * Simulates market data with configurable price movements.
 */
export class MockDataProvider extends DataProvider {
  private connected = false;
  private prices: Map<string, number> = new Map();
  private callback: ((event: MarketEvent) => void) | undefined = undefined;
  private subscribedSymbols: Set<string> = new Set();
  private intervalId: NodeJS.Timeout | undefined = undefined;

  private readonly volatility: number;
  private readonly autoEmit: boolean;
  private readonly emitInterval: number;

  constructor(config: MockDataProviderConfig = {}) {
    super();
    this.volatility = config.volatility ?? 0.01;
    this.autoEmit = config.autoEmit ?? false;
    this.emitInterval = config.emitInterval ?? 1000;

    if (config.initialPrices) {
      for (const [symbol, price] of Object.entries(config.initialPrices)) {
        this.prices.set(symbol, price);
      }
    }
  }

  async connect(callback: (event: MarketEvent) => void): Promise<void> {
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

  async queryQuote(symbol: string): Promise<MarketQuote[]> {
    if (!this.connected) {
      throw new Error("MockDataProvider is not connected");
    }

    const price = this.getPrice(symbol);
    const spread = price * 0.0001; // 1 basis point spread

    return [{
      symbol,
      price,
      bid: price - spread / 2,
      ask: price + spread / 2,
      bidVol: Math.floor(Math.random() * 1000) + 100,
      askVol: Math.floor(Math.random() * 1000) + 100,
      timestamp: new Date(),
    }];
  }

  async queryBar(symbol: string): Promise<MarketBar[]> {
    if (!this.connected) {
      throw new Error("MockDataProvider is not connected");
    }

    const price = this.getPrice(symbol);
    const range = price * this.volatility;
    const open = price - range / 2 + Math.random() * range;
    const close = price - range / 2 + Math.random() * range;
    const high = Math.max(open, close) + Math.random() * (range / 2);
    const low = Math.min(open, close) - Math.random() * (range / 2);

    return [{
      symbol,
      open,
      high,
      low,
      close,
      volume: Math.floor(Math.random() * 1000000) + 10000,
      timestamp: new Date(),
      interval: "1m",
    }];
  }

  async subscribeSymbols(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      this.subscribedSymbols.add(symbol);
      if (!this.prices.has(symbol)) {
        this.prices.set(symbol, 100);
      }
    }
  }

  async subscribe(options?: unknown): Promise<void> {
    // Provider-specific subscription logic
    // In this mock, we treat options as an object with symbols array
    if (options && typeof options === 'object' && 'symbols' in options) {
      const symbols = (options as { symbols: string[] }).symbols;
      await this.subscribeSymbols(symbols);
    }
  }

  async unsubscribeSymbols(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      this.subscribedSymbols.delete(symbol);
    }
  }

  async unsubscribe(options?: unknown): Promise<void> {
    // Provider-specific unsubscription logic
    // In this mock, we treat options as an object with symbols array
    if (options && typeof options === 'object' && 'symbols' in options) {
      const symbols = (options as { symbols: string[] }).symbols;
      await this.unsubscribeSymbols(symbols);
    }
  }

  /** Manually emit a quote event for testing */
  async emitQuote(symbols?: string[]): Promise<void> {
    const targetSymbols = symbols ?? Array.from(this.subscribedSymbols);
    if (targetSymbols.length === 0) return;

    const quotes: MarketQuote[] = [];
    for (const symbol of targetSymbols) {
      const quoteArray = await this.queryQuote(symbol);
      quotes.push(...quoteArray);
      this.updatePrice(symbol);
    }

    const event: MarketEvent<MarketQuote> = {
      type: "market",
      getPrice: (item) => (item as MarketQuote).price,
      getSymbol: (item) => (item as MarketQuote).symbol,
      timestamp: new Date(),
      marketData: quotes,
    };

    if (this.callback) {
      this.callback(event as MarketEvent);
    }
  }

  /** Manually emit a bar event for testing */
  async emitBar(symbols?: string[]): Promise<void> {
    const targetSymbols = symbols ?? Array.from(this.subscribedSymbols);
    if (targetSymbols.length === 0) return;

    const bars: MarketBar[] = [];
    for (const symbol of targetSymbols) {
      const barArray = await this.queryBar(symbol);
      bars.push(...barArray);
      this.updatePrice(symbol);
    }

    const event: MarketEvent<MarketBar> = {
      type: "market",
      getPrice: (item) => (item as MarketBar).close,
      getSymbol: (item) => (item as MarketBar).symbol,
      timestamp: new Date(),
      marketData: bars,
    };

    if (this.callback) {
      this.callback(event as MarketEvent);
    }
  }

  /** Set price for a symbol */
  setPrice(symbol: string, price: number): void {
    this.prices.set(symbol, price);
  }

  /** Get current price for a symbol */
  private getPrice(symbol: string): number {
    return this.prices.get(symbol) ?? 100;
  }

  /** Update price with random walk */
  private updatePrice(symbol: string): void {
    const current = this.getPrice(symbol);
    const change = (Math.random() - 0.5) * 2 * this.volatility * current;
    this.prices.set(symbol, current + change);
  }

  /** Start auto-emitting market data */
  private startAutoEmit(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.emitQuote().catch((err) =>
        console.error("Error in auto-emit:", err)
      );
    }, this.emitInterval) as unknown as NodeJS.Timeout;
  }

  /** Stop auto-emitting market data */
  private stopAutoEmit(): void {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
}
