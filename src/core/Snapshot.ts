import type {
  MarketQuote,
  Position,
  OrderState,
  Fill,
} from "@junduck/trading-core";
import { createPosition, processFill, q } from "@junduck/trading-core";

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
  private _position: Position = createPosition();

  lastSubmit: Date | undefined;

  get position(): Readonly<Position> {
    return this._position;
  }

  set position(pos: Position) {
    this._position = structuredClone(pos);
    // Recaculate valuations based on new position
    if (this._position.long) {
      for (const [symbol, longPos] of this._position.long) {
        const price = this.priceMap.get(symbol) ?? 0;
        this.valueMap.set(symbol, longPos.quantity * price);
      }
    }
    if (this._position.short) {
      for (const [symbol, shortPos] of this._position.short) {
        const price = this.priceMap.get(symbol) ?? 0;
        this.liabMap.set(symbol, shortPos.quantity * price);
      }
    }
    // Recalculate equity when position is set
    this.updateEquity();
  }

  /**
   * Map of potentially open orders.
   * Business logic: Tracks orders that may still be working at the broker.
   * Updated based on OrderEvent data. This is estimation only - actual state
   * at broker may differ due to network delays, fills, or broker-side changes.
   */
  private readonly openMap: Map<string, OrderState> = new Map();

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
   * Get potentially open order by ID.
   * Business logic: Returns estimated order state. Actual broker state may differ.
   * @param orderId - Order ID to look up
   * @returns Order state if tracked, undefined otherwise
   */
  getOpenOrder(orderId: string): OrderState | undefined {
    return this.openMap.get(orderId);
  }

  /**
   * Get all potentially open orders.
   * Business logic: Returns snapshot of tracked open orders.
   * This is estimation only - actual broker state may differ.
   * @returns Array of order states
   */
  get openOrders(): OrderState[] {
    return Array.from(this.openMap.values());
  }

  /**
   * Update market prices and recalculate position valuations.
   * Called when new market price information arrives.
   *
   * @param quotes - Array of market quotes with updated prices
   * @internal
   */
  updateQuotes(quotes: MarketQuote[]): void {
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
      if (this._position.long && this._position.long.has(symbol)) {
        const longPos = this._position.long.get(symbol)!;
        this.valueMap.set(symbol, longPos.quantity * newPrice);
      }

      // Update liability for short positions
      if (this._position.short && this._position.short.has(symbol)) {
        const shortPos = this._position.short.get(symbol)!;
        this.liabMap.set(symbol, shortPos.quantity * newPrice);
      }
    }

    // Recalculate total equity
    this.updateEquity();
  }

  /**
   * Update valuations for specific positions after fills.
   * Called when positions change due to order execution.
   *
   * @param symbols - Updated symbols (from fills)
   * @internal
   */
  updatePosition(updated: OrderState[], fill: Fill[]): void {
    const symbolSet = new Set<string>();

    // Update position state based on fills
    for (const f of fill) {
      symbolSet.add(f.symbol);
      processFill(this._position, f);
    }

    const symbols = Array.from(symbolSet);

    for (const symbol of symbols) {
      // Update market value for long positions
      const longQty = q.longQty(this._position, symbol);
      if (longQty) {
        const price = this.price(symbol);
        this.valueMap.set(symbol, longQty * price);
      } else {
        this.valueMap.delete(symbol);
      }

      // Update liability for short positions
      const shortQty = q.shortQty(this._position, symbol);
      if (shortQty) {
        const price = this.price(symbol);
        this.liabMap.set(symbol, shortQty * price);
      } else {
        this.liabMap.delete(symbol);
      }
    }

    // Update open orders based on updated states
    this.updateOpenOrder(updated);

    // Recalculate total equity once after all symbols updated
    this.updateEquity();
  }

  /**
   * Update potentially open orders based on order event.
   * Called when order state updates are received from broker.
   *
   * Business logic:
   * - OPEN/PARTIAL: Order is working, add/update in openMap
   * - FILLED/CANCELLED/REJECT: Order is terminal, remove from openMap
   *
   * @param updated - Array of updated order states
   * @internal
   */
  updateOpenOrder(updated: OrderState[]): void {
    for (const state of updated) {
      // Update open orders map based on status
      switch (state.status) {
        case "OPEN":
        case "PARTIAL":
          // Order is still working, track it
          this.openMap.set(state.id, state);
          break;

        case "FILLED":
        case "CANCELLED":
        case "REJECT":
          // Order reached terminal state, remove from tracking
          this.openMap.delete(state.id);
          break;
      }
    }
  }

  /**
   * Calculate total portfolio equity.
   * Equity = cash + market value of longs - market value of shorts
   *
   */
  private updateEquity(): void {
    this._totValue = Array.from(this.valueMap.values()).reduce(
      (sum, value) => sum + value,
      0
    );

    this._totLiab = Array.from(this.liabMap.values()).reduce(
      (sum, liability) => sum + liability,
      0
    );

    this._equity = this._position.cash + this._totValue - this._totLiab;
  }
}
