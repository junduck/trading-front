import type {
  Event,
  MarketEvent,
  OrderEvent,
  NewsEvent,
} from "../types/Events.js";
import type { OrderStatus } from "@junduck/trading-core";
import type { Strategy } from "./compose.js";

/**
 * Options for routing market events.
 */
export interface MarketRouteOptions {
  /** Strategy to execute */
  strategy: Strategy;
  /** Single symbol to filter */
  symbol?: string;
  /** Multiple symbols to filter */
  symbols?: string[];
  /** Custom filter function */
  filter?: (event: MarketEvent) => boolean;
}

/**
 * Options for routing order events.
 */
export interface OrderRouteOptions {
  /** Strategy to execute */
  strategy: Strategy;
  /** Single status to filter */
  status?: OrderStatus;
  /** Multiple statuses to filter */
  statuses?: OrderStatus[];
  /** Custom filter function */
  filter?: (event?: OrderEvent) => boolean;
}

/**
 * Options for routing news events.
 */
export interface NewsRouteOptions {
  /** Strategy to execute */
  strategy: Strategy;
  /** Custom filter function */
  filter?: (event: NewsEvent) => boolean;
}

/**
 * Route handler with optional filter.
 */
interface RouteHandler<T extends Event> {
  filter?: (event: T) => boolean;
  strategy: Strategy;
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
   * @param options - Route options including strategy and filters
   */
  market(options: MarketRouteOptions): this {
    const routeHandler: RouteHandler<MarketEvent> = {
      strategy: options.strategy,
    };

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

    this.marketRoutes.push(routeHandler);
    return this;
  }

  /**
   * Route order events with optional filtering.
   *
   * @param options - Route options including strategy and filters
   */
  order(options: OrderRouteOptions): this {
    const routeHandler: RouteHandler<OrderEvent> = {
      strategy: options.strategy,
    };

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

    this.orderRoutes.push(routeHandler);
    return this;
  }

  /**
   * Route news events with optional filtering.
   *
   * @param options - Route options including strategy and filters
   */
  news(options: NewsRouteOptions): this {
    const routeHandler: RouteHandler<NewsEvent> = {
      strategy: options.strategy,
    };

    if (options.filter !== undefined) {
      routeHandler.filter = options.filter;
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
  match(event: Event): Strategy[] {
    const matches: Strategy[] = [];

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
