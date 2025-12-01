import { type MarketQuote, processFill } from "@junduck/trading-core/trading";
import type {
  Event,
  MarketEvent,
  OrderEvent,
  ExternalEvent,
} from "../types/Events.js";
import type { BaseProviderSync } from "../providers/BaseProviderSync.js";
import type { DataProviderSync } from "../providers/DataProviderSync.js";
import type { TradeProviderSync } from "../providers/TradeProviderSync.js";
import type { ExternalProviderSync } from "../providers/ExternalProviderSync.js";
import { compose } from "./compose.js";
import { Context, type OrderAction, type ProviderContext } from "./Context.js";
import { type Logger } from "./Logger.js";
import { TradingError, TradingErrors } from "./TradingError.js";
import { EventOrchestrator, groupOrders } from "./TradingBotCommon.js";

import { PriorityQueue } from "@junduck/trading-core/containers";

/**
 * Trading bot with sync providers for backtesting.
 * Merges events from multiple providers in chronological order.
 * Middleware receives {position, snapshot} and collects pendingActions.
 * After middleware chain completes, pendingActions are executed.
 */
export class TradingBotSync extends EventOrchestrator {
  private readonly providers: ProviderContext & { type: "sync" };

  constructor(opts: {
    dataProvider: DataProviderSync;
    tradeProvider: TradeProviderSync;
    externalProviders?: ExternalProviderSync[];
    symbols?: string[];
    initialQuotes?: MarketQuote[];
    logger?: Logger;
  }) {
    super(opts);

    this.providers = {
      type: "sync",
      data: opts.dataProvider,
      trade: opts.tradeProvider,
      external: opts.externalProviders ?? [],
    };

    if (opts.initialQuotes) {
      this.snapshot.updateQuotes(opts.initialQuotes, this.position);
    }
  }

  /** Start event loop: connect, subscribe, begin processing. */
  start() {
    // Validate that no async pre-hooks were registered
    if (this.router.hasPreHooks()) {
      throw TradingErrors.system({
        message:
          "TradingBotSync does not support async pre-hooks. Use TradingBot for async pre-hook support.",
        severity: "fatal",
        category: "logic",
      });
    }

    // bind callback
    this.providers.trade.connect(this.onOrderEvent.bind(this));
    this.providers.data.connect(this.onMarketEvent.bind(this));
    for (const ext of this.providers.external) {
      ext.connect(this.onExternalEvent.bind(this));
    }

    // load sync data
    this.providers.trade.subscribe(this.symbols);
    this.providers.data.subscribe(this.symbols);
    for (const ext of this.providers.external) {
      ext.subscribe(this.symbols);
    }

    this.position = this.providers.trade.getPosition();

    // we don't have begin here, sync bot itself is the event orchestrator

    this.running = true;

    // Business logic: Merge events from multiple providers in chronological order
    const eventQueue = new PriorityQueue<{ e: Event; i: number }>(
      (a, b) => a.e.timestamp.getTime() - b.e.timestamp.getTime()
    );

    const srcQueue: Array<BaseProviderSync<Event>> = [];
    srcQueue.push(this.providers.data as BaseProviderSync<Event>);
    srcQueue.push(this.providers.trade as BaseProviderSync<Event>);
    for (const ext of this.providers.external) {
      srcQueue.push(ext as BaseProviderSync<Event>);
    }

    for (let i = 0; i < srcQueue.length; i++) {
      const e = srcQueue[i]!.next();
      if (e !== undefined) {
        eventQueue.push({ e, i });
      }
    }

    while (this.running && eventQueue.size() > 0) {
      const curr = eventQueue.pop()!;
      const src = srcQueue[curr.i]!;

      src.emit(curr.e); // this actually call bound handler

      const e = src.next();
      if (e !== undefined) {
        eventQueue.push({ e, i: curr.i });
      }
    }

    // finished
    this.stop();
  }

  stop() {
    this.providers.trade.disconnect();
    this.providers.data.disconnect();
    for (const ext of this.providers.external) {
      ext.disconnect();
    }
    this.running = false;
  }

  private onMarketEvent(event: MarketEvent) {
    this.snapshot.updateQuotes(event.marketData, this.position);
    this.mainLoop(event);
  }

  private onOrderEvent(event: OrderEvent) {
    if (event.fill.length > 0) {
      const symbols: string[] = [];
      for (const fill of event.fill) {
        processFill(this.position, fill);
        symbols.push(fill.symbol);
      }
      this.snapshot.updatePosition(symbols, this.position);
    }
    this.snapshot.updateOpen(event);
    this.mainLoop(event);
  }

  private onExternalEvent(event: ExternalEvent) {
    this.mainLoop(event);
  }

  private mainLoop(event: Event) {
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
        const fn = compose(matchedPreRoute.strategy);
        fn(ctx, () => {});
      } catch (error) {
        this.handleError(error);
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
        this.handleError(error);
      }
    }

    // TODO: if pending.length await this.runRiskManagement(pending)

    this.processOrders(pending);
  }

  private handleError(error: unknown) {
    if (!(error instanceof TradingError)) {
      this.stop();
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
        this.stop();
        throw error;
      case "fatal":
        // Stop immediately
        this.stop();
        throw error;
    }
  }

  private processOrders(pending: OrderAction[]) {
    if (pending.length === 0) {
      return;
    }

    const hasCancelAll = pending.some((action) => action.type === "cancel_all");
    if (hasCancelAll) {
      this.providers.trade.cancelAllOrders();
      return;
    }

    const { submit, cancel, amend } = groupOrders(pending);

    if (submit.length) {
      this.providers.trade.submitOrder(submit);
    }
    if (cancel.length) {
      this.providers.trade.cancelOrder(cancel);
    }
    if (amend.length) {
      this.providers.trade.amendOrder(amend);
    }
  }
}
