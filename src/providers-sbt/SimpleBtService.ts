import type { MarketEvent, OrderEvent } from "../types/Events.js";
import type {
  SbtMessage,
  SbtRequest,
  SbtResponse,
  SbtMarketEvent,
  SbtOrderEvent,
  InitParams,
  InitResult,
} from "./protocol.js";
import { SimpleBtDataProvider } from "./SimpleBtDataProvider.js";
import { SimpleBtTradeProvider } from "./SimpleBtTradeProvider.js";

export interface SimpleBtServiceOptions {
  url: string;
  /** WebSocket implementation (native browser WebSocket or ws package) */
  WebSocket?: typeof globalThis.WebSocket;
  /** Optional initialization configuration sent to server on connection */
  initConfig?: unknown;
}

/**
 * Multiplexed SimpleBT service managing a single WebSocket connection
 * for multiple concurrent backtest clients.
 *
 * Business logic:
 * - Single WebSocket connection shared across multiple client IDs
 * - Request-response correlation via action_id
 * - Event routing to appropriate client handlers
 * - Factory methods return DataProvider/TradeProvider instances per client
 *
 * @platform universal
 */
export class SimpleBtService {
  private url: string;
  private ws?: WebSocket;
  private WebSocketImpl: typeof globalThis.WebSocket;
  private initConfig?: unknown;
  private connected = false;
  private actionIdCounter = 0;

  // Pending requests awaiting response
  private pendingRequests = new Map<
    number,
    {
      resolve: (result: any) => void;
      reject: (error: Error) => void;
    }
  >();

  // Client event handlers
  private marketHandlers = new Map<string, (event: MarketEvent) => Promise<void>>();
  private orderHandlers = new Map<string, (event: OrderEvent) => Promise<void>>();

  constructor(opts: SimpleBtServiceOptions) {
    this.url = opts.url;
    this.WebSocketImpl = opts.WebSocket ?? globalThis.WebSocket;
    this.initConfig = opts.initConfig;
  }

  /**
   * Connect to SimpleBT server and send initialization message.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise<void>((resolve, reject) => {
      const ws = new this.WebSocketImpl(this.url);

      ws.onopen = async () => {
        this.ws = ws;
        this.connected = true;

        // Send init message to server
        try {
          await this.sendRequest<InitResult>("init", {
            config: this.initConfig,
          } as InitParams);
          resolve();
        } catch (error) {
          // Reset state on init failure to prevent inconsistent state
          this.connected = false;
          delete this.ws;
          ws.close();
          reject(error);
        }
      };

      ws.onerror = (error) => {
        reject(new Error(`WebSocket connection failed: ${error}`));
      };

      ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      ws.onclose = () => {
        this.connected = false;
        delete this.ws;
        this.rejectAllPending(new Error("WebSocket connection closed"));
      };
    });
  }

  /**
   * Disconnect from SimpleBT server.
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      delete this.ws;
    }

    this.connected = false;
    this.marketHandlers.clear();
    this.orderHandlers.clear();
    this.rejectAllPending(new Error("Service disconnected"));
  }

  /**
   * Create a DataProvider instance for a specific client ID.
   */
  getDataProvider(cid: string): SimpleBtDataProvider {
    return new SimpleBtDataProvider(this, cid);
  }

  /**
   * Create a TradeProvider instance for a specific client ID.
   */
  getTradeProvider(cid: string): SimpleBtTradeProvider {
    return new SimpleBtTradeProvider(this, cid);
  }

  /**
   * Register market event handler for a client.
   * @internal
   */
  registerMarketHandler(cid: string, handler: (event: MarketEvent) => Promise<void>): void {
    this.marketHandlers.set(cid, handler);
  }

  /**
   * Unregister market event handler for a client.
   * @internal
   */
  unregisterMarketHandler(cid: string): void {
    this.marketHandlers.delete(cid);
  }

  /**
   * Register order event handler for a client.
   * @internal
   */
  registerOrderHandler(cid: string, handler: (event: OrderEvent) => Promise<void>): void {
    this.orderHandlers.set(cid, handler);
  }

  /**
   * Unregister order event handler for a client.
   * @internal
   */
  unregisterOrderHandler(cid: string): void {
    this.orderHandlers.delete(cid);
  }

  /**
   * Send request and wait for response.
   * @internal
   */
  async sendRequest<T>(action: string, params: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== this.WebSocketImpl.OPEN) {
      throw new Error("WebSocket not in OPEN state");
    }

    const action_id = this.actionIdCounter++;
    const request: SbtRequest = { action, action_id, params };

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(action_id, { resolve, reject });
      this.ws!.send(JSON.stringify(request));
    });
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as SbtMessage;

      if (message.type === "response") {
        this.handleResponse(message);
      } else if (message.type === "market") {
        // Fire async handler without blocking WebSocket message processing
        this.handleMarketEvent(message).catch((error) => {
          console.error("Market event handler error:", error);
        });
      } else if (message.type === "order") {
        // Fire async handler without blocking WebSocket message processing
        this.handleOrderEvent(message).catch((error) => {
          console.error("Order event handler error:", error);
        });
      }
    } catch (error) {
      console.error("Failed to parse SimpleBT message:", error);
    }
  }

  private handleResponse(response: SbtResponse): void {
    const pending = this.pendingRequests.get(response.action_id);
    if (!pending) return;

    this.pendingRequests.delete(response.action_id);

    if (response.error) {
      pending.reject(
        new Error(`${response.error.code}: ${response.error.message}`)
      );
    } else {
      pending.resolve(response.result);
    }
  }

  private async handleMarketEvent(event: SbtMarketEvent): Promise<void> {
    const marketData = event.data;
    if (!Array.isArray(marketData) || marketData.length === 0) return;

    // Route to specific client handler
    const handler = this.marketHandlers.get(event.cid);
    if (!handler) return;

    const timestamp = new Date(event.timestamp);

    const marketEvent: MarketEvent = {
      type: "market",
      timestamp,
      marketData,
    };

    await handler(marketEvent);
  }

  private async handleOrderEvent(event: SbtOrderEvent): Promise<void> {
    // Route to specific client handler
    const handler = this.orderHandlers.get(event.cid);
    if (!handler) return;

    const timestamp = new Date(event.timestamp);

    const orderEvent: OrderEvent = {
      type: "order",
      timestamp,
      updated: event.data.updated,
      fill: event.data.fills,
    };

    await handler(orderEvent);
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }
}
