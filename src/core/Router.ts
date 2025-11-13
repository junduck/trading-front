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
   * Route market events with optional symbol(s) or custom filter.
   *
   * @param filter - Symbol string, symbol array, or filter function (undefined = all events)
   * @param strategy - Stack of algorithm executed as strategy
   */
  market(
    filter: string | string[] | MarketFilter | undefined,
    ...strategy: Strategy<MarketEvent>
  ): this {
    const routeHandler: RouteHandler<MarketEvent> = { strategy };

    if (filter !== undefined) {
      if (typeof filter === "string") {
        const symbol = filter;
        routeHandler.filter = (event: MarketEvent) =>
          event.marketData.some((item) => event.getSymbol(item) === symbol);
      } else if (Array.isArray(filter)) {
        const symbols = new Set(filter);
        routeHandler.filter = (event: MarketEvent) =>
          event.marketData.some((item) => symbols.has(event.getSymbol(item)));
      } else {
        routeHandler.filter = filter;
      }
    }

    this.marketRoutes.push(routeHandler);
    return this;
  }

  /**
   * Route order events with optional status filter or custom filter function.
   *
   * @param filter - OrderStatus, status array, or filter function (undefined = all events)
   * @param strategy - Stack of algorithm executed as strategy
   */
  order(
    filter: OrderStatus | OrderStatus[] | OrderFilter | undefined,
    ...strategy: Strategy<OrderEvent>
  ): this {
    const routeHandler: RouteHandler<OrderEvent> = { strategy };

    if (filter !== undefined) {
      if (typeof filter === "string") {
        const status = filter;
        routeHandler.filter = (event: OrderEvent) =>
          event.state?.status === status;
      } else if (Array.isArray(filter)) {
        const statuses = new Set(filter);
        routeHandler.filter = (event: OrderEvent) =>
          event.state?.status !== undefined && statuses.has(event.state.status);
      } else {
        routeHandler.filter = filter;
      }
    }

    this.orderRoutes.push(routeHandler);
    return this;
  }

  /**
   * Route news events with optional symbol(s) or custom filter.
   *
   * @param filter - Symbol string, symbol array, or filter function (undefined = all events)
   * @param strategy - Stack of algorithm executed as strategy
   */
  news(
    filter: string | string[] | NewsFilter | undefined,
    ...strategy: Strategy<NewsEvent>
  ): this {
    const routeHandler: RouteHandler<NewsEvent> = { strategy };

    if (filter !== undefined) {
      if (typeof filter === "string") {
        const symbol = filter;
        routeHandler.filter = (event: NewsEvent) =>
          event.newsData.some((item) => event.getSymbols(item).includes(symbol));
      } else if (Array.isArray(filter)) {
        const symbols = new Set(filter);
        routeHandler.filter = (event: NewsEvent) =>
          event.newsData.some((item) =>
            event.getSymbols(item).some((s) => symbols.has(s))
          );
      } else {
        routeHandler.filter = filter;
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
    return this.marketRoutes.length + this.orderRoutes.length + this.newsRoutes.length;
  }
}
