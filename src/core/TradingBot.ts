import {
  type Position,
  type MarketQuote,
  processFill,
  createPosition,
} from "@junduck/trading-core/trading";
import type {
  Event,
  MarketEvent,
  OrderEvent,
  ExternalEvent,
} from "../types/Events.js";
import type { DataProvider } from "../providers/DataProvider.js";
import type { TradeProvider } from "../providers/TradeProvider.js";
import type { ExternalProvider } from "../providers/ExternalProvider.js";
import { Router } from "./Router.js";
import {
  compose,
  type UniversalAlgo,
  type MarketAlgo,
  type OrderAlgo,
  type ExternalAlgo,
} from "./compose.js";
import { Context } from "./Context.js";
import { defaultLogger, type Logger } from "./Logger.js";
import { TradingError } from "./TradingError.js";
import { Snapshot } from "./Snapshot.js";

/** Fluent builder for market event routes. */
class MarketRouteBuilder {
  constructor(
    private readonly router: Router,
    private readonly filter?: (event: MarketEvent) => boolean
  ) {}

  /** Register middleware for this market route. */
  use(...middleware: MarketAlgo[]): void {
    if (this.filter) {
      this.router.market({ strategy: middleware, filter: this.filter });
    } else {
      this.router.market({ strategy: middleware });
    }
  }
}

/** Fluent builder for order event routes. */
class OrderRouteBuilder {
  constructor(
    private readonly router: Router,
    private readonly filter?: (event: OrderEvent) => boolean
  ) {}

  /** Register middleware for this order route. */
  use(...middleware: OrderAlgo[]): void {
    if (this.filter) {
      this.router.order({ strategy: middleware, filter: this.filter });
    } else {
      this.router.order({ strategy: middleware });
    }
  }
}

/** Fluent builder for external event routes. */
class ExternalRouteBuilder {
  constructor(
    private readonly router: Router,
    private readonly filter?: (event: ExternalEvent) => boolean
  ) {}

  /** Register middleware for this external route. */
  use(...middleware: ExternalAlgo[]): void {
    if (this.filter) {
      this.router.external({ strategy: middleware, filter: this.filter });
    } else {
      this.router.external({ strategy: middleware });
    }
  }
}

/**
 * Main orchestrator implementing middleware-based event processing.
 *
 * Middleware receives {position, snapshot} and collects pendingActions.
 * After middleware chain completes, pendingActions are executed.
 */
export class TradingBot {
  private readonly dataProvider: DataProvider;
  private readonly tradeProvider: TradeProvider;
  private readonly externalProvider?: ExternalProvider | undefined;

  private readonly router = new Router();
  private readonly preRoute: UniversalAlgo[] = [];
  private readonly logger;
  private readonly symbols: string[];

  private position: Position;
  private snapshot: Snapshot;
  private running = false;

  constructor(opts: {
    dataProvider: DataProvider;
    tradeProvider: TradeProvider;
    externalProvider?: ExternalProvider;
    symbols?: string[];
    initialQuotes?: MarketQuote[];
    logger?: Logger;
  }) {
    this.dataProvider = opts.dataProvider;
    this.tradeProvider = opts.tradeProvider;
    this.externalProvider = opts.externalProvider;
    this.symbols = opts.symbols ?? [];
    this.logger = opts.logger ?? defaultLogger;

    this.position = createPosition();
    this.snapshot = new Snapshot();
    if (opts.initialQuotes) {
      this.snapshot.updateQuotes(opts.initialQuotes, this.position);
    }
  }

  /**
   * Add global middleware applied to all events.
   *
   * Business logic: Only universal algorithms can be added globally.
   * Event-specific algorithms must use route methods (on).
   */
  use(...middleware: UniversalAlgo[]): this {
    this.preRoute.push(...middleware);
    return this;
  }

  /**
   * Register middleware for market events.
   * @example bot.on("market").use(macdStrategy);
   */
  on(
    eventType: "market",
    filter?: (event: MarketEvent) => boolean
  ): MarketRouteBuilder;

  /**
   * Register middleware for order events.
   * @example bot.on("order").use(orderLogger);
   */
  on(
    eventType: "order",
    filter?: (event: OrderEvent) => boolean
  ): OrderRouteBuilder;

  /**
   * Register middleware for external events.
   * @example bot.on("external").use(newsAnalyzer);
   */
  on(
    eventType: "external",
    filter?: (event: ExternalEvent) => boolean
  ): ExternalRouteBuilder;

  on(
    eventType: "market" | "order" | "external",
    filter?:
      | ((event: MarketEvent) => boolean)
      | ((event: OrderEvent) => boolean)
      | ((event: ExternalEvent) => boolean)
  ): MarketRouteBuilder | OrderRouteBuilder | ExternalRouteBuilder {
    if (eventType === "market") {
      return new MarketRouteBuilder(
        this.router,
        filter as ((event: MarketEvent) => boolean) | undefined
      );
    }
    if (eventType === "order") {
      return new OrderRouteBuilder(
        this.router,
        filter as ((event: OrderEvent) => boolean) | undefined
      );
    }
    return new ExternalRouteBuilder(
      this.router,
      filter as ((event: ExternalEvent) => boolean) | undefined
    );
  }

