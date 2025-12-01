import type { MarketQuote } from "@junduck/trading-core";

/**
 * Field mapping configuration for JSON data providers.
 */
export interface JsonDataMapping {
  symbolField?: string;
  priceField?: string;
  timestampField?: string | ((record: any) => Date);
}

/**
 * Default timestamp extractor for ISO date strings.
 */
export function useDefaultTimestampExtractor(field: string) {
  return (record: any) => {
    return new Date(record[field]);
  };
}

/**
 * Unix epoch timestamp extractor with period conversion.
 */
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
 * Initialize timestamp extractor from mapping config.
 */
export function createTimestampExtractor(
  timestampField: string | ((record: any) => Date) = "timestamp"
): (record: any) => Date {
  return typeof timestampField === "function"
    ? timestampField
    : useDefaultTimestampExtractor(timestampField);
}

/**
 * Create quote converter with field mapping.
 */
export function createQuoteConverter(
  symbolField: string,
  priceField: string,
  extractTimestamp: (record: any) => Date
) {
  return (record: any): MarketQuote => {
    return {
      ...record,
      symbol: record[symbolField],
      timestamp: extractTimestamp(record),
      price: record[priceField],
    };
  };
}
