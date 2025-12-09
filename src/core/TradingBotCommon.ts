import { type Position } from "@junduck/trading-core/trading";
import type {
  MarketEvent,
  OrderEvent,
  ExternalEvent,
} from "../types/Events.js";
import type { OrderAction } from "./Context.js";
import { defaultLogger, type Logger } from "./Logger.js";
import { Router } from "./Router.js";
import { TradingErrors } from "./TradingError.js";
import {
  type MarketAlgo,
  type OrderAlgo,
  type ExternalAlgo,
  type PreHook,
} from "./compose.js";
import { Snapshot } from "./Snapshot.js";

export function groupOrders(orders: OrderAction[]) {
  const submit = orders
    .filter((action) => action.type == "submit")
    .map((action) => action.order);
  const cancel = orders
    .filter((action) => action.type == "cancel")
    .map((action) => action.orderId);
  const amend = orders
    .filter((action) => action.type == "amend")
    .map((action) => action.update);

  return {
    submit,
    cancel,
    amend,
  };
}

/** Fluent builder for market event routes. */
export class MarketRouteBuilder {
  constructor(
    private readonly router: Router,
    private readonly filter?: (event: MarketEvent) => boolean
  ) {}

  /** Register middleware for this market route. */
  use(...middleware: MarketAlgo[]): void {
    this.router.market({ strategy: middleware, filter: this.filter });
  }
}

/** Fluent builder for market event routes with pre-hook. */
export class MarketRouteBuilderWithPre {
  constructor(
    private readonly router: Router,
    private readonly preHook?: PreHook<MarketEvent>
  ) {}

  /** Register middleware for this market route. */
  use(...middleware: MarketAlgo[]): void {
    this.router.preMarket({ hook: this.preHook, strategy: middleware });
  }
}

/** Fluent builder for order event routes. */
export class OrderRouteBuilder {
  constructor(
    private readonly router: Router,
    private readonly filter?: (event: OrderEvent) => boolean
  ) {}

  /** Register middleware for this order route. */
  use(...middleware: OrderAlgo[]): void {
    this.router.order({ strategy: middleware, filter: this.filter });
  }
}

/** Fluent builder for order event routes with pre-hook. */
export class OrderRouteBuilderWithPre {
  constructor(
    private readonly router: Router,
    private readonly preHook?: PreHook<OrderEvent>
  ) {}

  /** Register middleware for this order route. */
  use(...middleware: OrderAlgo[]): void {
    this.router.preOrder({ hook: this.preHook, strategy: middleware });
  }
}

/** Fluent builder for external event routes. */
export class ExternalRouteBuilder {
  constructor(
    private readonly router: Router,
    private readonly filter?: (event: ExternalEvent) => boolean
  ) {}

  /** Register middleware for this external route. */
  use(...middleware: ExternalAlgo[]): void {
    this.router.external({ strategy: middleware, filter: this.filter });
  }
}

/** Fluent builder for external event routes with pre-hook. */
export class ExternalRouteBuilderWithPre {
  constructor(
    private readonly router: Router,
    private readonly preHook?: PreHook<ExternalEvent>
  ) {}

  /** Register middleware for this external route. */
  use(...middleware: ExternalAlgo[]): void {
    this.router.preExternal({ hook: this.preHook, strategy: middleware });
  }
}

export class EventOrchestrator {
  protected readonly router = new Router();
  protected readonly logger: Logger;

  protected readonly symbols: string[];
  protected snapshot: Snapshot = new Snapshot();
  protected running = false;

  constructor(opts: { logger?: Logger; symbols?: string[] }) {
    this.symbols = opts.symbols ?? [];
    this.logger = opts.logger ?? defaultLogger;
  }

  /** Get current position (readonly clone) */
  getPosition(): Readonly<Position> {
    return this.snapshot.position;
  }

  /** Get current snapshot */
  getSnapshot(): Readonly<Snapshot> {
    return this.snapshot;
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
    switch (eventType) {
      case "market":
        return new MarketRouteBuilder(
          this.router,
          filter as ((event: MarketEvent) => boolean) | undefined
        );
      case "order":
        return new OrderRouteBuilder(
          this.router,
          filter as ((event: OrderEvent) => boolean) | undefined
        );
      case "external":
        return new ExternalRouteBuilder(
          this.router,
          filter as ((event: ExternalEvent) => boolean) | undefined
        );
      default:
        throw TradingErrors.system({
          message: `Unsupported event type ${eventType}`,
        });
    }
  }

  /**
   * Register common route for market events with optional pre-hook.
   * @example bot.pre("market").use(strategy);
   * @example bot.pre("market", async (ctx, next) => { await loadData(ctx); next(); }).use(strategy);
   */
  pre(
    eventType: "market",
    preHook?: PreHook<MarketEvent>
  ): MarketRouteBuilderWithPre;

  /**
   * Register common route for order events with optional pre-hook.
   * @example bot.pre("order").use(logger);
   * @example bot.pre("order", async (ctx, next) => { await audit(ctx); next(); }).use(logger);
   */
  pre(
    eventType: "order",
    preHook?: PreHook<OrderEvent>
  ): OrderRouteBuilderWithPre;

  /**
   * Register common route for external events with optional pre-hook.
   * @example bot.pre("external").use(handler);
   * @example bot.pre("external", async (ctx, next) => { await fetch(ctx); next(); }).use(handler);
   */
  pre(
    eventType: "external",
    preHook?: PreHook<ExternalEvent>
  ): ExternalRouteBuilderWithPre;

  pre(
    eventType: "market" | "order" | "external",
    preHook?:
      | PreHook<MarketEvent>
      | PreHook<OrderEvent>
      | PreHook<ExternalEvent>
  ):
    | MarketRouteBuilderWithPre
    | OrderRouteBuilderWithPre
    | ExternalRouteBuilderWithPre {
    switch (eventType) {
      case "market":
        return new MarketRouteBuilderWithPre(
          this.router,
          preHook as PreHook<MarketEvent> | undefined
        );
      case "order":
        return new OrderRouteBuilderWithPre(
          this.router,
          preHook as PreHook<OrderEvent> | undefined
        );
      case "external":
        return new ExternalRouteBuilderWithPre(
          this.router,
          preHook as PreHook<ExternalEvent> | undefined
        );
      default:
        throw TradingErrors.system({
          message: `Unsupported event type ${eventType}`,
        });
    }
  }
}
