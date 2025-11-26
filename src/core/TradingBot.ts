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
  NewsEvent,
} from "../types/Events.js";
import type { DataProvider } from "../providers/DataProvider.js";
import type { TradeProvider } from "../providers/TradeProvider.js";
import type { NewsProvider } from "../providers/NewsProvider.js";
import { Router } from "./Router.js";
import {
  compose,
  type UniversalAlgo,
  type MarketAlgo,
  type OrderAlgo,
  type NewsAlgo,
} from "./compose.js";
import { orderHandler } from "./OrderHandler.js";
import { Context } from "./Context.js";
import { defaultLogger, type Logger } from "./Logger.js";
import { TradingError } from "./TradingError.js";
import { Snapshot } from "./Snapshot.js";

/**
 * Event handler for agent events.
 */
export type AgentEventHandler<T = unknown> = (data: T) => void | Promise<void>;

/**
 * Fluent builder for market event routes.
 */
class MarketRouteBuilder {
  constructor(
    private readonly router: Router,
    private readonly filter?: (event: MarketEvent) => boolean
  ) {}

  /**
   * Register middleware for this market route.
   */
  use(...middleware: MarketAlgo[]): void {
    if (this.filter) {
      this.router.market({ strategy: middleware, filter: this.filter });
    } else {
      this.router.market({ strategy: middleware });
    }
  }
}

/**
 * Fluent builder for order event routes.
 */
class OrderRouteBuilder {
  constructor(
    private readonly router: Router,
    private readonly filter?: (event: OrderEvent) => boolean
  ) {}

  /**
   * Register middleware for this order route.
   */
  use(...middleware: OrderAlgo[]): void {
    if (this.filter) {
      this.router.order({ strategy: middleware, filter: this.filter });
    } else {
      this.router.order({ strategy: middleware });
    }
  }
}

/**
 * Fluent builder for news event routes.
 */
class NewsRouteBuilder {
  constructor(
    private readonly router: Router,
    private readonly filter?: (event: NewsEvent) => boolean
  ) {}

  /**
   * Register middleware for this news route.
   */
  use(...middleware: NewsAlgo[]): void {
    if (this.filter) {
      this.router.news({ strategy: middleware, filter: this.filter });
    } else {
      this.router.news({ strategy: middleware });
    }
  }
}

/**
 * Main agent orchestrator implementing a Koa-style event loop.
 *
 * Mental model:
 * - Request: {position, snapshot} from events
 * - Response: pendingActions[] collected by middleware
 * - Algorithm can await from dataProvider and tradeProvider
 * - At the end of chain, pendingActions are executed (like res.body in Koa)
 */
export class TradingBot {
  private readonly dataProvider: DataProvider;
  private readonly tradeProvider: TradeProvider;
  private readonly newsProvider?: NewsProvider | undefined;

  private readonly router = new Router();
  private readonly preRoute: UniversalAlgo[] = [];
  private readonly logger;
  private readonly symbols: string[];

  private position: Position;
  private snapshot: Snapshot;
  private running = false;

  // Event queue to ensure sequantial exec
  private eventQueue = Promise.resolve();

  // Event emitter for agent-level events (one handler per event type)
  private readonly eventHandlers: Map<string, AgentEventHandler> = new Map();

