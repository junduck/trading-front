import type { Order, Position, OrderState, Fill } from "@junduck/trading-core";
import type { OrderEvent } from "../types/Events.js";
import { TradeProvider } from "./TradeProvider.js";

/** Configuration options for MockTradeProvider */
export interface MockTradeProviderConfig {
  /** Initial cash balance (default: 100000) */
  initialCash?: number;
  /** Simulated order latency in milliseconds (default: 100) */
  orderLatency?: number;
  /** Commission per share (default: 0) */
  commissionPerShare?: number;
  /** Slippage in basis points (default: 0) */
  slippageBps?: number;
  /** Provider to query current prices for fills */
  priceProvider?: (symbol: string) => number;
}

/**
 * Mock TradeProvider for testing and development.
 * Simulates order execution with configurable latency, commission, and slippage.
 */
export class MockTradeProvider extends TradeProvider {
  private connected = false;
  private position: Position;
  private orders: Map<string, OrderState> = new Map();
  private callback: ((event: OrderEvent) => void) | undefined = undefined;
  private subscribed = false;
  private nextOrderId = 1;

  private readonly orderLatency: number;
  private readonly commissionPerShare: number;
  private readonly slippageBps: number;
  private readonly priceProvider: ((symbol: string) => number) | undefined;

  constructor(config: MockTradeProviderConfig = {}) {
    super();
    this.position = {
      cash: config.initialCash ?? 100000,
      totalCommission: 0,
      realisedPnL: 0,
      modified: new Date(),
    };
    this.orderLatency = config.orderLatency ?? 100;
    this.commissionPerShare = config.commissionPerShare ?? 0;
    this.slippageBps = config.slippageBps ?? 0;
    this.priceProvider = config.priceProvider ?? undefined;
  }

  async connect(callback: (event: OrderEvent) => void): Promise<void> {
    this.callback = callback;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getPosition(): Promise<Position> {
    if (!this.connected) {
      throw new Error("MockTradeProvider is not connected");
    }
    return { ...this.position };
  }

  async submitOrder(order: Order): Promise<Order> {
    if (!this.connected) {
      throw new Error("MockTradeProvider is not connected");
    }

    const orderId = `MOCK-${this.nextOrderId++}`;

    const submittedOrder: Order = {
      ...order,
      id: orderId,
      created: new Date(),
    };

    const orderState: OrderState = {
      ...submittedOrder,
      filledQuantity: 0,
      remainingQuantity: order.quantity,
      status: "OPEN",
      modified: new Date(),
    };

    this.orders.set(orderId, orderState);
    this.emitOrderEvent(orderState);

    // Simulate order processing after latency
    setTimeout(() => {
      this.processOrder(orderId).catch((err) =>
        console.error("Error processing order:", err)
      );
    }, this.orderLatency);

    return submittedOrder;
  }

  async getOrder(orderId: string): Promise<Order> {
    if (!this.connected) {
      throw new Error("MockTradeProvider is not connected");
    }

    const orderState = this.orders.get(orderId);
    if (!orderState) {
      throw new Error(`Order ${orderId} not found`);
    }

    const { filledQuantity, remainingQuantity, status, modified, ...order } =
      orderState;
    return order;
  }

  async getOpenOrders(_options?: unknown): Promise<Order[]> {
    if (!this.connected) {
      throw new Error("MockTradeProvider is not connected");
    }

    const openOrders: Order[] = [];
    for (const orderState of this.orders.values()) {
      if (orderState.status === "OPEN") {
        const {
          filledQuantity,
          remainingQuantity,
          status,
          modified,
          ...order
        } = orderState;
        openOrders.push(order);
      }
    }
    return openOrders;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.connected) {
      throw new Error("MockTradeProvider is not connected");
    }

    const orderState = this.orders.get(orderId);
    if (!orderState) {
      return false;
    }

    if (orderState.status === "FILLED" || orderState.status === "CANCELLED") {
      return false;
    }

    orderState.status = "CANCELLED";
    orderState.modified = new Date();
    this.emitOrderEvent(orderState);

    return true;
  }

