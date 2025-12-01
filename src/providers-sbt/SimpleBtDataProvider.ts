import { DataProvider } from "../providers/DataProvider.js";
import type { MarketEvent } from "../types/Events.js";
import { TradingErrors } from "../core/TradingError.js";
import type { SimpleBtService } from "./SimpleBtService.js";
import type {
  LoginParams,
  LoginResult,
  SubscribeParams,
  SubscribeResult,
  UnsubscribeParams,
  UnsubscribeResult,
} from "./protocol.js";

/**
 * SimpleBT DataProvider implementation using shared service connection.
 *
 * Business logic:
 * - Multiplexes data subscriptions over shared WebSocket
 * - Client ID identifies this provider's session
 * - Delegates all network operations to SimpleBtService
 *
 * @platform universal
 */
export class SimpleBtDataProvider extends DataProvider {
  private service: SimpleBtService;
  private cid: string;
  private loggedIn = false;
  private running = false;
  private callback?: (event: MarketEvent) => Promise<void>;
  private subscribedSymbols = new Set<string>();

  /** @internal */
  constructor(service: SimpleBtService, cid: string) {
    super();
    this.service = service;
    this.cid = cid;
  }

  async connect(callback: (event: MarketEvent) => Promise<void>): Promise<void> {
    if (this.loggedIn) return;

    if (!this.service.isConnected()) {
      throw TradingErrors.provider({
        message: "SimpleBtService not connected",
        sourceName: "SimpleBtDataProvider",
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
    this.service.registerMarketHandler(this.cid, callback);

    this.loggedIn = true;
  }

  async disconnect(): Promise<void> {
    await this.end();

    if (this.loggedIn) {
      this.service.unregisterMarketHandler(this.cid);
      this.loggedIn = false;
    }

    this.subscribedSymbols.clear();
    delete this.callback;
  }

  async subscribeSymbols(symbols: string[]): Promise<void> {
    if (!this.loggedIn) {
      throw TradingErrors.provider({
        message: "Must call connect() before subscribeSymbols()",
        sourceName: "SimpleBtDataProvider",
        severity: "halt",
        category: "state",
      });
    }

    if (symbols.length === 0) return;

    await this.service.sendRequest<SubscribeResult>("subscribe", {
      cid: this.cid,
      symbols,
    } as SubscribeParams);

    symbols.forEach((s) => this.subscribedSymbols.add(s));
  }

  async subscribe(_options?: unknown): Promise<void> {
    return Promise.resolve();
  }

  async unsubscribeSymbols(symbols: string[]): Promise<void> {
    if (!this.loggedIn) {
      throw TradingErrors.provider({
        message: "Must call connect() before unsubscribeSymbols()",
        sourceName: "SimpleBtDataProvider",
        severity: "halt",
        category: "state",
      });
    }

    if (symbols.length === 0) return;

    await this.service.sendRequest<UnsubscribeResult>("unsubscribe", {
      cid: this.cid,
      symbols,
    } as UnsubscribeParams);

    symbols.forEach((s) => this.subscribedSymbols.delete(s));
  }

  async unsubscribe(_options?: unknown): Promise<void> {
    await this.end();
  }

  async begin(): Promise<void> {
    if (this.running) return;
    if (!this.loggedIn || !this.callback) {
      throw TradingErrors.provider({
        message: "Must call connect() before begin()",
        sourceName: "SimpleBtDataProvider",
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
}
