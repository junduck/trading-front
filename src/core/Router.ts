import type {
  Event,
  MarketEvent,
  OrderEvent,
  ExternalEvent,
} from "../types/Events.js";
import type { PreHook, Strategy } from "./compose.js";

/**
 * Route handler with optional filter.
 */
export interface RouteHandler<T extends Event> {
  strategy: Strategy<T>;
  filter?: ((event: T) => boolean) | undefined;
}

/**
 * Pre-route handler with optional hook executed before strategy.
 */
export interface PreRouteHandler<T extends Event> {
  hook?: PreHook<T> | undefined;
  strategy: Strategy<T>;
}

export class Router {
  private preMarketRoute?: PreRouteHandler<MarketEvent>;
  private preOrderRoute?: PreRouteHandler<OrderEvent>;
  private preExternalRoute?: PreRouteHandler<ExternalEvent>;
  private marketRoutes: RouteHandler<MarketEvent>[] = [];
  private orderRoutes: RouteHandler<OrderEvent>[] = [];
  private externalRoutes: RouteHandler<ExternalEvent>[] = [];

  /** Register pre-route handler for market events. */
  preMarket(handler: PreRouteHandler<MarketEvent>): this {
    this.preMarketRoute = handler;
    return this;
  }

  /** Register pre-route handler for order events. */
  preOrder(handler: PreRouteHandler<OrderEvent>): this {
    this.preOrderRoute = handler;
    return this;
  }

  /** Register pre-route handler for external events. */
  preExternal(handler: PreRouteHandler<ExternalEvent>): this {
    this.preExternalRoute = handler;
    return this;
  }

  /**
   * Find pre-route handler for the given event type.
   * Business logic: Pre-route runs on main context before matched routes.
   * State set in pre-route is inherited by cloned contexts in matched routes.
   */
  matchPre(event: Event): PreRouteHandler<Event> | undefined {
    switch (event.type) {
      case "market":
        return this.preMarketRoute as PreRouteHandler<Event>;
      case "order":
        return this.preOrderRoute as PreRouteHandler<Event>;
      case "external":
        return this.preExternalRoute as PreRouteHandler<Event>;
    }
  }

  /** Register market event route with optional filter. */
  market(handler: RouteHandler<MarketEvent>): this {
    this.marketRoutes.push(handler);
    return this;
  }

  /** Register order event route with optional filter. */
  order(handler: RouteHandler<OrderEvent>): this {
    this.orderRoutes.push(handler);
    return this;
  }

  /** Register external event route with optional filter. */
  external(handler: RouteHandler<ExternalEvent>): this {
    this.externalRoutes.push(handler);
    return this;
  }

  /**
   * Find all routes that match the given event using tag dispatch.
   * Business logic: Each matched route runs with cloned context for isolated execution.
   * All matching routes execute (not just first match).
   *
   * @param event - Event to match against routes
   * @returns Array of matching strategies
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

      case "external":
        for (const route of this.externalRoutes) {
          if (!route.filter || route.filter(event)) {
            matches.push(route.strategy as Strategy);
          }
        }
        break;
    }

    return matches;
  }

  /** Get total number of routes. */
  get size(): number {
    return (
      this.marketRoutes.length +
      this.orderRoutes.length +
      this.externalRoutes.length
    );
  }

  /** Check if any async pre-hooks are registered. */
  hasPreHooks(): boolean {
    return !!(
      this.preMarketRoute?.hook ||
      this.preOrderRoute?.hook ||
      this.preExternalRoute?.hook
    );
  }
}
