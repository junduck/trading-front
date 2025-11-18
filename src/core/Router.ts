import type {
  Event,
  MarketEvent,
  OrderEvent,
  NewsEvent,
} from "../types/Events.js";
import type { OrderStatus } from "@junduck/trading-core";
import type { Strategy } from "./Algorithm.js";

/**
 * Filter function for market events.
 */
export type MarketFilter = (event: MarketEvent) => boolean;

/**
 * Filter function for order events.
 */
export type OrderFilter = (state?: OrderEvent) => boolean;

/**
 * Filter function for news events.
 */
export type NewsFilter = (event: NewsEvent) => boolean;

/**
 * Options for filtering market events.
 */
export interface MarketRouteOptions {
  /** Single symbol to filter */
  symbol?: string;
  /** Multiple symbols to filter */
  symbols?: string[];
  /** Custom filter function */
  filter?: MarketFilter;
}

/**
 * Options for filtering order events.
 */
export interface OrderRouteOptions {
  /** Single status to filter */
  status?: OrderStatus;
  /** Multiple statuses to filter */
  statuses?: OrderStatus[];
  /** Custom filter function */
  filter?: OrderFilter;
}

/**
 * Options for filtering news events.
 */
export interface NewsRouteOptions {
  /** Custom filter function */
  filter?: NewsFilter;
}

/**
 * Route handler with optional filter.
 */
interface RouteHandler<T extends Event> {
  filter?: (event: T) => boolean;
  strategy: Strategy<T>;
}

/**
 * High-performance router using tag dispatch.
 * Routes events to algorithm based on event type, then applies filters.
 */
export class Router {
  private marketRoutes: RouteHandler<MarketEvent>[] = [];
  private orderRoutes: RouteHandler<OrderEvent>[] = [];
  private newsRoutes: RouteHandler<NewsEvent>[] = [];

  /**
   * Route market events with optional filtering.
   *
   * @param options - Filter options
   * @param strategy - Algorithm stack
   */
  market(options: MarketRouteOptions, ...strategy: Strategy<MarketEvent>): this;
  /**
   * Route market events without filtering.
   *
   * @param strategy - Algorithm stack
   */
  market(...strategy: Strategy<MarketEvent>): this;
  market(
    optionsOrFirstAlgo?: MarketRouteOptions | Strategy<MarketEvent>[0],
    ...restStrategy: Strategy<MarketEvent>
  ): this {
    let routeHandler: RouteHandler<MarketEvent>;

    // Detect if first arg is options object or algorithm function
    if (typeof optionsOrFirstAlgo === "function") {
      // First arg is an algorithm function
      routeHandler = {
        strategy: [optionsOrFirstAlgo, ...restStrategy] as Strategy<MarketEvent>,
      };
    } else {
      // First arg is options object (or undefined)
      const options = (optionsOrFirstAlgo as MarketRouteOptions) ?? {};
      routeHandler = { strategy: restStrategy };

      if (options.filter !== undefined) {
        routeHandler.filter = options.filter;
      } else if (options.symbol !== undefined) {
        const symbol = options.symbol;
        routeHandler.filter = (event: MarketEvent) =>
          event.marketData.some((item) => item.symbol === symbol);
      } else if (options.symbols !== undefined) {
        const symbols = new Set(options.symbols);
        routeHandler.filter = (event: MarketEvent) =>
          event.marketData.some((item) => symbols.has(item.symbol));
      }
    }

    this.marketRoutes.push(routeHandler);
    return this;
  }

  /**
   * Route order events with optional filtering.
   *
   * @param options - Filter options
   * @param strategy - Algorithm stack
   */
  order(options: OrderRouteOptions, ...strategy: Strategy<OrderEvent>): this;
  /**
   * Route order events without filtering.
   *
   * @param strategy - Algorithm stack
   */
  order(...strategy: Strategy<OrderEvent>): this;
  order(
    optionsOrFirstAlgo?: OrderRouteOptions | Strategy<OrderEvent>[0],
    ...restStrategy: Strategy<OrderEvent>
  ): this {
    let routeHandler: RouteHandler<OrderEvent>;

    // Detect if first arg is options object or algorithm function
    if (typeof optionsOrFirstAlgo === "function") {
      // First arg is an algorithm function
      routeHandler = {
        strategy: [optionsOrFirstAlgo, ...restStrategy] as Strategy<OrderEvent>,
      };
    } else {
      // First arg is options object (or undefined)
      const options = (optionsOrFirstAlgo as OrderRouteOptions) ?? {};
      routeHandler = { strategy: restStrategy };

      if (options.filter !== undefined) {
        routeHandler.filter = options.filter;
      } else if (options.status !== undefined) {
        const status = options.status;
        routeHandler.filter = (event: OrderEvent) =>
          event.state?.status === status;
      } else if (options.statuses !== undefined) {
        const statuses = new Set(options.statuses);
        routeHandler.filter = (event: OrderEvent) =>
          event.state?.status !== undefined && statuses.has(event.state.status);
      }
    }

    this.orderRoutes.push(routeHandler);
    return this;
  }

  /**
   * Route news events with optional filtering.
   *
   * @param options - Filter options
   * @param strategy - Algorithm stack
   */
  news(options: NewsRouteOptions, ...strategy: Strategy<NewsEvent>): this;
  /**
   * Route news events without filtering.
   *
   * @param strategy - Algorithm stack
   */
  news(...strategy: Strategy<NewsEvent>): this;
  news(
    optionsOrFirstAlgo?: NewsRouteOptions | Strategy<NewsEvent>[0],
    ...restStrategy: Strategy<NewsEvent>
  ): this {
    let routeHandler: RouteHandler<NewsEvent>;

    // Detect if first arg is options object or algorithm function
    if (typeof optionsOrFirstAlgo === "function") {
      // First arg is an algorithm function
      routeHandler = {
        strategy: [optionsOrFirstAlgo, ...restStrategy] as Strategy<NewsEvent>,
      };
    } else {
      // First arg is options object (or undefined)
      const options = (optionsOrFirstAlgo as NewsRouteOptions) ?? {};
      routeHandler = { strategy: restStrategy };

      if (options.filter !== undefined) {
        routeHandler.filter = options.filter;
      }
    }

    this.newsRoutes.push(routeHandler);
    return this;
  }

  /**
   * Find all routes that match the given event using tag dispatch.
   * Each route is a stack of algorithms that should be executed as an atomic strategy.
   *
   * @param event - Event to match against routes
   * @returns Array of matching routes, where each route is an array of algorithms
   */
  match(event: Event): Strategy<any>[] {
    const matches: Strategy<any>[] = [];

    // Tag dispatch based on event.type
    switch (event.type) {
      case "market":
        for (const route of this.marketRoutes) {
          if (!route.filter || route.filter(event)) {
            matches.push(route.strategy);
          }
        }
        break;

      case "order":
        for (const route of this.orderRoutes) {
          if (!route.filter || route.filter(event)) {
            matches.push(route.strategy);
          }
        }
        break;

      case "news":
        for (const route of this.newsRoutes) {
          if (!route.filter || route.filter(event)) {
            matches.push(route.strategy);
          }
        }
        break;
    }

    return matches;
  }

  /**
   * Clear all routes.
   */
  clear(): void {
    this.marketRoutes = [];
    this.orderRoutes = [];
    this.newsRoutes = [];
  }

  /**
   * Get total number of routes.
   */
  get size(): number {
    return (
      this.marketRoutes.length +
      this.orderRoutes.length +
      this.newsRoutes.length
    );
  }
}
