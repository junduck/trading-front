import type {
  Event,
  MarketEvent,
  OrderEvent,
  NewsEvent,
} from "../types/Events.js";
import type { Strategy } from "./compose.js";

/**
 * Route handler with optional filter.
 */
export interface RouteHandler<T extends Event> {
  strategy: Strategy<T>;
  filter?: (event: T) => boolean;
}

export class Router {
  private marketRoutes: RouteHandler<MarketEvent>[] = [];
  private orderRoutes: RouteHandler<OrderEvent>[] = [];
  private newsRoutes: RouteHandler<NewsEvent>[] = [];

  /**
   * Route market events with optional filtering.
   *
   */
  market(handler: RouteHandler<MarketEvent>): this {
    this.marketRoutes.push(handler);
    return this;
  }

  /**
   * Route order events with optional filtering.
   *
   */
  order(handler: RouteHandler<OrderEvent>): this {
    this.orderRoutes.push(handler);
    return this;
  }

  /**
   * Route news events with optional filtering.
   *
   */
  news(handler: RouteHandler<NewsEvent>): this {
    this.newsRoutes.push(handler);
    return this;
  }

  /**
   * Find all routes that match the given event using tag dispatch.
   * Each route is a stack of algorithms that should be executed as an atomic strategy.
   *
   * Business logic: Type assertions are safe here because the router guarantees
   * that market strategies only match MarketEvents, order strategies only match OrderEvents, etc.
   * The tag dispatch ensures event/strategy compatibility at runtime.
   *
   * @param event - Event to match against routes
   * @returns Array of matching routes, where each route is an array of algorithms
   */
  match(event: Event): Strategy[] {
    const matches: Strategy[] = [];

    switch (event.type) {
      case "market":
        for (const route of this.marketRoutes) {
          if (!route.filter || route.filter(event)) {
            matches.push(route.strategy as Strategy);
          }
        }
        break;

      case "order":
        for (const route of this.orderRoutes) {
          if (!route.filter || route.filter(event)) {
            matches.push(route.strategy as Strategy);
          }
        }
        break;

      case "news":
        for (const route of this.newsRoutes) {
          if (!route.filter || route.filter(event)) {
            matches.push(route.strategy as Strategy);
          }
        }
        break;
    }

    return matches;
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
