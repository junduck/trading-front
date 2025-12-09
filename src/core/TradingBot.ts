import { type MarketQuote } from "@junduck/trading-core/trading";
import type {
  Event,
  MarketEvent,
  OrderEvent,
  ExternalEvent,
  BaseEvent,
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
      this.snapshot.updateQuotes(opts.initialQuotes);
    }
  }

  /** Start event loop: connect, subscribe, begin processing. */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error("TradingBot is already running");
    }

    const connections = [
      this.providers.trade.connect(this.onEvent.bind(this)),
      this.providers.data.connect(this.onEvent.bind(this)),
      ...this.providers.external.map((provider) =>
        provider.connect(this.onEvent.bind(this))
      ),
    ];
    await Promise.all(connections);

    this.snapshot.position = await this.providers.trade.getPosition();

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

  private async onEvent(event: BaseEvent) {
    try {
      switch (event.type) {
        case "market":
          const e = event as MarketEvent;
          this.snapshot.updateQuotes(e.marketData);
          await this.mainLoop(e);
          break;
        case "order":
          const o = event as OrderEvent;
          this.snapshot.updatePosition(o.updated, o.fill);
          await this.mainLoop(o);
          break;
        case "external":
          const x = event as ExternalEvent;
          await this.mainLoop(x);
          break;
      }
    } catch (error) {
      await this.handleError(error);
    }
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

    for (const p of pending) {
      if (p.type === "submit" || p.type === "amend") {
        this.snapshot.lastSubmit = event.timestamp;
        break;
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
