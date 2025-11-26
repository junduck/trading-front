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
  private _totValue: number = 0;
  private _totLiab: number = 0;

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
   * Total position equity (cash + market value - liabilities).
   */
  get equity(): number {
    return this._equity;
  }

  /**
   * Total market value from long position
   */
  get totalValue(): number {
    return this._totValue;
  }

  /**
   * Total market liability from short position
   */
  get totalLiab(): number {
    return this._totLiab;
  }

  /**
   * Update market prices and recalculate position valuations.
   * Called when new market price information arrives.
   *
   * @param quotes - Array of market quotes with updated prices
   * @param position - Current position state
   * @internal
   */
  updateQuotes(quotes: MarketQuote[], position: Position): void {
    // Update price map and recalculate valuations only for affected symbols
    for (const quote of quotes) {
      const symbol = quote.symbol;
      const oldPrice = this.priceMap.get(symbol);
      const newPrice = quote.price;

      // Skip recalculation if price hasn't changed
      if (oldPrice === newPrice) continue;

      // Update price map
      this.priceMap.set(symbol, newPrice);

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
    this.updateEquity(position.cash);
  }

  /**
   * Update valuations for specific positions after fills.
   * Called when positions change due to order execution.
   *
   * @param symbols - Updated symbols (from fills)
   * @param position - Updated position state
   * @internal
   */
  updatePosition(symbols: string[], position: Position): void {
    for (const symbol of symbols) {
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
    }

    // Recalculate total equity once after all symbols updated
    this.updateEquity(position.cash);
  }

  /**
   * Calculate total portfolio equity.
   * Equity = cash + market value of longs - market value of shorts
   *
   * @param cash - Current cash amount
   */
  private updateEquity(cash: number): void {
    this._totValue = Array.from(this.valueMap.values()).reduce(
      (sum, value) => sum + value,
      0
    );

    this._totLiab = Array.from(this.liabMap.values()).reduce(
      (sum, liability) => sum + liability,
      0
    );

    this._equity = cash + this._totValue - this._totLiab;
  }
}
