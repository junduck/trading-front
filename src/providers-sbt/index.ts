/**
 * SimpleBT - Multiplexed backtest service
 *
 * Provides a unified WebSocket connection for concurrent backtest simulations.
 * Create a single SimpleBtService and generate multiple DataProvider/TradeProvider
 * instances for different client IDs.
 *
 * @example
 * ```typescript
 * const service = new SimpleBtService({ url: 'ws://localhost:8080' });
 * await service.connect();
 *
 * // Create providers for multiple backtest clients
 * const dataProvider1 = service.getDataProvider('client-1');
 * const tradeProvider1 = service.getTradeProvider('client-1');
 *
 * const dataProvider2 = service.getDataProvider('client-2');
 * const tradeProvider2 = service.getTradeProvider('client-2');
 *
 * // Use in TradingBot instances as normal
 * const bot1 = new TradingBot({
 *   data: dataProvider1,
 *   trade: tradeProvider1,
 *   // ...
 * });
 * ```
 *
 * @platform universal
 */

export { SimpleBtService } from "./SimpleBtService.js";
export type { SimpleBtServiceOptions } from "./SimpleBtService.js";
export { SimpleBtDataProvider } from "./SimpleBtDataProvider.js";
export { SimpleBtTradeProvider } from "./SimpleBtTradeProvider.js";
export * from "./protocol.js";
