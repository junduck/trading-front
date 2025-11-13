import type { Fill, OrderState } from "@junduck/trading-core";
import type { LiveNews } from "./News.js";

/**
 * Base event with main tag dispatch type.
 */
export interface BaseEvent {
  type: "market" | "news" | "order";
  timestamp: Date;
}

/**
 * Market event with generic data array.
 * Uses getPrice and getSymbol getters to abstract data access.
 */
export interface MarketEvent<T = unknown> extends BaseEvent {
  type: "market";
  getPrice: (item: T) => number;
  getSymbol: (item: T) => string;
  marketData: T[];
}

export interface NewsEvent extends BaseEvent {
  type: "news";
  newsData: LiveNews[];
}

/**
 * Order event with optional state and execution.
 */
export interface OrderEvent extends BaseEvent {
  type: "order";
  state?: OrderState;
  execution?: Fill;
}

/**
 * Union type for all events in the system.
 */
export type Event = MarketEvent | NewsEvent | OrderEvent;

/**
 * Type guard to check if an event is a market event.
 */
export function isMarketEvent(event: Event): event is MarketEvent {
  return event.type === "market";
}

export function isNewsEvent(event: Event): event is NewsEvent {
  return event.type === "news";
}

/**
 * Type guard to check if an event is an order event.
 */
export function isOrderEvent(event: Event): event is OrderEvent {
  return event.type === "order";
}
