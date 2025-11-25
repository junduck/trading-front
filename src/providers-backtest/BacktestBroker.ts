import type {
  MarketQuote,
  Order,
  OrderState,
  Position,
} from "@junduck/trading-core/trading";
import {
  fillOrder,
  cancelOrder as coreCancelOrder,
  acceptOrder,
  processFill,
} from "@junduck/trading-core/trading";
import { TradeProvider } from "../providers/TradeProvider.js";
import type { OrderEvent } from "../types/Events.js";
import type { MarketAlgorithm } from "../core/compose.js";
import { TradingErrors } from "../core/TradingError.js";

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
  commission: number | CommissionConfig;

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
  private pendingOrders: Map<string, OrderState> = new Map();
  private orderIdCounter = 0;
  private connected = false;
  private running = false;
  private orderCallback?: (event: OrderEvent) => void | Promise<void>;

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

  genOrderId(): string {
    return `backtest_${this.orderIdCounter++}`;
  }

  /**
   * Calculate commission for a trade
   */
  private calculateCommission(price: number, quantity: number): number {
    const notional = price * quantity;
    const commission = this.config.commission;

    // Simple rate format (backward compatible)
    if (typeof commission === "number") {
      return notional * commission;
    }

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

  /**
   * Calculate maximum fillable quantity based on volume constraints
   */
  private calculateFillQuantity(
    requestedQty: number,
    barVolume?: number
  ): number {
    const volumeConfig = this.config.slippage?.volume;
    if (!volumeConfig || !barVolume) {
      return requestedQty;
    }

    // Calculate max allowed quantity based on volume participation
    if (volumeConfig.maxParticipation) {
      const maxQty = barVolume * volumeConfig.maxParticipation;

      if (requestedQty > maxQty) {
        // Partial fill allowed
        if (volumeConfig.allowPartialFills) {
          return maxQty;
        }
        // Reject entire order
        return 0;
      }
    }

    return requestedQty;
  }

  /**
   * Calculate price slippage adjustment
   */
  private calculatePriceSlippage(
    price: number,
    fillQuantity: number,
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
      const volumePct = fillQuantity / barVolume;
      totalSlippage += volumePct * priceConfig.marketImpact * price;
    }

    // Apply slippage direction (buy = higher, sell = lower)
    return side === "BUY" ? totalSlippage : -totalSlippage;
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
        if (order.side === "BUY" && quote.ask && quote.ask <= order.price) {
          return quote.ask;
        }
        if (order.side === "SELL" && quote.bid && quote.bid >= order.price) {
          return quote.bid;
        }
        return null;

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
        if (order.side === "BUY" && quote.ask && quote.ask <= order.price) {
          return quote.ask;
        }
        if (order.side === "SELL" && quote.bid && quote.bid >= order.price) {
          return quote.bid;
        }
        return null;

      default:
        return null;
    }
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
  onMarketData(): MarketAlgorithm {
    return async (ctx, next) => {
      // ctx.event is guaranteed to be MarketEvent by type system
      await this.processPendingOrders(
        ctx.event.marketData,
        ctx.event.timestamp
      );
      await next();
    };
  }

  // ============================================================================
  // TradingProvider impl
  // ============================================================================

  async getPosition(): Promise<Position> {
    return structuredClone(this.position);
  }

  async submitOrder(order: Order): Promise<Order> {
    const state = acceptOrder(order);
    this.pendingOrders.set(order.id, state);

    if (this.running && this.orderCallback) {
      await this.orderCallback({
        type: "order",
        timestamp: new Date(),
        state,
      });
    }

    return order;
  }

  async getOrder(orderId: string): Promise<Order> {
    const order = this.pendingOrders.get(orderId);
    if (!order) {
      throw TradingErrors.provider({
        message: `Order ${orderId} not found`,
        sourceName: "BacktestBroker",
        severity: "recover",
        category: "execution",
      });
    }
    return order;
  }

  async getOpenOrders(): Promise<Order[]> {
    return Array.from(this.pendingOrders.values());
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.pendingOrders.get(orderId);
    if (!order) return false;

    coreCancelOrder(order);
    this.pendingOrders.delete(orderId);

    if (this.running && this.orderCallback) {
      await this.orderCallback({
        type: "order",
        timestamp: new Date(),
        state: order,
      });
    }

    return true;
  }

  async cancelAllOrders(): Promise<number> {
    const count = this.pendingOrders.size;
    const orders = Array.from(this.pendingOrders.values());

    for (const order of orders) {
      await this.cancelOrder(order.id);
    }

    return count;
  }

  emergencyCancel(): void {
    // Panic button - fire and forget, never throw
    if (!this.connected) return;
    for (const orderState of this.pendingOrders.values()) {
      coreCancelOrder(orderState);
    }
    this.pendingOrders.clear();
  }

  async amendOrder(orderId: string, updates: Partial<Order>): Promise<Order> {
    const order = this.pendingOrders.get(orderId);
    if (!order) {
      throw TradingErrors.provider({
        message: `Order ${orderId} not found`,
        sourceName: "BacktestBroker",
        severity: "recover",
        category: "execution",
      });
    }

    if (updates.quantity !== undefined) {
      const filled = order.filledQuantity;
      order.quantity = updates.quantity;
      order.remainingQuantity = updates.quantity - filled;
    }
    if (updates.price !== undefined) order.price = updates.price;
    if (updates.stopPrice !== undefined) order.stopPrice = updates.stopPrice;
    order.modified = new Date();

    if (this.running && this.orderCallback) {
      await this.orderCallback({
        type: "order",
        timestamp: new Date(),
        state: order,
      });
    }

    return order;
  }

  async connect(
    callback: (event: OrderEvent) => void | Promise<void>
  ): Promise<void> {
    this.orderCallback = callback;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    await this.end();
    this.connected = false;
    delete this.orderCallback;
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
  // Brokerage impl
  // ============================================================================

  private async processPendingOrders(
    quotes: MarketQuote[],
    timestamp: Date
  ): Promise<void> {
    const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

    for (const [orderId, orderState] of Array.from(
      this.pendingOrders.entries()
    )) {
      const quote = quoteMap.get(orderState.symbol);
      if (!quote) continue;

      // Determine base fill price from order type
      const baseFillPrice = this.getMatchPrice(orderState, quote);
      if (baseFillPrice === null) continue;

      // Apply volume slippage: calculate fillable quantity
      const fillableQty = this.calculateFillQuantity(
        orderState.remainingQuantity,
        quote.volume
      );
      if (fillableQty === 0) continue;

      // Apply price slippage: adjust fill price
      const priceSlippage = this.calculatePriceSlippage(
        baseFillPrice,
        fillableQty,
        orderState.side,
        quote.volume
      );
      const adjustedFillPrice = baseFillPrice + priceSlippage;

      // Calculate commission
      const commission = this.calculateCommission(
        adjustedFillPrice,
        fillableQty
      );

      // Fill the order
      const fill = fillOrder({
        state: orderState,
        id: `fill_${this.orderIdCounter++}`,
        price: adjustedFillPrice,
        quant: fillableQty,
        commission,
        create: timestamp,
      });

      // Update position
      const effect = processFill(this.position, fill, "FIFO");

      // Remove from pending if fully filled
      if (orderState.status === "FILLED") {
        this.pendingOrders.delete(orderId);
      }

      if (this.running && this.orderCallback) {
        await this.orderCallback({
          type: "order",
          timestamp,
          state: orderState,
          effect,
        });
      }
    }
  }
}
