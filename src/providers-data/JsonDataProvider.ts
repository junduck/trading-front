import type { MarketBar, MarketQuote } from "@junduck/trading-core";
import { readFile } from "node:fs/promises";
import { DataProvider } from "../providers/DataProvider.js";
import type { MarketEvent } from "../types/Events.js";
import { TradingErrors } from "../core/TradingError.js";

interface JsonDataProviderOptions {
  filePath: string;
  mapping?: {
    symbolField?: string;
    priceField?: string;
    timestampField?: string | ((record: any) => Date);
  };
}

export function useDefaultTimestampExtractor(field: string) {
  return (record: any) => {
    return new Date(record[field]);
  };
}

export function useUnixEpochExtractor(
  field: string,
  period: "s" | "ms" | "us"
) {
  const ratios = { s: 1000, ms: 1, us: 0.001 };
  const ratio = ratios[period];
  return (record: any) => {
    return new Date((record[field] as number) * ratio);
  };
}

/**
 * Simple JSON data provider that reads OHLCV data from a JSON file and emits it synchronously.
 * Designed for backtesting scenarios where historical data is replayed sequentially.
 * @platform node
 */
export class JsonDataProvider extends DataProvider {
  private filePath: string;
  private mapping: {
    symbolField: string;
    priceField: string;
  };
  private extractTimestamp: (record: any) => Date;
  private connected = false;
  private running = false;
  private callback?: (event: MarketEvent) => void | Promise<void>;

  constructor(opts: JsonDataProviderOptions) {
    super();
    this.filePath = opts.filePath;
    this.mapping = {
      symbolField: opts.mapping?.symbolField ?? "symbol",
      priceField: opts.mapping?.priceField ?? "close",
    };

    const timestampField = opts.mapping?.timestampField ?? "timestamp";
    this.extractTimestamp =
      typeof timestampField === "function"
        ? timestampField
        : useDefaultTimestampExtractor(timestampField);
  }

  async queryQuote(
    _symbol: string,
    _options?: unknown
  ): Promise<MarketQuote[]> {
    return [];
  }

  async queryBar(_symbol: string, _options?: unknown): Promise<MarketBar[]> {
    return [];
  }

  async subscribeSymbols(_symbols: string[]): Promise<void> {
    return Promise.resolve();
  }

  async subscribe(_options?: unknown): Promise<void> {
    return Promise.resolve();
  }

  async unsubscribeSymbols(_symbols: string[]): Promise<void> {
    return Promise.resolve();
  }

  async unsubscribe(_options?: unknown): Promise<void> {
    await this.end();
  }

  async begin(): Promise<void> {
    if (this.running) return;
    if (!this.connected || !this.callback) {
      throw TradingErrors.provider({
        message: "Must call connect() before begin()",
        sourceName: "JsonDataProvider",
        severity: "halt",
        category: "state",
      });
    }

    this.running = true;

    const content = await readFile(this.filePath, "utf-8");
    const records = JSON.parse(content) as any[];

    if (records.length === 0) {
      return;
    }

    const firstRecord = records[0]!;
    let currentTimestamp = this.extractTimestamp(firstRecord);
    let currentBatch: MarketQuote[] = [];

    for (const record of records) {
      if (!this.running) break;

      const recordTimestamp = this.extractTimestamp(record);
      if (recordTimestamp.getTime() !== currentTimestamp.getTime()) {
        const event: MarketEvent = {
          type: "market",
          timestamp: currentTimestamp,
          marketData: currentBatch,
        };

        const result = this.callback(event);
        if (result instanceof Promise) {
          await result;
        }

        currentTimestamp = recordTimestamp;
        currentBatch = [];
      }

      currentBatch.push(this.convertToQuote(record));
    }

    if (currentBatch.length > 0 && this.running) {
      const event: MarketEvent = {
        type: "market",
        timestamp: currentTimestamp,
        marketData: currentBatch,
      };

      const result = this.callback(event);
      if (result instanceof Promise) {
        await result;
      }
    }
  }

  async end(): Promise<void> {
    if (!this.running) return;
    this.running = false;
  }

  async connect(
    callback: (event: MarketEvent) => void | Promise<void>
  ): Promise<void> {
    this.callback = callback;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    await this.end();
    this.connected = false;
    delete this.callback;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private convertToQuote(record: any): MarketQuote {
    return {
      ...record,
      symbol: record[this.mapping.symbolField],
      timestamp: this.extractTimestamp(record),
      price: record[this.mapping.priceField],
    };
  }
}
