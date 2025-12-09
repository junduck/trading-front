import type { SinaHqQuote } from "./SinaHqProvider.js";

/**
 * Supported symbol patterns:
 * - CN: sh\d{6}, sz\d{6}, sh000\d+, sh580\d+
 * - HK: hk*, rt_hk*
 */

/**
 * Parser for Sina Finance HQ response data.
 */
export class SinaHqParser {
  /**
   * Parse JSONP-like response from Sina.
   */
  parseResponse(text: string): SinaHqQuote[] {
    const quotes: SinaHqQuote[] = [];
    const lines = text.split("\n");

    for (const line of lines) {
      const match = line.match(/var hq_str_(\w+)="([^"]*)";/);
      if (!match) continue;

      const rawSymbol = match[1];
      const data = match[2];
      if (!rawSymbol || !data) continue;

      const fields = data.split(",");

      const quote = this.parseQuote(rawSymbol, fields);
      if (quote) {
        quotes.push(quote);
      }
    }

    return quotes;
  }

  /**
   * Parse individual quote from comma-separated fields.
   */
  parseQuote(rawSymbol: string, fields: string[]): SinaHqQuote | null {
    // Check if HK stock
    if (/^(hk|rt_hk)/.test(rawSymbol)) {
      return this.parseHkQuote(rawSymbol, fields);
    }
    return this.parseCnQuote(rawSymbol, fields);
  }

  /**
   * Parse CN market quote.
   * Reference: reference_sina_cn.js lines 47-72
   */
  private parseCnQuote(symbol: string, fields: string[]): SinaHqQuote | null {
    if (fields.length < 32) return null;

    try {
      const volumeUnit = this.getVolumeUnit(symbol);
      const rawVolume = Number(fields[8]) || 0;
      const totalVolume = rawVolume / volumeUnit;

      const preClose = Number(fields[2]) || 0;
      const price = Number(fields[3]) || preClose;

      const date = fields[30] || "";
      const time = fields[31] || "";
      const timestamp = this.parseTimestamp(date, time);

      const bid = Number(fields[6]);
      const ask = Number(fields[7]);

      // Parse bid/ask arrays: fields[10-19] for bids, [20-29] for asks
      const bid_volume: number[] = [];
      const bid_price: number[] = [];
      const ask_volume: number[] = [];
      const ask_price: number[] = [];

      // Bid levels: (volume, price) pairs at indices (10,11), (12,13), (14,15), (16,17), (18,19)
      for (let i = 0; i < 5; i++) {
        const volIdx = 10 + i * 2;
        const priceIdx = 11 + i * 2;
        bid_volume.push(Number(fields[volIdx]) || 0);
        bid_price.push(Number(fields[priceIdx]) || 0);
      }

      // Ask levels: (volume, price) pairs at indices (20,21), (22,23), (24,25), (26,27), (28,29)
      for (let i = 0; i < 5; i++) {
        const volIdx = 20 + i * 2;
        const priceIdx = 21 + i * 2;
        ask_volume.push(Number(fields[volIdx]) || 0);
        ask_price.push(Number(fields[priceIdx]) || 0);
      }

      return {
        symbol,
        name: fields[0] || "",
        open: Number(fields[1]) || preClose,
        preClose,
        price,
        high: Number(fields[4]) || preClose,
        low: Number(fields[5]) || preClose,
        bid,
        ask,
        totalVolume,
        totalTurnover: Number(fields[9]) || 0,
        bid_price,
        bid_volume,
        ask_price,
        ask_volume,
        timestamp,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse HK market quote.
   * Reference: reference_sina_hk.js lines 35-45
   */
  private parseHkQuote(rawSymbol: string, fields: string[]): SinaHqQuote | null {
    if (fields.length < 19) return null;

    try {
      // Remove rt_ prefix if present
      const symbol = rawSymbol.replace(/^rt_/, "");

      const preClose = Number(fields[3]) || Number(fields[2]) || 0;
      const price = Number(fields[6]) || preClose;

      const date = fields[17] || "";
      const time = fields[18] || "";
      const timestamp = this.parseTimestampHk(date, time);

      // HK uses fields[12] or 1000 * fields[11] for volume
      const totalVolume = Number(fields[12]) || 1000 * Number(fields[11]) || 0;
      const totalTurnover = Number(fields[11]) || 0;

      const bid = Number(fields[9]) || 0;
      const ask = Number(fields[10]) || 0;

      return {
        symbol,
        name: fields[1] || "",
        open: Number(fields[2]) || preClose,
        preClose,
        price,
        high: Number(fields[4]) || preClose,
        low: Number(fields[5]) || preClose,
        bid,
        ask,
        totalVolume,
        totalTurnover,
        timestamp,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get volume unit based on symbol.
   * Reference: reference_sina_cn.js lines 6-8
   */
  private getVolumeUnit(symbol: string): number {
    // Index symbols (sh000*, sh580*) use unit of 1
    if (/^(sh000|sh580)\d+/.test(symbol)) {
      return 1;
    }
    // Standard stocks (sh*, sz*) use unit of 100
    return 100;
  }

  /**
   * Parse timestamp from Sina date and time strings (CN market).
   * Sina uses Asia/Shanghai timezone (UTC+8).
   */
  private parseTimestamp(date: string, time: string): Date {
    const dateTime = `${date}T${time}+08:00`;
    return new Date(dateTime);
  }

  /**
   * Parse timestamp from Sina date and time strings (HK market).
   * HK uses date format with "/" divider: "2024/01/15"
   * Timezone is Asia/Hong_Kong (UTC+8).
   */
  private parseTimestampHk(date: string, time: string): Date {
    const normalizedDate = date.replace(/\//g, "-");
    const dateTime = `${normalizedDate}T${time}+08:00`;
    return new Date(dateTime);
  }
}
