import type {
  MarketQuote,
  Order,
  OrderState,
  Position,
  Fill,
} from "@junduck/trading-core/trading";
import {
  fillOrder,
  cancelOrder,
  acceptOrder,
  processFill,
  rejectOrder,
} from "@junduck/trading-core/trading";
import { TradeProvider } from "../providers/TradeProvider.js";
import type { OrderEvent } from "../types/Events.js";
import type { MarketAlgo } from "../core/compose.js";
import type { AmendAction } from "../core/Context.js";

/**
 * Commission structure (broker fees)
 */
export interface CommissionConfig {
  /** Percentage commission rate (0.001 = 0.1%) */
  rate?: number;
  /** Fixed commission per trade */
  perTrade?: number;
  /** Minimum commission per trade */
  minimum?: number;
  /** Maximum commission per trade */
  maximum?: number;
}

/**
 * Slippage model (execution quality simulation).
 * Controls both price slippage and volume slippage.
 */
export interface SlippageConfig {
  /**
   * Price slippage configuration
   */
  price?: {
    /** Fixed slippage in basis points (100 = 1%) */
    fixed?: number;
    /** Market impact per % of bar volume (e.g., 0.01 = 1% price impact per 100% volume) */
    marketImpact?: number;
  };

  /**
   * Volume slippage configuration
   */
  volume?: {
    /** Maximum order size as % of bar volume (e.g., 0.1 = can fill max 10% of bar volume) */
    maxParticipation?: number;
    /** Allow partial fills when order exceeds available volume */
    allowPartialFills?: boolean;
  };
}

/**
 * Broker simulation configuration.
 * Focuses on order execution, fees, and broker-level constraints.
 * Portfolio metrics are tracked separately via middleware.
 */
export interface BacktestConfig {
  /** Initial cash balance */
  initialCash: number;

  /** Commission (simple rate or detailed structure) */
  commission: CommissionConfig;

  /** Slippage model (optional) */
  slippage?: SlippageConfig;
}

/**
 * Backtesting trade provider.
 * Implements only TradeProvider interface and processes orders based on market data.
 * Use onMarketData() as first middleware to match orders with market data.
 * Provides tick level order filling.
 */
export class BacktestBroker extends TradeProvider {
  private config: BacktestConfig;
  private position: Position;
  private openOrders: Map<string, OrderState> = new Map(); // id -> state
  private orderIdCounter = 0;
  private connected = false;
  private running = false;
  private callback?: (event: OrderEvent) => void;

  constructor(config: BacktestConfig) {
    super();
    this.config = config;
    this.position = {
      cash: config.initialCash,
      totalCommission: 0,
      realisedPnL: 0,
      modified: new Date(),
    };
  }

  /**
   * Returns middleware that matches orders with market data.
   * Register this as first middleware in market routes.
   *
   * @returns Market algorithm middleware function (only works with market events)
   *
   * @example
   * ```ts
   * const backtest = new BacktestBroker({
   *   initialCash: 100000,
   *   commission: 0.001,
   *   slippage: {
   *     price: { fixed: 5, marketImpact: 0.01 },
   *     volume: { maxParticipation: 0.1, allowPartialFills: true }
   *   }
   * });
   *
   * bot.market({
   *   strategy: [
   *     backtest.onMarketData(),
   *     // Your trading strategy here
   *   ]
   * });
   * ```
   */
  onMarketData(): MarketAlgo {
    return (ctx, next) => {
      // ctx.event is guaranteed to be MarketEvent by type system
      this.processPendingOrders(ctx.event.marketData, ctx.event.timestamp);
      next();
    };
  }

  // ============================================================================
  // TradingProvider impl
  // ============================================================================

  genOrderId(): string {
    return `backtest_${this.orderIdCounter++}`;
  }

  async getPosition(): Promise<Position> {
    return structuredClone(this.position);
  }

  async getOpenOrders(): Promise<Order[]> {
    return Array.from(this.openOrders.values());
  }

  notifyUpdated(states: OrderState[]): void {
    if (this.running && this.callback) {
      this.callback({
        type: "order",
        timestamp: new Date(),
        updated: states,
        fill: [],
      });
    }
  }

