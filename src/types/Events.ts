import type {
  FillEffect,
  MarketQuote,
  OrderState,
} from "@junduck/trading-core";
import type { LiveNews } from "./News.js";

/**
 * Base event with main tag dispatch type.
 */
export interface BaseEvent {
  type: "market" | "news" | "order";
  timestamp: Date;
}

/**
 * Market event
 */
export interface MarketEvent extends BaseEvent {
  type: "market";
  marketData: MarketQuote[];
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
  effect?: FillEffect;
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
