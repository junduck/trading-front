import type { UniversalAlgo } from "../../src/core/compose.js";

/** Options for position printer */
export interface PositionPrinterOptions {
  /** Whether to print long positions (default: true) */
  printLong?: boolean;
  /** Whether to print short positions (default: true) */
  printShort?: boolean;
  /** Whether to print cash balance (default: true) */
  printCash?: boolean;
  /** Whether to print summary statistics (default: true) */
  printSummary?: boolean;
}

/**
 * Position printer middleware that logs position updates on order fills.
 *
 * Demonstrates how to monitor position changes in response to trade executions.
 * The bot automatically updates ctx.position before this middleware runs.
 *
 * Business logic:
 * - Filters for order events with fill executions
 * - Prints the updated position from ctx.position
 * - Useful for monitoring portfolio changes during backtesting and live trading
 *
 * @param options - Configuration for what to print
 * @returns Universal algorithm middleware function (works with all event types)
 *
 * @example
 * ```ts
 * // Print all position updates
 * bot.use(positionPrinter());
 *
 * // Only print long positions and cash
 * bot.use(positionPrinter({ printShort: false, printSummary: false }));
 * ```
 */
export function positionPrinter(
  options: PositionPrinterOptions = {}
): UniversalAlgo {
  const {
    printLong = true,
    printShort = true,
    printCash = true,
    printSummary = true,
  } = options;

  return async (ctx, next) => {
    // Business logic: Filter for order events with fill executions.
    // Only fills update the position, other order events (state changes) don't.
    if (ctx.event.type === "order" && ctx.event.fill.length > 0) {
      // Log each fill
      for (const fill of ctx.event.fill) {
        ctx.logger.info({
          msg: "Order filled",
          fillId: fill.id,
          orderId: fill.orderId,
          symbol: fill.symbol,
          side: fill.side,
          effect: fill.effect,
          quantity: fill.quantity,
          price: fill.price,
          commission: fill.commission,
          timestamp: fill.created.toISOString(),
        });
      }

      // Print updated position from ctx.position (automatically updated by bot)
      const { position } = ctx;

      if (printCash) {
        ctx.logger.info({
          msg: "Cash balance",
          cash: position.cash,
        });
      }

      if (printSummary) {
        // Business logic: Summary metrics track overall portfolio performance
        ctx.logger.info({
          msg: "Position summary",
          totalCommission: position.totalCommission,
          realisedPnL: position.realisedPnL,
          modified: position.modified.toISOString(),
        });
      }

      if (printLong && position.long && position.long.size > 0) {
        // Business logic: Long positions are assets owned (bought).
        // avgCost = totalCost / quantity shows average purchase price including commissions.
        const longPositions: Record<string, unknown> = {};
        for (const [symbol, longPos] of position.long) {
          longPositions[symbol] = {
            quantity: longPos.quantity,
            totalCost: longPos.totalCost,
            avgCost:
              longPos.quantity > 0 ? longPos.totalCost / longPos.quantity : 0,
            realisedPnL: longPos.realisedPnL,
            lots: longPos.lots.length,
            modified: longPos.modified.toISOString(),
          };
        }
        ctx.logger.info({
          msg: "Long positions",
          positions: longPositions,
        });
      }

      if (printShort && position.short && position.short.size > 0) {
        // Business logic: Short positions are borrowed assets sold (sold first, buy later).
        // avgProceeds = totalProceeds / quantity shows average sale price minus commissions.
        const shortPositions: Record<string, unknown> = {};
        for (const [symbol, shortPos] of position.short) {
          shortPositions[symbol] = {
            quantity: shortPos.quantity,
            totalProceeds: shortPos.totalProceeds,
            avgProceeds:
              shortPos.quantity > 0
                ? shortPos.totalProceeds / shortPos.quantity
                : 0,
            realisedPnL: shortPos.realisedPnL,
            lots: shortPos.lots.length,
            modified: shortPos.modified.toISOString(),
          };
        }
        ctx.logger.info({
          msg: "Short positions",
          positions: shortPositions,
        });
      }
    }

    next();
  };
}
