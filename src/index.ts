// Core
export { TradingBot } from "./core/TradingBot.js";
export { Context } from "./core/Context.js";
export { Router } from "./core/Router.js";
export {
  compose,
  type Algorithm,
  type MarketAlgorithm,
  type OrderAlgorithm,
  type NewsAlgorithm,
  type UniversalAlgorithm,
  type Strategy,
} from "./core/compose.js";

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
  history,
  type HistoryOptions,
} from "./algorithms/index.js";

// Backtest
export {
  BacktestProvider,
  type BacktestConfig,
} from "./providers-backtest/BacktestProvider.js";

// Utilities
export {
  maxQty,
  qtyForValue,
  type OrderSizingOptions,
} from "./utils/index.js";

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
