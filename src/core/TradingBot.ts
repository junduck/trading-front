import { type MarketQuote, processFill } from "@junduck/trading-core/trading";
import type {
  Event,
  MarketEvent,
  OrderEvent,
  ExternalEvent,
} from "../types/Events.js";
import type { DataProvider } from "../providers/DataProvider.js";
import type { TradeProvider } from "../providers/TradeProvider.js";
import type { ExternalProvider } from "../providers/ExternalProvider.js";
import { compose, composeWithPre } from "./compose.js";
import { Context, type OrderAction, type ProviderContext } from "./Context.js";
import { type Logger } from "./Logger.js";
import { TradingError } from "./TradingError.js";
import { EventOrchestrator, groupOrders } from "./TradingBotCommon.js";

/**
 * Trading bot with async providers and async pre-hook support.
 * Middleware receives {position, snapshot} and collects pendingActions.
 * After middleware chain completes, pendingActions are executed.
 */
export class TradingBot extends EventOrchestrator {
  private readonly providers: ProviderContext & { type: "async" };

  private queue = Promise.resolve();

  constructor(opts: {
    dataProvider: DataProvider;
    tradeProvider: TradeProvider;
    externalProviders?: ExternalProvider[];
    symbols?: string[];
    initialQuotes?: MarketQuote[];
    logger?: Logger;
  }) {
    super(opts);

    this.providers = {
      type: "async",
      data: opts.dataProvider,
      trade: opts.tradeProvider,
      external: opts.externalProviders ?? [],
    };

    if (opts.initialQuotes) {
      this.snapshot.updateQuotes(opts.initialQuotes, this.position);
    }
  }

  /** Start event loop: connect, subscribe, begin processing. */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error("TradingBot is already running");
    }

    const connections = [
      this.providers.trade.connect(this.onOrderEvent.bind(this)),
      this.providers.data.connect(this.onMarketEvent.bind(this)),
      ...this.providers.external.map((provider) =>
        provider.connect(this.onExternalEvent.bind(this))
      ),
    ];
    await Promise.all(connections);

    this.position = await this.providers.trade.getPosition();

    const subs = [
      this.providers.trade.subscribe(),
      this.providers.data.subscribeSymbols(this.symbols),
      ...this.providers.external.map((provider) => provider.subscribe()),
    ];
    await Promise.all(subs);

    this.running = true;

    const begins = [
      this.providers.trade.begin(),
      this.providers.data.begin(),
      ...this.providers.external.map((provider) => provider.begin()),
    ];
    await Promise.all(begins);
  }

  /** Stop event loop: end processing, unsubscribe, disconnect. */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Business logic: if stop() throws this will result in immediate stack unwinding.
    // TradingError logic is not applicable here.

    this.running = false;

    const ends = [
      this.providers.data.end(),
      this.providers.trade.end(),
      ...this.providers.external.map((provider) => provider.end()),
    ];
    await Promise.all(ends);

    const unsubs = [
      this.providers.data.unsubscribeSymbols(this.symbols),
      this.providers.trade.unsubscribe(),
      ...this.providers.external.map((provider) => provider.unsubscribe()),
    ];
    await Promise.all(unsubs);

    const disconnections = [
      this.providers.data.disconnect(),
      this.providers.trade.disconnect(),
      ...this.providers.external.map((provider) => provider.disconnect()),
    ];
    await Promise.all(disconnections);
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Handle market data events.
   * Business logic: Updates snapshot with new quotes before middleware execution.
   */
  private async onMarketEvent(event: MarketEvent) {
    this.queue = this.queue
      .then(async () => {
        this.snapshot.updateQuotes(event.marketData, this.position);
        await this.mainLoop(event);
      })
      .catch((error) => this.handleError(error));
    await this.queue;
  }

  /**
   * Handle order fill events.
   * Business logic: Processes fills to update position and snapshot before middleware execution.
   */
  private async onOrderEvent(event: OrderEvent) {
    this.queue = this.queue
      .then(async () => {
        if (event.fill.length > 0) {
          const symbols = new Set<string>();
          for (const fill of event.fill) {
            processFill(this.position, fill);
            symbols.add(fill.symbol);
          }
          this.snapshot.updatePosition(Array.from(symbols), this.position);
        }
        await this.mainLoop(event);
      })
      .catch((error) => this.handleError(error));
    await this.queue;
  }

  /**
   * Handle external signal events.
   * Business logic: External events trigger middleware without modifying position/snapshot.
   */
  private async onExternalEvent(event: ExternalEvent) {
    this.queue = this.queue
      .then(async () => {
        await this.mainLoop(event);
      })
      .catch((error) => this.handleError(error)); // Could throw: processOrders
    await this.queue;
  }

  /**
   * Main event processing loop.
   *
   * Business logic - execution model:
   * 1. Pre-route (if exists): async pre-hook -> sync middleware chain
   * 2. Matched routes: each runs sync middleware chain with forked context
   * 3. Middlewares are synchronous - position/snapshot frozen during execution
   * 4. All pending actions processed after middleware execution completes
   */
  private async mainLoop(event: Event) {
    if (!this.running) {
      return;
    }

    const ctx = new Context({
      event,
      position: this.position,
      snapshot: this.snapshot,
      providers: this.providers,
      logger: this.logger,
    });

    // Execute pre-route (common middleware) if registered
    const matchedPreRoute = this.router.matchPre(event);
    if (matchedPreRoute != undefined) {
      try {
        const hook = matchedPreRoute.hook;
        if (hook !== undefined) {
          const async_fn = composeWithPre(hook, matchedPreRoute.strategy);
          await async_fn(ctx, () => {});
        } else {
          const fn = compose(matchedPreRoute.strategy);
          fn(ctx, () => {});
        }
      } catch (error) {
        await this.handleError(error);
      }
    }
    let pending = ctx.getPending();

    // Execute matched routes with forked context for isolated execution
    const matchedRoutes = this.router.match(event);
    for (const strat of matchedRoutes) {
      try {
        const fn = compose(strat);
        const local = ctx.clone();
        fn(local, () => {});
        pending = [...pending, ...local.getPending()];
      } catch (error) {
        await this.handleError(error);
      }
    }

    // TODO: if pending.length await this.runRiskManagement(pending)

    await this.processOrders(pending);
  }

  private async handleError(error: unknown) {
    if (!(error instanceof TradingError)) {
      await this.stop();
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
        this.providers.trade.emergencyCancel();
        break;
      case "halt":
        // Cancel orders and stop bot
        this.providers.trade.emergencyCancel();
        await this.stop();
        throw error;
      case "fatal":
        // Stop immediately
        await this.stop();
        throw error;
    }
  }

  private async processOrders(pending: OrderAction[]): Promise<void> {
    if (pending.length === 0) {
      return;
    }

    const hasCancelAll = pending.some((action) => action.type === "cancel_all");
    if (hasCancelAll) {
      await this.providers.trade.cancelAllOrders();
      return;
    }

    const { submit, cancel, amend } = groupOrders(pending);

    if (submit.length) {
      await this.providers.trade.submitOrder(submit);
    }
    if (cancel.length) {
      await this.providers.trade.cancelOrder(cancel);
    }
    if (amend.length) {
      await this.providers.trade.amendOrder(amend);
    }
  }
}