  async submitOrder(orders: Order[]): Promise<number> {
    const submitted: OrderState[] = [];
    for (const order of orders) {
      if (this.openOrders.get(order.id)) {
        // dup id: reject order
        submitted.push(rejectOrder(order));
      } else {
        const state = acceptOrder(order);
        submitted.push(state);
        this.openOrders.set(order.id, state);
      }
    }

    this.notifyUpdated(submitted);
    return submitted.length;
  }

  async amendOrder(updates: AmendAction[]): Promise<number> {
    const now = new Date();
    const updated: OrderState[] = [];
    for (const update of updates) {
      const state = this.openOrders.get(update.id);
      if (!state) {
        continue;
      }

      if (update.quantity !== undefined) {
        const filled = state.filledQuantity;
        state.quantity = update.quantity;
        state.remainingQuantity = update.quantity - filled;
      }
      if (update.price !== undefined) {
        state.price = update.price;
      }
      if (update.stopPrice !== undefined) {
        state.stopPrice = update.stopPrice;
      }
      state.modified = now;

      if (state.remainingQuantity < 0) {
        cancelOrder(state);
        this.openOrders.delete(update.id);
      }

      updated.push(state);
    }

    this.notifyUpdated(updated);
    return updated.length;
  }

  async cancelOrder(ids: string[]): Promise<number> {
    const cancelled: OrderState[] = [];
    for (const id of ids) {
      const state = this.openOrders.get(id);
      if (!state) {
        continue;
      }
      cancelOrder(state);
      cancelled.push(state);
      this.openOrders.delete(id);
    }

    this.notifyUpdated(cancelled);
    return cancelled.length;
  }

  async cancelAllOrders(): Promise<number> {
    const count = this.openOrders.size;
    if (count === 0) return 0;

    const orders = Array.from(this.openOrders.values());
    const cancelled: OrderState[] = [];

    for (const order of orders) {
      cancelOrder(order);
      cancelled.push(order);
    }
    this.openOrders.clear();

    this.notifyUpdated(cancelled);
    return count;
  }

  emergencyCancel(): void {
    // Panic button - fire and forget, never throw
    if (!this.connected) {
      return;
    }
    for (const state of this.openOrders.values()) {
      cancelOrder(state);
    }
    this.openOrders.clear();
  }

  // ============================================================================
  // BaseProvider impl
  // ============================================================================

  async connect(callback: (event: OrderEvent) => void): Promise<void> {
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

  async subscribe(): Promise<void> {
    // No-op for backtest provider
  }

  async unsubscribe(): Promise<void> {
    await this.end();
  }

  async begin(): Promise<void> {
    if (this.running) return;
    this.running = true;
  }

  async end(): Promise<void> {
    if (!this.running) return;
    this.running = false;
  }

  // ============================================================================
  // Brokerage logic
  // ============================================================================

  private processPendingOrders(quotes: MarketQuote[], timestamp: Date): void {
    const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));
    const updated: OrderState[] = [];
    const filled: Fill[] = [];

    for (const [id, state] of Array.from(this.openOrders.entries())) {
      const quote = quoteMap.get(state.symbol);
      if (!quote) continue;

      // Determine base fill price from order type
      const fillPrice = this.getMatchPrice(state, quote);
      if (fillPrice === null) continue;

      // Apply volume slippage: calculate fillable quantity
      const fillQuant = this.calculateFillQuantity(state, quote);
      if (fillQuant === 0) continue;

      // Apply price slippage: adjust fill price
      const slippage = this.calculatePriceSlippage(
        fillPrice,
        fillQuant,
        state.side,
        quote.volume
      );
      const adjFillPrice = fillPrice + slippage;

      // Calculate commission
      const commission = this.calculateCommission(adjFillPrice, fillQuant);

      // Fill the order
      const fill = fillOrder({
        state,
        id: `fill_${this.orderIdCounter++}`,
        price: adjFillPrice,
        quant: fillQuant,
        commission,
        created: timestamp,
      });

      // Update position
      processFill(this.position, fill, "FIFO");

      // Collect updated order and fill
      updated.push(state);
      filled.push(fill);

      // Remove from pending if fully filled
      if (state.status === "FILLED") {
        this.openOrders.delete(id);
      }
    }

