import type { Order, Position, OrderState } from "@junduck/trading-core";
import type { AmendAction } from "../core/Context.js";
import type { MarketEvent, OrderEvent } from "../types/Events.js";

/**
 * SimpleBT WebSocket Protocol Types
 */

export interface SbtRequest {
  action: string;
  action_id: number;
  params: unknown;
}

export interface SbtResponse {
  type: "response";
  action_id: number;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface SbtMarketEvent {
  type: "market";
  cid: string;
  timestamp: string;
  data: MarketEvent["marketData"];
}

export interface SbtOrderEvent {
  type: "order";
  cid: string;
  timestamp: string;
  data: {
    updated: OrderEvent["updated"];
    fills: OrderEvent["fill"];
  };
}

export type SbtEvent = SbtMarketEvent | SbtOrderEvent;

export type SbtMessage = SbtResponse | SbtEvent;

// Request params
export interface InitParams {
  config?: unknown; // Server-defined initialization configuration
}

export interface LoginParams {
  cid: string;
}

export interface SubscribeParams {
  cid: string;
  symbols: string[];
}

export interface UnsubscribeParams {
  cid: string;
  symbols: string[];
}

export interface GetPositionParams {
  cid: string;
}

export interface GetOpenOrdersParams {
  cid: string;
}

export interface SubmitOrdersParams {
  cid: string;
  orders: Order[];
}

export interface AmendOrdersParams {
  cid: string;
  updates: AmendAction[];
}

export interface CancelOrdersParams {
  cid: string;
  orderIds: string[];
}

export interface CancelAllOrdersParams {
  cid: string;
}

// Response results
export interface InitResult {
  // Server-defined initialization response (e.g., server version, capabilities, etc.)
  [key: string]: unknown;
}

export interface LoginResult {
  connected: boolean;
}

export interface SubscribeResult {
  subscribed: string[];
}

export interface UnsubscribeResult {
  unsubscribed: string[];
}

export type GetPositionResult = Position;

export type GetOpenOrdersResult = OrderState[];

export interface SubmitOrdersResult {
  submitted: number;
}

export interface AmendOrdersResult {
  amended: number;
}

export interface CancelOrdersResult {
  cancelled: number;
}

export interface CancelAllOrdersResult {
  cancelled: number;
}
