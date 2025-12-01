// Core
export { TradingBot } from "./core/TradingBot.js";
export { Context } from "./core/Context.js";
export { Router } from "./core/Router.js";
export { Snapshot } from "./core/Snapshot.js";
export {
  compose,
  type Algo as Algorithm,
  type MarketAlgo as MarketAlgo,
  type OrderAlgo,
  type ExternalAlgo,
  type UniversalAlgo,
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
export { DataProviderSync } from "./providers/DataProviderSync.js";
export { TradeProvider } from "./providers/TradeProvider.js";
export { TradeProviderSync } from "./providers/TradeProviderSync.js";
export { ExternalProvider } from "./providers/ExternalProvider.js";
export { ExternalProviderSync } from "./providers/ExternalProviderSync.js";

// Algorithms
export {
  crossover,
  type CrossoverOptions,
  type CrossoverValue,
  type CrossoverSignal,
  history,
  type HistoryOptions,
} from "./algorithms/index.js";

// Backtest
export { BacktestBroker } from "./providers-backtest/BacktestBroker.js";

export {
  type BacktestConfig,
  type CommissionConfig,
  type SlippageConfig,
} from "./schema/backtest.js";

// Utilities
export { maxQty, qtyForValue, type OrderSizingOptions } from "./utils/index.js";

// Metrics
export {
  PerformanceMetrics,
  performanceTracker,
  type PerformanceConfig,
  type PerformanceSnapshot,
} from "./metrics/index.js";

// Types
export type {
  Event,
  BaseEvent,
  MarketEvent,
  OrderEvent,
  ExternalEvent,
} from "./types/Events.js";
export {
  isMarketEvent,
  isOrderEvent,
  isExternalEvent,
} from "./types/Events.js";
