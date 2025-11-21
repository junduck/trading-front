// Core
export { TradingBot } from "./core/TradingBot.js";
export { Context } from "./core/Context.js";
export { Router } from "./core/Router.js";
export { compose, type Algorithm } from "./core/compose.js";

// Error handling
export {
  TradingError,
  TradingErrors,
  type ErrorSeverity,
  type ErrorSource,
  type ErrorCategory,
} from "./core/TradingError.js";
export {
  createLogger,
  defaultLogger,
  type Logger,
  type LogLevel,
  type LoggerConfig,
} from "./core/Logger.js";

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

// Algorithms
export {
  macd,
  type MacdOptions,
  type MacdValue,
  crossover,
  type CrossoverOptions,
  type CrossoverValue,
  type CrossoverSignal,
  positionPrinter,
  type PositionPrinterOptions,
  eventCounter,
  type EventCounterOptions,
} from "./algorithms/index.js";

// Backtest
export {
  BacktestProvider,
  type BacktestConfig,
} from "./providers-backtest/BacktestProvider.js";

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
