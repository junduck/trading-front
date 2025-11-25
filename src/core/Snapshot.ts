import type { FillEffect } from "@junduck/trading-core";
import type { MarketQuote, Position } from "@junduck/trading-core";
import { q } from "@junduck/trading-core";

/**
 * Portfolio state snapshot combining market prices and position valuations.
 *
 * Provides unified access to prices, market values, liabilities, and equity.
 * Centralizes calculation logic that was previously scattered across TradingBot and Context.
 */
export class Snapshot {
  private readonly priceMap: Map<string, number> = new Map();
  private readonly valueMap: Map<string, number> = new Map();
  private readonly liabMap: Map<string, number> = new Map();
  private _equity: number = 0;

  /**
   * Get the current price for a symbol.
   * @param symbol - Symbol to look up
   * @returns Price, or 0 if no market data available
   */
  price(symbol: string): number {
    return this.priceMap.get(symbol) ?? 0;
  }

  /**
   * Get the market value for a long position.
   * @param symbol - Symbol to look up
   * @returns Market value (quantity × price), or 0 if no position
   */
  value(symbol: string): number {
    return this.valueMap.get(symbol) ?? 0;
  }

  /**
   * Get the market liability for a short position.
   * @param symbol - Symbol to look up
   * @returns Liability (quantity × price), or 0 if no position
   */
  liab(symbol: string): number {
    return this.liabMap.get(symbol) ?? 0;
  }

  /**
   * Total portfolio equity (cash + market value - liabilities).
   */
  get equity(): number {
    return this._equity;
  }

  /**
   * Get all market values as a read-only map.
   * @returns Map of symbol to market value (for long positions)
   */
  getValueMap(): ReadonlyMap<string, number> {
    return this.valueMap;
  }

  /**
   * Get all liabilities as a read-only map.
   * @returns Map of symbol to liability (for short positions)
   */
  getLiabilityMap(): ReadonlyMap<string, number> {
    return this.liabMap;
  }

  /**
   * Update market prices and recalculate position valuations.
   * Called when new market price information arrives.
   *
   * @param quotes - Array of market quotes with updated prices
   * @param position - Current position state
   */
  updateQuotes(quotes: MarketQuote[], position: Position): void {
    // Update price map and recalculate valuations only for affected symbols
    for (const quote of quotes) {
      const symbol = quote.symbol;
      const oldPrice = this.priceMap.get(symbol);
      const newPrice = quote.price;

      // Update price map
      this.priceMap.set(symbol, newPrice);

      // Skip recalculation if price hasn't changed
      if (oldPrice === newPrice) continue;

      // Update market value for long positions
      if (position.long && position.long.has(symbol)) {
        const longPos = position.long.get(symbol)!;
        this.valueMap.set(symbol, longPos.quantity * newPrice);
      }

      // Update liability for short positions
      if (position.short && position.short.has(symbol)) {
        const shortPos = position.short.get(symbol)!;
        this.liabMap.set(symbol, shortPos.quantity * newPrice);
      }
    }

    // Recalculate total equity
    this.updateEquity(position);
  }

  /**
   * Update valuations for a specific position after a fill.
   * Called when positions change due to order execution.
   *
   * @param symbol - Updated symbol
   * @param position - Updated position state
   */
  updatePosition(symbol: string, position: Position): void {
    // Update market value for long positions
    const longQty = q.longQty(position, symbol);
    if (longQty) {
      const price = this.price(symbol);
      this.valueMap.set(symbol, longQty * price);
    } else {
      this.valueMap.delete(symbol);
    }

    // Update liability for short positions
    const shortQty = q.shortQty(position, symbol);
    if (shortQty) {
      const price = this.price(symbol);
      this.liabMap.set(symbol, shortQty * price);
    } else {
      this.liabMap.delete(symbol);
    }

    // Recalculate total equity
    this.updateEquity(position);
  }

  /**
   * Calculate total portfolio equity.
   * Equity = cash + market value of longs - market value of shorts
   *
   * @param position - Current position state
   */
  private updateEquity(position: Position): void {
    const totalMarketValue = Array.from(this.valueMap.values()).reduce(
      (sum, value) => sum + value,
      0
    );

    const totalLiabilities = Array.from(this.liabMap.values()).reduce(
      (sum, liability) => sum + liability,
      0
    );

    this._equity = position.cash + totalMarketValue - totalLiabilities;
  }
}
