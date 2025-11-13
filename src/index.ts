// Core
export { TradingBot } from "./core/TradingBot.js";
export { Context } from "./core/Context.js";
export {
  Router,
  type MarketFilter,
  type OrderFilter,
  type NewsFilter,
} from "./core/Router.js";
export { compose, type Algorithm } from "./core/Algorithm.js";

// Error handling
export {
  TradingError,
  TradingErrors,
  type ErrorSeverity,
  type ErrorSource,
  type ErrorCategory,
} from "./core/TradingError.js";
export { defaultLogger, type Logger, type LogLevel } from "./core/Logger.js";

// Providers
export { DataProvider } from "./providers/DataProvider.js";
export { TradeProvider } from "./providers/TradeProvider.js";
export { NewsProvider } from "./providers/NewsProvider.js";
export {
  MockDataProvider,
  type MockDataProviderConfig,
} from "./providers/MockDataProvider.js";
export {
  MockTradeProvider,
  type MockTradeProviderConfig,
} from "./providers/MockTradeProvider.js";
export {
  MockNewsProvider,
  type MockNewsProviderConfig,
} from "./providers/MockNewsProvider.js";

// Middlewares
export { logger, type LoggerOptions } from "./algorithms/index.js";

// Types
export type {
  Event,
  BaseEvent,
  MarketEvent,
  OrderEvent,
  NewsEvent,
} from "./types/Events.js";
export { isMarketEvent, isOrderEvent, isNewsEvent } from "./types/Events.js";
export type { LiveNews } from "./types/News.js";
