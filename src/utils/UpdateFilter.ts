import type { MarketQuote } from "@junduck/trading-core";

/**
 * Filters incoming data arrays to only emit items that have actually updated.
 * Maintains a map of keys to unique identifiers, comparing new data against stored values.
 */
export class UpdateFilter<T, K = string, I = unknown> {
  private identifiers = new Map<K, I>();

  constructor(
    private keyExtractor: (item: T) => K,
    private idExtractor: (item: T) => I
  ) {}

  /**
   * Process incoming data and return only items that have updated.
   * Updates internal state with new identifiers.
   */
  filter(data: T[]): T[] {
    const updated: T[] = [];

    for (const item of data) {
      const key = this.keyExtractor(item);
      const newId = this.idExtractor(item);
      const oldId = this.identifiers.get(key);

      if (oldId !== newId) {
        updated.push(item);
        this.identifiers.set(key, newId);
      }
    }

    return updated;
  }

  /** Clear all tracked identifiers. */
  clear(): void {
    this.identifiers.clear();
  }

  /** Remove tracking for specific keys. */
  delete(keys: K[]): void {
    for (const key of keys) {
      this.identifiers.delete(key);
    }
  }

  /** Get number of tracked keys. */
  get size(): number {
    return this.identifiers.size;
  }
}

/**
 * Specialized UpdateFilter for market quotes.
 * Uses symbol as key and timestamp as identifier.
 */
export class QuoteUpdateFilter<T extends MarketQuote = MarketQuote> extends UpdateFilter<T, string, number> {
  constructor() {
    super(
      quote => quote.symbol,
      quote => quote.timestamp.getTime()
    );
  }
}