  async cancelAllOrders(): Promise<number> {
    if (!this.connected) {
      throw new Error("MockTradeProvider is not connected");
    }

    let count = 0;
    for (const [orderId] of this.orders) {
      if (await this.cancelOrder(orderId)) {
        count++;
      }
    }
    return count;
  }

  async amendOrder(orderId: string, updates: Partial<Order>): Promise<Order> {
    if (!this.connected) {
      throw new Error("MockTradeProvider is not connected");
    }

    const orderState = this.orders.get(orderId);
    if (!orderState) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (orderState.status === "FILLED" || orderState.status === "CANCELLED") {
      throw new Error(`Cannot replace order in ${orderState.status} state`);
    }

    await this.cancelOrder(orderId);

    const { filledQuantity, remainingQuantity, status, modified, ...order } =
      orderState;

    // Submit new order with updates - use type assertion for union type
    const newOrder = {
      ...order,
      ...updates,
    } as Order;

    return this.submitOrder(newOrder);
  }

  async subscribe(): Promise<void> {
    this.subscribed = true;
  }

  async unsubscribe(): Promise<void> {
    this.subscribed = false;
  }

  /** Manually set position for testing */
  setPosition(position: Partial<Position>): void {
    this.position = {
      ...this.position,
      ...position,
      modified: new Date(),
    };
  }

  /** Get all orders */
  getOrders(): OrderState[] {
    return Array.from(this.orders.values());
  }

  /** Simulate order processing (immediately fill for simplicity) */
  private async processOrder(orderId: string): Promise<void> {
    const orderState = this.orders.get(orderId);
    if (!orderState || orderState.status !== "OPEN") {
      return;
    }

    await this.fillOrder(orderId);
  }

  /** Simulate order fill */
  private async fillOrder(orderId: string): Promise<void> {
    const orderState = this.orders.get(orderId);
    if (!orderState || orderState.status !== "OPEN") {
      return;
    }

    let fillPrice: number;
    if (orderState.type === "MARKET") {
      // Use price provider if available, otherwise use limit price or default
      fillPrice = this.priceProvider
        ? this.priceProvider(orderState.symbol)
        : orderState.price ?? 100;

      // Apply slippage
      const slippage = fillPrice * (this.slippageBps / 10000);
      fillPrice += orderState.side === "BUY" ? slippage : -slippage;
    } else if (orderState.type === "LIMIT" && orderState.price) {
      fillPrice = orderState.price;
    } else {
      fillPrice = 100;
    }

    const fillQty = orderState.quantity;
    const commission = fillQty * this.commissionPerShare;
    const fillValue = fillQty * fillPrice;

    // Create fill - use type assertion for union type
    const fill = {
      id: `FILL-${orderId}`,
      orderId,
      symbol: orderState.symbol,
      side: orderState.side,
      effect: orderState.effect,
      quantity: fillQty,
      price: fillPrice,
      commission,
      created: new Date(),
    } as Fill;

    if (orderState.side === "BUY") {
      this.position.cash -= fillValue + commission;
    } else {
      this.position.cash += fillValue - commission;
    }
    this.position.totalCommission += commission;
    this.position.modified = new Date();

    orderState.status = "FILLED";
    orderState.modified = new Date();
    orderState.filledQuantity = fillQty;
    orderState.remainingQuantity = 0;

    this.emitOrderEvent(orderState, fill);
  }

  /** Emit an order update event */
  private emitOrderEvent(orderState: OrderState, execution?: Fill): void {
    if (!this.subscribed || !this.callback) return;

    const event: OrderEvent = {
      type: "order",
      timestamp: new Date(),
      state: { ...orderState },
      ...(execution ? { execution } : {}),
    };

    this.callback(event);
  }
}
