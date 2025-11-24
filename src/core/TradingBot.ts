import {
  type Position,
  type MarketSnapshot,
  processFill,
} from "@junduck/trading-core";
import type {
  Event,
  MarketEvent,
  OrderEvent,
  NewsEvent,
} from "../types/Events.js";
import type { DataProvider } from "../providers/DataProvider.js";
import type { TradeProvider } from "../providers/TradeProvider.js";
import type { NewsProvider } from "../providers/NewsProvider.js";
import {
  Router,
  type MarketRouteOptions,
  type OrderRouteOptions,
  type NewsRouteOptions,
} from "./Router.js";
import { compose, type UniversalAlgorithm } from "./compose.js";
import { orderHandlerMiddleware } from "./OrderHandler.js";
import { Context } from "./Context.js";
import { defaultLogger, type Logger } from "./Logger.js";
import { TradingError } from "./TradingError.js";

/**
 * Event handler for agent events.
 */
export type AgentEventHandler<T = unknown> = (data: T) => void | Promise<void>;

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
  private readonly router: Router;
  private readonly preRoute: UniversalAlgorithm[] = [];
  private readonly logger: Logger;
  private readonly symbols: string[];

  private position: Position;
  private snapshot: MarketSnapshot;
  private running = false;

  // Business logic: Event queues prevent race conditions when events arrive faster than processing.
  // Each provider has its own queue to ensure sequential processing per event source.
  // Events from different sources can process concurrently (market vs order vs news).
  private marketQueue = Promise.resolve();
  private orderQueue = Promise.resolve();
  private newsQueue = Promise.resolve();

  // Event emitter for agent-level events (one handler per event type)
  private readonly eventHandlers: Map<string, AgentEventHandler> = new Map();

  constructor(opts: {
    dataProvider: DataProvider;
    tradeProvider: TradeProvider;
    newsProvider?: NewsProvider;
    symbols?: string[];
    initialSnapshot?: MarketSnapshot;
    logger?: Logger;
  }) {
    this.dataProvider = opts.dataProvider;
    this.tradeProvider = opts.tradeProvider;
    this.newsProvider = opts.newsProvider;
    this.symbols = opts.symbols ?? [];
    this.router = new Router();
    this.logger = opts.logger ?? defaultLogger;

    this.position = {
      cash: 0,
      totalCommission: 0,
      realisedPnL: 0,
      modified: new Date(),
    };
    this.snapshot = opts.initialSnapshot ?? {
      price: new Map(),
      timestamp: new Date(),
    };
  }

  /**
   * Add global middleware applied to all events.
   * Global middleware runs before route-specific middleware.
   *
   * Business logic: Only universal algorithms (working with any event type) can be
   * added globally. Event-specific algorithms must use route methods (market, order, news).
   *
   * @param middleware - Universal algorithm functions to add
   * @returns This agent for chaining
   */
  use(...middleware: UniversalAlgorithm[]): this {
    this.preRoute.push(...middleware);
    return this;
  }

  /**
   * Route market events with optional filtering.
   *
   * @param options - Route options including strategy and filters
   */
  market(options: MarketRouteOptions): this {
    this.router.market(options);
    return this;
  }

  /**
   * Route order events with optional filtering.
   *
   * @param options - Route options including strategy and filters
   */
  order(options: OrderRouteOptions): this {
    this.router.order(options);
    return this;
  }

  /**
   * Route news events with optional filtering.
   *
   * @param options - Route options including strategy and filters
   */
  news(options: NewsRouteOptions): this {
    this.router.news(options);
    return this;
  }

  /**
   * Start the agent event loop.
   * Connects to providers, subscribes, and begins processing events.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error("TradingBot is already running");
    }

    // Phase 1: Connect to providers
    const connections = [
      this.dataProvider.connect(this.handleMarketEvent.bind(this)),
      this.tradeProvider.connect(this.handlePositionEvent.bind(this)),
    ];
    if (this.newsProvider) {
      connections.push(
        this.newsProvider.connect(this.handleNewsEvent.bind(this))
      );
    }
    await Promise.all(connections);

    // Phase 2: Get initial state and configure subscriptions
    this.position = await this.tradeProvider.getPosition();

    const subs = [
      this.tradeProvider.subscribe(),
      this.dataProvider.subscribeSymbols(this.symbols),
    ];
    if (this.newsProvider) {
      subs.push(this.newsProvider.subscribe());
    }
    await Promise.all(subs);

    // Phase 3: Begin event emission
    this.running = true;
    this.emit("started", undefined);

    const begins = [this.dataProvider.begin(), this.tradeProvider.begin()];
    if (this.newsProvider) {
      begins.push(this.newsProvider.begin());
    }
    await Promise.all(begins);

    // TODO: Event loop performance optimization
    // - Add event batching for high-frequency data
    // - Implement event prioritization (fills before market data)
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

    // Phase 1: Stop event emission
    const ends = [this.dataProvider.end(), this.tradeProvider.end()];
    if (this.newsProvider) {
      ends.push(this.newsProvider.end());
    }
    await Promise.all(ends);

    // Phase 2: Unsubscribe
    const unsubs = [
      this.dataProvider.unsubscribeSymbols(this.symbols),
      this.tradeProvider.unsubscribe(),
    ];
    if (this.newsProvider) {
      unsubs.push(this.newsProvider.unsubscribe());
    }
    await Promise.all(unsubs);

    // Phase 3: Disconnect
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
   * Get the current position state.
   */
  getPosition(): Position {
    return this.position;
  }

  /**
   * Get the current market snapshot.
   */
  getSnapshot(): MarketSnapshot {
    return this.snapshot;
  }

  /**
   * Subscribe to agent event (replaces existing handler).
   *
   * @param eventType - Event type ('started', 'stopped', 'event_processed', 'error_handled')
   * @param handler - Event handler function
   */
  on<T = unknown>(eventType: string, handler: AgentEventHandler<T>): this {
    this.eventHandlers.set(eventType, handler as AgentEventHandler);
    return this;
  }

  /**
   * Unsubscribe from agent event.
   *
   * @param eventType - Event type
   */
  off(eventType: string): this {
    this.eventHandlers.delete(eventType);
    return this;
  }

  /**
   * Handle a market event from the data provider.
   * Routes the event to appropriate middleware and executes the chain.
   *
   * Business logic: Events are queued to prevent race conditions.
   * If middleware processes slowly, incoming events wait in queue rather than
   * running concurrently and corrupting shared state (position, snapshot).
   *
   * @param event - Market event to process
   */
  private async handleMarketEvent(event: MarketEvent): Promise<void> {
    // Business logic: Chain this event's processing to the previous event's completion.
    // The queue ensures sequential processing: event N+1 waits for event N to finish.
    this.marketQueue = this.marketQueue.then(async () => {
      this.updateSnapshot(event);
      await this.handleEvent(event);
    });

    await this.marketQueue;
  }

  /**
   * Handle an order event from the trade provider.
   * Routes the event to appropriate middleware and executes the chain.
   *
   * Business logic: Events are queued to prevent race conditions.
   * Order events must process sequentially to maintain position consistency.
   *
   * @param event - Order event to process
   */
  private async handlePositionEvent(event: OrderEvent): Promise<void> {
    // Business logic: Queue order events separately from market events.
    // This allows market and order events to process concurrently while
    // maintaining sequential order within each event type.
    this.orderQueue = this.orderQueue.then(async () => {
      this.updatePosition(event);
      await this.handleEvent(event);
    });

    await this.orderQueue;
  }

  /**
   * Handle a news event from the news provider.
   * Routes the event to appropriate middleware and executes the chain.
   *
   * Business logic: Events are queued to prevent race conditions.
   * News events process sequentially within their own queue.
   *
   * @param event - News event to process
   */
  private async handleNewsEvent(event: NewsEvent): Promise<void> {
    // Business logic: News events have their own queue, independent of market/order queues.
    // This allows concurrent processing across event types while maintaining
    // sequential order within each type.
    this.newsQueue = this.newsQueue.then(async () => {
      await this.handleEvent(event);
    });

    await this.newsQueue;
  }

  /**
   * Handle an event (from data provider or trade provider).
   * Routes the event to appropriate middleware and executes the chain.
   *
   * @param event - Event to process
   */
  private async handleEvent(event: Event): Promise<void> {
    if (!this.running) {
      return;
    }

    const matchedRoutes = this.router.match(event);

    // Execute each route as an atomic strategy with its own context
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

        // Combine global pre-route middleware with this route's algorithms
        // Pre-route middleware runs first, then route algorithms
        const middleware = [...this.preRoute, ...routeAlgorithms];

        const composedMiddleware = compose(middleware);
        await composedMiddleware(routeContext, async () => {});

        // Process pending actions for this route
        // Each route's actions are executed independently
        await orderHandlerMiddleware(routeContext);
      } catch (error) {
        // Enforce TradingError-only contract
        if (!(error instanceof TradingError)) {
          // Contract violation: just rethrow, don't cover up user's mistake
          throw error;
        }

        this.logger.error(error.toJSON());

        // Execute control flow based on error severity
        // Use emergencyCancel() for panic button - sync, never throws
        switch (error.severity) {
          case "recover":
            // Log and continue processing next events
            // Pending is dropped due to end of call chain
            break;

          case "cancel":
            // Fire panic button - synchronous, never throws, best-effort
            this.tradeProvider.emergencyCancel();
            break;

          case "halt":
            // Fire panic button then stop gracefully
            this.tradeProvider.emergencyCancel();
            await this.stop();
            throw error;

          case "fatal":
            // Immediate termination
            await this.stop();
            throw error;
        }

        // Emit event for user-defined error handling
        // User context is limited - they can't interfere with control flow
        await this.emit("error_handled", error);
      }
    }

    await this.emit("event_processed", event);
  }

  /**
   * Update snapshot from market event.
   *
   * @param event - Market event
   */
  private updateSnapshot(event: MarketEvent): void {
    for (const data of event.marketData) {
      this.snapshot.price.set(data.symbol, data.price);
    }
    this.snapshot.timestamp = event.timestamp;
  }

  /**
   * Update position from order event.
   *
   * @param event - Order event
   */
  private updatePosition(event: OrderEvent): void {
    if (!event.state) return;

    const status = event.state.status;
    if (status === "FILLED" || status === "PARTIAL") {
      if (!event.effect) {
        throw new Error(
          `OrderEvent with status '${status}' must include execution data. ` +
            `This indicates a provider bug. Order: ${JSON.stringify(
              event.state
            )}`
        );
      }
      processFill(this.position, event.effect.fill);
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
