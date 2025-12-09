import type { MarketQuote } from "@junduck/trading-core";
import { readFileSync } from "node:fs";
import type { MarketEvent } from "../types/Events.js";
import { DataProviderSync } from "../providers/DataProviderSync.js";
import {
  type JsonDataMapping,
  createTimestampExtractor,
  createQuoteConverter,
} from "./JsonDataCommon.js";

export {
  useDefaultTimestampExtractor,
  useUnixEpochExtractor,
} from "./JsonDataCommon.js";

interface JsonDataProviderOptions {
  filePath: string;
  mapping?: JsonDataMapping;
}

/**
 * Synchronous JSON data provider for backtesting.
 * Reads data synchronously and returns events via next() calls.
 *
 * @platform node
 */
export class JsonDataProviderSync extends DataProviderSync {
  private filePath: string;
  private extractTimestamp: (record: any) => Date;
  private convertToQuote: (record: any) => MarketQuote;
  private events: MarketEvent[] = [];
  private currentIndex = 0;

  constructor(opts: JsonDataProviderOptions) {
    super();
    this.filePath = opts.filePath;

    const symbolField = opts.mapping?.symbolField ?? "symbol";
    const priceField = opts.mapping?.priceField ?? "close";
    const timestampField = opts.mapping?.timestampField ?? "timestamp";

    this.extractTimestamp = createTimestampExtractor(timestampField);
    this.convertToQuote = createQuoteConverter(
      symbolField,
      priceField,
      this.extractTimestamp
    );
  }

  subscribe(_symbols: string[]): void {
    const content = readFileSync(this.filePath, "utf-8");
    const records = JSON.parse(content) as any[];

    if (records.length === 0) {
      this.events = [];
      return;
    }

    // Group records by timestamp into market events
    const firstRecord = records[0]!;
    let currentTimestamp = this.extractTimestamp(firstRecord);
    let currentBatch: MarketQuote[] = [];

    for (const record of records) {
      const recordTimestamp = this.extractTimestamp(record);
      if (recordTimestamp.getTime() !== currentTimestamp.getTime()) {
        this.events.push({
          type: "market",
          timestamp: currentTimestamp,
          marketData: currentBatch,
        });

        currentTimestamp = recordTimestamp;
        currentBatch = [];
      }

      currentBatch.push(this.convertToQuote(record));
    }

    if (currentBatch.length > 0) {
      this.events.push({
        type: "market",
        timestamp: currentTimestamp,
        marketData: currentBatch,
      });
    }

    this.currentIndex = 0;
  }

  next(): MarketEvent | undefined {
    if (this.currentIndex >= this.events.length) {
      return undefined;
    }
    return this.events[this.currentIndex++];
  }

  disconnect(): void {
    this.events = [];
    this.currentIndex = 0;
  }
}