  constructor(opts: {
    dataProvider: DataProvider;
    tradeProvider: TradeProvider;
    newsProvider?: NewsProvider;
    symbols?: string[];
    initialQuotes?: MarketQuote[];
    logger?: Logger;
  }) {
    this.dataProvider = opts.dataProvider;
    this.tradeProvider = opts.tradeProvider;
    this.newsProvider = opts.newsProvider;
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
   * Business logic: Only universal algorithms (working with any event type) can be
   * added globally. Event-specific algorithms must use route methods (market, order, news).
   *
   * @param middleware - Universal algorithm functions to add
   * @returns This agent for chaining
   */
  use(...middleware: UniversalAlgo[]): this {
    this.preRoute.push(...middleware);
    return this;
  }

  /**
   * Fluent API for market events.
   *
   * @param filter - Optional filter function
   * @returns Builder to register market middleware
   *
   * @example
   * bot.on("market").use(macdStrategy, positionPrinter);
   * bot.on("market", (e) => e.marketData.symbol === "AAPL").use(appleStrategy);
   */
  on(
    eventType: "market",
    filter?: (event: MarketEvent) => boolean
  ): MarketRouteBuilder;

  /**
   * Fluent API for order events.
   *
   * @param filter - Optional filter function
   * @returns Builder to register order middleware
   *
   * @example
   * bot.on("order").use(orderLogger);
   * bot.on("order", (e) => e.fill.length > 0).use(fillHandler);
   */
  on(
    eventType: "order",
    filter?: (event: OrderEvent) => boolean
  ): OrderRouteBuilder;

  /**
   * Fluent API for news events.
   *
   * @param filter - Optional filter function
   * @returns Builder to register news middleware
   *
   * @example
   * bot.on("news").use(newsAnalyzer);
   */
  on(
    eventType: "news",
    filter?: (event: NewsEvent) => boolean
  ): NewsRouteBuilder;

  on(
    eventType: "market" | "order" | "news",
    filter?:
      | ((event: MarketEvent) => boolean)
      | ((event: OrderEvent) => boolean)
      | ((event: NewsEvent) => boolean)
  ): MarketRouteBuilder | OrderRouteBuilder | NewsRouteBuilder {
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
    return new NewsRouteBuilder(
      this.router,
      filter as ((event: NewsEvent) => boolean) | undefined
    );
  }

  /**
   * Start the agent event loop.
   * Connects to providers, subscribes, and begins processing events.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error("TradingBot is already running");
    }

    const connections = [
      this.dataProvider.connect(this.preMarketEvent.bind(this)),
      this.tradeProvider.connect(this.preOrderEvent.bind(this)),
    ];
    if (this.newsProvider) {
      connections.push(this.newsProvider.connect(this.preNewsEvent.bind(this)));
    }
    await Promise.all(connections);

    this.position = await this.tradeProvider.getPosition();

    const subs = [
      this.tradeProvider.subscribe(),
      this.dataProvider.subscribeSymbols(this.symbols),
    ];
    if (this.newsProvider) {
      subs.push(this.newsProvider.subscribe());
    }
    await Promise.all(subs);

    this.running = true;
    this.emit("started", undefined);

    const begins = [this.dataProvider.begin(), this.tradeProvider.begin()];
    if (this.newsProvider) {
      begins.push(this.newsProvider.begin());
    }
    await Promise.all(begins);
  }

  /**
   * Stop the agent event loop.
   * Stops event emission, unsubscribes, and disconnects from providers.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;

    const ends = [this.dataProvider.end(), this.tradeProvider.end()];
    if (this.newsProvider) {
      ends.push(this.newsProvider.end());
    }
    await Promise.all(ends);

    const unsubs = [
      this.dataProvider.unsubscribeSymbols(this.symbols),
      this.tradeProvider.unsubscribe(),
    ];
    if (this.newsProvider) {
      unsubs.push(this.newsProvider.unsubscribe());
    }
    await Promise.all(unsubs);

    const disconnections = [
      this.dataProvider.disconnect(),
      this.tradeProvider.disconnect(),
    ];
    if (this.newsProvider) {
      disconnections.push(this.newsProvider.disconnect());
    }
    await Promise.all(disconnections);

    await this.emit("stopped", undefined);
  }

  /**
   * Check if the agent is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Update snapshot before running main dispatch, queued by eventQueue
   *
   * @param event - Market event to process
   */
  private async preMarketEvent(event: MarketEvent): Promise<void> {
    this.eventQueue = this.eventQueue.then(async () => {
      this.snapshot.updateQuotes(event.marketData, this.position);
      await this.handleEvent(event);
    });

    await this.eventQueue;
  }

  /**
   * Update position and snapshot before running main dispatch, queued by eventQueue
   *
   * @param event - Order event to process
   */
  private async preOrderEvent(event: OrderEvent): Promise<void> {
    this.eventQueue = this.eventQueue.then(async () => {
      if (event.fill.length > 0) {
        const symbols: string[] = [];
        for (const fill of event.fill) {
          processFill(this.position, fill);
          symbols.push(fill.symbol);
        }
        this.snapshot.updatePosition(symbols, this.position);
      }
      await this.handleEvent(event);
    });

    await this.eventQueue;
  }

  /**
   * Run main dispatch, queued by eventQueue
   *
   * @param event - News event to process
   */
  private async preNewsEvent(event: NewsEvent): Promise<void> {
    this.eventQueue = this.eventQueue.then(async () => {
      await this.handleEvent(event);
    });

    await this.eventQueue;
  }

  /**
   * @param event - Event to process
   */
  private async handleEvent(event: Event): Promise<void> {
    if (!this.running) {
      return;
    }

    const matchedRoutes = this.router.match(event);

    for (const routeAlgorithms of matchedRoutes) {
      try {
        const routeContext = new Context({
          event,
          position: this.position,
          snapshot: this.snapshot,
          dataProvider: this.dataProvider,
          tradeProvider: this.tradeProvider,
          newsProvider: this.newsProvider,
          logger: this.logger,
        });

        const middleware = [...this.preRoute, ...routeAlgorithms];

        const composedMiddleware = compose(middleware);
        await composedMiddleware(routeContext, async () => {});

        await orderHandler(routeContext);
      } catch (error) {
        if (!(error instanceof TradingError)) {
          throw error;
        }

        this.logger.error(error.toJSON());

        // Business logic: Execute control flow based on error severity
        switch (error.severity) {
          case "recover":
            break;
          case "cancel":
            this.tradeProvider.emergencyCancel();
            break;
          case "halt":
            this.tradeProvider.emergencyCancel();
            await this.stop();
            throw error;
          case "fatal":
            await this.stop();
            throw error;
        }
      }
    }
  }

  /**
   * Emit an agent event.
   *
   * @param eventType - Event type
   * @param data - Event data
   */
  private async emit<T = unknown>(eventType: string, data: T): Promise<void> {
    const handler = this.eventHandlers.get(eventType);
    if (handler) {
      try {
        await Promise.resolve(handler(data));
      } catch (error) {
        this.logger.error(
          `Error in agent event handler for '${eventType}': ${error}`
        );
      }
    }
  }
}
