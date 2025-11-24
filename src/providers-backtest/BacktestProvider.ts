import type {
  MarketQuote,
  Order,
  OrderState,
  Position,
  Fill,
} from "@junduck/trading-core";
import {
  openLong,
  closeLong,
  openShort,
  closeShort,
} from "@junduck/trading-core";
import { TradeProvider } from "../providers/TradeProvider.js";
import type { OrderEvent } from "../types/Events.js";
import type { MarketAlgorithm } from "../core/compose.js";
import { TradingErrors } from "../core/TradingError.js";

export interface BacktestConfig {
  /** Initial cash balance */
  initialCash: number;
  /** Commission rate (0.001 = 0.1%) */
  commissionRate: number;
}

/**
 * Backtesting trade provider.
 * Implements only TradeProvider interface and processes orders based on market data.
 * Use onMarketData() as first middleware to match orders with market data.
 */
export class BacktestProvider extends TradeProvider {
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
   * Returns middleware that matches orders with market data.
   * Register this as first middleware in market routes.
   *
   * @returns Market algorithm middleware function (only works with market events)
   *
   * @example
   * ```ts
   * const backtest = new BacktestProvider({ initialCash: 100000, commissionRate: 0.001 });
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
      await this.processPendingOrders(ctx.event.marketData, ctx.event.timestamp);
      await next();
    };
  }

  async getPosition(): Promise<Position> {
    return structuredClone(this.position);
  }

  async submitOrder(order: Order): Promise<Order> {
    const orderState: OrderState = {
      ...order,
      filledQuantity: 0,
      remainingQuantity: order.quantity,
      status: "OPEN",
      modified: new Date(),
    };

    this.pendingOrders.set(order.id, orderState);

    if (this.running && this.orderCallback) {
      await this.orderCallback({
        type: "order",
        timestamp: new Date(),
        state: orderState,
      });
    }

    return order;
  }

  async getOrder(orderId: string): Promise<Order> {
    const order = this.pendingOrders.get(orderId);
    if (!order) {
      throw TradingErrors.provider({
        message: `Order ${orderId} not found`,
        sourceName: "BacktestProvider",
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

    order.status = "CANCELLED";
    order.modified = new Date();
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
      orderState.status = "CANCELLED";
      orderState.modified = new Date();
    }
    this.pendingOrders.clear();
  }

  async amendOrder(orderId: string, updates: Partial<Order>): Promise<Order> {
    const order = this.pendingOrders.get(orderId);
    if (!order) {
      throw TradingErrors.provider({
        message: `Order ${orderId} not found`,
        sourceName: "BacktestProvider",
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

      const fillPrice = this.getFillPrice(orderState, quote);
      if (fillPrice === null) continue;

      const fill = this.executeFill(orderState, fillPrice, timestamp);

      orderState.filledQuantity += orderState.remainingQuantity;
      orderState.remainingQuantity = 0;
      orderState.status = "FILLED";
      orderState.modified = timestamp;

      this.pendingOrders.delete(orderId);

      if (this.running && this.orderCallback) {
        await this.orderCallback({
          type: "order",
          timestamp,
          state: orderState,
          execution: fill,
        });
      }
    }
  }

  private getFillPrice(order: OrderState, quote: MarketQuote): number | null {
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

  private executeFill(
    order: OrderState,
    fillPrice: number,
    timestamp: Date
  ): Fill {
    const quantity = order.remainingQuantity;
    const commission = fillPrice * quantity * this.config.commissionRate;

    if (order.effect === "OPEN_LONG") {
      openLong(
        this.position,
        order.symbol,
        fillPrice,
        quantity,
        commission,
        timestamp
      );
    } else if (order.effect === "CLOSE_LONG") {
      closeLong(
        this.position,
        order.symbol,
        fillPrice,
        quantity,
        commission,
        "FIFO",
        timestamp
      );
    } else if (order.effect === "OPEN_SHORT") {
      openShort(
        this.position,
        order.symbol,
        fillPrice,
        quantity,
        commission,
        timestamp
      );
    } else if (order.effect === "CLOSE_SHORT") {
      closeShort(
        this.position,
        order.symbol,
        fillPrice,
        quantity,
        commission,
        "FIFO",
        timestamp
      );
    }

    const fillBase = {
      id: `fill_${this.orderIdCounter++}`,
      orderId: order.id,
      symbol: order.symbol,
      quantity,
      price: fillPrice,
      commission,
      created: timestamp,
    };

    let fill: Fill;
    if (order.side === "BUY" && order.effect === "OPEN_LONG") {
      fill = {
        ...fillBase,
        side: "BUY" as const,
        effect: "OPEN_LONG" as const,
      };
    } else if (order.side === "BUY" && order.effect === "CLOSE_SHORT") {
      fill = {
        ...fillBase,
        side: "BUY" as const,
        effect: "CLOSE_SHORT" as const,
      };
    } else if (order.side === "SELL" && order.effect === "CLOSE_LONG") {
      fill = {
        ...fillBase,
        side: "SELL" as const,
        effect: "CLOSE_LONG" as const,
      };
    } else {
      fill = {
        ...fillBase,
        side: "SELL" as const,
        effect: "OPEN_SHORT" as const,
      };
    }

    return fill;
  }
}
