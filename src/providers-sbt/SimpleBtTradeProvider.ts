import { TradeProvider } from "../providers/TradeProvider.js";
import type { OrderEvent } from "../types/Events.js";
import type { Order, Position } from "@junduck/trading-core/trading";
import type { AmendAction } from "../core/Context.js";
import { TradingErrors } from "../core/TradingError.js";
import type { SimpleBtService } from "./SimpleBtService.js";
import type {
  LoginParams,
  LoginResult,
  GetPositionParams,
  GetPositionResult,
  GetOpenOrdersParams,
  GetOpenOrdersResult,
  SubmitOrdersParams,
  SubmitOrdersResult,
  AmendOrdersParams,
  AmendOrdersResult,
  CancelOrdersParams,
  CancelOrdersResult,
  CancelAllOrdersParams,
  CancelAllOrdersResult,
} from "./protocol.js";

/**
 * SimpleBT TradeProvider implementation using shared service connection.
 *
 * Business logic:
 * - Multiplexes trade operations over shared WebSocket
 * - Client ID identifies this provider's trading account
 * - Delegates all network operations to SimpleBtService
 *
 * @platform universal
 */
export class SimpleBtTradeProvider extends TradeProvider {
  private service: SimpleBtService;
  private cid: string;
  private loggedIn = false;
  private running = false;
  private callback?: (event: OrderEvent) => Promise<void>;
  private orderIdCounter = 0;

  /** @internal */
  constructor(service: SimpleBtService, cid: string) {
    super();
    this.service = service;
    this.cid = cid;
  }

  genOrderId(): string {
    return `${this.cid}-order-${this.orderIdCounter++}`;
  }

  async connect(callback: (event: OrderEvent) => Promise<void>): Promise<void> {
    if (this.loggedIn) return;

    if (!this.service.isConnected()) {
      throw TradingErrors.provider({
        message: "SimpleBtService not connected",
        sourceName: "SimpleBtTradeProvider",
        severity: "halt",
        category: "state",
      });
    }

    // DESIGN NOTE: Login is called per provider instance, not centrally by service.
    // This means DataProvider and TradeProvider with same cid will send duplicate
    // login requests. Protocol assumes login is idempotent. A cleaner design would
    // have service manage login lifecycle, but current approach works if server
    // handles duplicate logins gracefully.
    await this.service.sendRequest<LoginResult>("login", {
      cid: this.cid,
    } as LoginParams);

    // Register event handler
    this.callback = callback;
    this.service.registerOrderHandler(this.cid, callback);

    this.loggedIn = true;
  }

  async disconnect(): Promise<void> {
    await this.end();

    if (this.loggedIn) {
      this.service.unregisterOrderHandler(this.cid);
      this.loggedIn = false;
    }

    delete this.callback;
  }

  async getPosition(): Promise<Position> {
    if (!this.loggedIn) {
      throw TradingErrors.provider({
        message: "Must call connect() before getPosition()",
        sourceName: "SimpleBtTradeProvider",
        severity: "halt",
        category: "state",
      });
    }

    const result = await this.service.sendRequest<GetPositionResult>(
      "getPosition",
      {
        cid: this.cid,
      } as GetPositionParams
    );

    // Deserialize Position maps and dates
    return this.deserializePosition(result);
  }

  async getOpenOrders(): Promise<Order[]> {
    if (!this.loggedIn) {
      throw TradingErrors.provider({
        message: "Must call connect() before getOpenOrders()",
        sourceName: "SimpleBtTradeProvider",
        severity: "halt",
        category: "state",
      });
    }

    const result = await this.service.sendRequest<GetOpenOrdersResult>(
      "getOpenOrders",
      {
        cid: this.cid,
      } as GetOpenOrdersParams
    );

    // NOTE: Server returns OrderState[] which extends Order[].
    // The cast is safe because OrderState contains all Order fields.
    return result as unknown as Order[];
  }

  emergencyCancel(): void {
    // Fire-and-forget emergency cancel
    if (this.loggedIn) {
      this.service
        .sendRequest<CancelAllOrdersResult>("cancelAllOrders", {
          cid: this.cid,
        } as CancelAllOrdersParams)
        .catch((error) => {
          console.error("Emergency cancel failed:", error);
        });
    }
  }

  async submitOrder(orders: Order[]): Promise<number> {
    if (!this.loggedIn) {
      throw TradingErrors.provider({
        message: "Must call connect() before submitOrder()",
        sourceName: "SimpleBtTradeProvider",
        severity: "halt",
        category: "state",
      });
    }

    const result = await this.service.sendRequest<SubmitOrdersResult>(
      "submitOrders",
      {
        cid: this.cid,
        orders,
      } as SubmitOrdersParams
    );

    return result.submitted;
  }

  async amendOrder(updates: AmendAction[]): Promise<number> {
    if (!this.loggedIn) {
      throw TradingErrors.provider({
        message: "Must call connect() before amendOrder()",
        sourceName: "SimpleBtTradeProvider",
        severity: "halt",
        category: "state",
      });
    }

    const result = await this.service.sendRequest<AmendOrdersResult>(
      "amendOrders",
      {
        cid: this.cid,
        updates,
      } as AmendOrdersParams
    );

    return result.amended;
  }

  async cancelOrder(ids: string[]): Promise<number> {
    if (!this.loggedIn) {
      throw TradingErrors.provider({
        message: "Must call connect() before cancelOrder()",
        sourceName: "SimpleBtTradeProvider",
        severity: "halt",
        category: "state",
      });
    }

    const result = await this.service.sendRequest<CancelOrdersResult>(
      "cancelOrders",
      {
        cid: this.cid,
        orderIds: ids,
      } as CancelOrdersParams
    );

    return result.cancelled;
  }

  async cancelAllOrders(): Promise<number> {
    if (!this.loggedIn) {
      throw TradingErrors.provider({
        message: "Must call connect() before cancelAllOrders()",
        sourceName: "SimpleBtTradeProvider",
        severity: "halt",
        category: "state",
      });
    }

    const result = await this.service.sendRequest<CancelAllOrdersResult>(
      "cancelAllOrders",
      {
        cid: this.cid,
      } as CancelAllOrdersParams
    );

    return result.cancelled;
  }

  async subscribe(_options?: unknown): Promise<void> {
    return Promise.resolve();
  }

  async unsubscribe(_options?: unknown): Promise<void> {
    await this.end();
  }

  async begin(): Promise<void> {
    if (this.running) return;
    if (!this.loggedIn || !this.callback) {
      throw TradingErrors.provider({
        message: "Must call connect() before begin()",
        sourceName: "SimpleBtTradeProvider",
        severity: "halt",
        category: "state",
      });
    }

    this.running = true;
  }

  async end(): Promise<void> {
    if (!this.running) return;
    this.running = false;
  }

  isConnected(): boolean {
    return this.loggedIn;
  }

  private deserializePosition(raw: GetPositionResult): Position {
    const position: Position = {
      cash: raw.cash,
      totalCommission: raw.totalCommission,
      realisedPnL: raw.realisedPnL,
      modified: new Date(raw.modified),
    };

    // Deserialize long positions
    if (raw.long) {
      position.long = new Map();
      for (const [symbol, longPos] of Object.entries(raw.long)) {
        position.long.set(symbol, {
          ...longPos,
          modified: new Date(longPos.modified),
        });
      }
    }

    // Deserialize short positions
    if (raw.short) {
      position.short = new Map();
      for (const [symbol, shortPos] of Object.entries(raw.short)) {
        position.short.set(symbol, {
          ...shortPos,
          modified: new Date(shortPos.modified),
        });
      }
    }

    return position;
  }
}
