import type {
  MarketQuote,
  OrderState,
  Fill,
} from "@junduck/trading-core/trading";

/**
 * Base event with main tag dispatch type.
 */
export interface BaseEvent {
  type: "market" | "external" | "order";
  timestamp: Date;
}

/**
 * Market event
 */
export interface MarketEvent extends BaseEvent {
  type: "market";
  marketData: MarketQuote[];
}

/**
 * External event for any external signal source (news, ML predictions, sentiment, etc.)
 *
 * Business logic:
 * - Generic event type for external signals beyond market/order data
 * - Provider specifies `source` to identify signal type
 * - Provider defines `data` structure (middleware casts to expected type)
 * - Examples: news feeds, ML predictions, sentiment analysis, webhooks
 */
export interface ExternalEvent extends BaseEvent {
  type: "external";
  /** Source identifier (e.g., "news", "ml-predictor", "sentiment") */
  source: string;
  /** Provider-specific data payload */
  data: unknown;
}

/**
 * Order event with optional state and execution.
 */
export interface OrderEvent extends BaseEvent {
  type: "order";
  updated: OrderState[];
  fill: Fill[];
}

/**
 * Union type for all events in the system.
 */
export type Event = MarketEvent | ExternalEvent | OrderEvent;

/**
 * Type guard to check if an event is a market event.
 */
export function isMarketEvent(event: Event): event is MarketEvent {
  return event.type === "market";
}

/**
 * Type guard to check if an event is an external event.
 */
export function isExternalEvent(event: Event): event is ExternalEvent {
  return event.type === "external";
}

/**
 * Type guard to check if an event is an order event.
 */
export function isOrderEvent(event: Event): event is OrderEvent {
  return event.type === "order";
}