  /** Start event loop: connect, subscribe, begin processing. */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error("TradingBot is already running");
    }

    const connections = [
      this.dataProvider.connect(this.onMarketEvent.bind(this)),
      this.tradeProvider.connect(this.onOrderEvent.bind(this)),
    ];
    if (this.externalProvider) {
      connections.push(
        this.externalProvider.connect(this.onExternalEvent.bind(this))
      );
    }
    await Promise.all(connections);

    this.position = await this.tradeProvider.getPosition();

    const subs = [
      this.tradeProvider.subscribe(),
      this.dataProvider.subscribeSymbols(this.symbols),
    ];
    if (this.externalProvider) {
      subs.push(this.externalProvider.subscribe());
    }
    await Promise.all(subs);

    this.running = true;

    const begins = [this.dataProvider.begin(), this.tradeProvider.begin()];
    if (this.externalProvider) {
      begins.push(this.externalProvider.begin());
    }
    await Promise.all(begins);
  }

  /** Stop event loop: end processing, unsubscribe, disconnect. */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;

    const ends = [this.dataProvider.end(), this.tradeProvider.end()];
    if (this.externalProvider) {
      ends.push(this.externalProvider.end());
    }
    await Promise.all(ends);

    const unsubs = [
      this.dataProvider.unsubscribeSymbols(this.symbols),
      this.tradeProvider.unsubscribe(),
    ];
    if (this.externalProvider) {
      unsubs.push(this.externalProvider.unsubscribe());
    }
    await Promise.all(unsubs);

    const disconnections = [
      this.dataProvider.disconnect(),
      this.tradeProvider.disconnect(),
    ];
    if (this.externalProvider) {
      disconnections.push(this.externalProvider.disconnect());
    }
    await Promise.all(disconnections);
  }

  /** Synchronous stop for error handling. Does not await cleanup. */
  stopSync(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    // Execute all stop operations synchronously without awaiting
    // This is acceptable in error scenarios as we're shutting down
    void Promise.all([
      this.dataProvider.end(),
      this.tradeProvider.end(),
      ...(this.externalProvider ? [this.externalProvider.end()] : []),
    ]);

    void Promise.all([
      this.dataProvider.unsubscribeSymbols(this.symbols),
      this.tradeProvider.unsubscribe(),
      ...(this.externalProvider ? [this.externalProvider.unsubscribe()] : []),
    ]);

    void Promise.all([
      this.dataProvider.disconnect(),
      this.tradeProvider.disconnect(),
      ...(this.externalProvider ? [this.externalProvider.disconnect()] : []),
    ]);
  }

  isRunning(): boolean {
    return this.running;
  }

  private onMarketEvent(event: MarketEvent): void {
    this.snapshot.updateQuotes(event.marketData, this.position);
    this.runMiddleware(event);
  }

  private onOrderEvent(event: OrderEvent): void {
    // Business logic: Apply fills to position before running middleware
    if (event.fill.length > 0) {
      const symbols: string[] = [];
      for (const fill of event.fill) {
        processFill(this.position, fill);
        symbols.push(fill.symbol);
      }
      this.snapshot.updatePosition(symbols, this.position);
    }
    this.runMiddleware(event);
  }

  private onExternalEvent(event: ExternalEvent): void {
    this.runMiddleware(event);
  }

  private runMiddleware(event: Event): void {
    if (!this.running) {
      return;
    }

    const matchedRoutes = this.router.match(event);
    const ctx = new Context({
      event,
      position: this.position,
      snapshot: this.snapshot,
      dataProvider: this.dataProvider,
      tradeProvider: this.tradeProvider,
      externalProvider: this.externalProvider,
      logger: this.logger,
    });

    for (const routeAlgorithms of matchedRoutes) {
      try {
        const middleware = [...this.preRoute, ...routeAlgorithms];
        const composedMiddleware = compose(middleware);
        composedMiddleware(ctx, () => {});
        // ctx.state is not shared
        ctx.state.clear();
      } catch (error) {
        this.handleError(error);
      }
    }

    // Business logic: Process pending orders after middleware chain completes, do not block, fire-and-forget
    queueMicrotask(() => {
      this.processOrders(ctx).catch((error: unknown) => {
        this.handleError(error);
      });
    });
  }

  private handleError(error: unknown): void {
    if (!(error instanceof TradingError)) {
      throw error;
    }
    this.logger.error(error.toJSON());

    // Business logic: Handle errors based on severity level
    switch (error.severity) {
      case "recover":
        // Continue processing
        break;
      case "cancel":
        // Cancel all orders but keep running
        this.tradeProvider.emergencyCancel();
        break;
      case "halt":
        // Cancel orders and stop bot
        this.tradeProvider.emergencyCancel();
        this.stopSync();
        throw error;
      case "fatal":
        // Stop immediately
        this.stopSync();
        throw error;
    }
  }

  private async processOrders(ctx: Context): Promise<void> {
    const pending = ctx.getPending();
    if (pending.length === 0) {
      return;
    }

    const hasCancelAll = pending.some((action) => action.type === "cancel_all");
    if (hasCancelAll) {
      await this.tradeProvider.cancelAllOrders();
      return;
    }

    const submit = pending
      .filter((action) => action.type == "submit")
      .map((action) => action.order);
    const cancel = pending
      .filter((action) => action.type == "cancel")
      .map((action) => action.orderId);
    const amend = pending
      .filter((action) => action.type == "amend")
      .map((action) => action.update);

    if (submit.length) {
      await this.tradeProvider.submitOrder(submit);
    }
    if (cancel.length) {
      await this.tradeProvider.cancelOrder(cancel);
    }
    if (amend.length) {
      await this.tradeProvider.amendOrder(amend);
    }
  }
}