    // Emit single event with all updates and fills from this tick
    if (updated.length > 0 && this.running && this.callback) {
      this.callback({
        type: "order",
        timestamp,
        updated,
        fill: filled,
      });
    }
  }

  /**
   * Get correct match price for order, null if no match
   */
  private getMatchPrice(order: Order, quote: MarketQuote): number | null {
    switch (order.type) {
      case "MARKET":
        return order.side === "BUY"
          ? quote.ask ?? quote.price
          : quote.bid ?? quote.price;

      case "LIMIT":
        if (!order.price) return null;
        if (order.side === "BUY") {
          const effectiveAsk = quote.ask ?? quote.price;
          return effectiveAsk <= order.price ? effectiveAsk : null;
        } else {
          const effectiveBid = quote.bid ?? quote.price;
          return effectiveBid >= order.price ? effectiveBid : null;
        }

      case "STOP":
        if (!order.stopPrice) return null;
        if (order.side === "BUY" && quote.price >= order.stopPrice) {
          return quote.ask ?? quote.price;
        }
        if (order.side === "SELL" && quote.price <= order.stopPrice) {
          return quote.bid ?? quote.price;
        }
        return null;

      case "STOP_LIMIT":
        if (!order.stopPrice || !order.price) return null;
        const stopTriggered =
          order.side === "BUY"
            ? quote.price >= order.stopPrice
            : quote.price <= order.stopPrice;
        if (!stopTriggered) return null;
        if (order.side === "BUY") {
          const effectiveAsk = quote.ask ?? quote.price;
          return effectiveAsk <= order.price ? effectiveAsk : null;
        } else {
          const effectiveBid = quote.bid ?? quote.price;
          return effectiveBid >= order.price ? effectiveBid : null;
        }

      default:
        return null;
    }
  }

  /**
   * Calculate maximum fillable quantity based on volume constraints
   */
  private calculateFillQuantity(state: OrderState, quote: MarketQuote): number {
    const volumeConfig = this.config.slippage?.volume;
    if (!volumeConfig || !quote.volume) {
      return state.remainingQuantity;
    }

    // Calculate max allowed quantity based on volume participation
    if (volumeConfig.maxParticipation) {
      const maxQty = quote.volume * volumeConfig.maxParticipation;

      if (state.remainingQuantity > maxQty) {
        // Partial fill allowed
        if (volumeConfig.allowPartialFills) {
          return maxQty;
        }
        // Reject entire order
        return 0;
      }
    }

    return state.remainingQuantity;
  }

  /**
   * Calculate price slippage adjustment
   */
  private calculatePriceSlippage(
    price: number,
    quant: number,
    side: "BUY" | "SELL",
    barVolume?: number
  ): number {
    const priceConfig = this.config.slippage?.price;
    if (!priceConfig) return 0;

    let totalSlippage = 0;

    // Fixed slippage (in basis points)
    if (priceConfig.fixed) {
      totalSlippage += (priceConfig.fixed / 10000) * price;
    }

    // Market impact based on volume participation
    if (priceConfig.marketImpact && barVolume && barVolume > 0) {
      const volumePct = quant / barVolume;
      totalSlippage += volumePct * priceConfig.marketImpact * price;
    }

    // Apply slippage direction (buy = higher, sell = lower)
    return side === "BUY" ? totalSlippage : -totalSlippage;
  }

  /**
   * Calculate commission for a trade
   */
  private calculateCommission(price: number, quant: number): number {
    const notional = price * quant;
    const commission = this.config.commission;

    // Complex commission structure
    let totalCommission = 0;
    if (commission.rate) {
      totalCommission += notional * commission.rate;
    }
    if (commission.perTrade) {
      totalCommission += commission.perTrade;
    }

    // Apply min/max constraints
    if (commission.minimum && totalCommission < commission.minimum) {
      totalCommission = commission.minimum;
    }
    if (commission.maximum && totalCommission > commission.maximum) {
      totalCommission = commission.maximum;
    }

    return totalCommission;
  }
}
