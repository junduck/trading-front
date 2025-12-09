import { z } from "zod";

/**
 * Backtest execution status.
 *
 * @lifecycle
 * - Used in: BacktestExecutionSchema
 * - Updated by: Backtest Executor (runtime)
 */
export const BacktestStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Commission configuration schema.
 * Matches CommissionConfig from BacktestBroker.
 */
export const CommissionConfigSchema = z.object({
  /** Percentage commission rate (0.001 = 0.1%) */
  rate: z.number().min(0).optional(),
  /** Fixed commission per trade */
  perTrade: z.number().min(0).optional(),
  /** Minimum commission per trade */
  minimum: z.number().min(0).optional(),
  /** Maximum commission per trade */
  maximum: z.number().min(0).optional(),
});

/**
 * Slippage configuration schema.
 * Matches SlippageConfig from BacktestBroker.
 */
export const SlippageConfigSchema = z.object({
  /** Price slippage configuration */
  price: z
    .object({
      /** Fixed slippage in basis points (100 = 1%) */
      fixed: z.number().min(0).optional(),
      /** Market impact per % of bar volume (e.g., 0.01 = 1% price impact per 100% volume) */
      marketImpact: z.number().min(0).optional(),
    })
    .optional(),
  /** Volume slippage configuration */
  volume: z
    .object({
      /** Maximum order size as % of bar volume (e.g., 0.1 = can fill max 10% of bar volume) */
      maxParticipation: z.number().min(0).max(1).optional(),
      /** Allow partial fills when order exceeds available volume */
      allowPartialFills: z.boolean().optional(),
    })
    .optional(),
});

/**
 * Backtest configuration.
 *
 * @lifecycle
 * - Phase: backtesting
 * - Composed from: UserGoals (symbols, initialCapital), SessionContext (backtestPeriod)
 * - Passed to: BacktestExecutor (via StartBacktestAction)
 * - Stored in: BacktestExecutionSchema.config
 */
export const BacktestConfigSchema = z.object({
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  initialCash: z.number().positive(),
  commission: CommissionConfigSchema,
  slippage: SlippageConfigSchema.optional(),
});

export type BacktestStatus = z.infer<typeof BacktestStatusSchema>;
export type CommissionConfig = z.infer<typeof CommissionConfigSchema>;
export type SlippageConfig = z.infer<typeof SlippageConfigSchema>;
export type BacktestConfig = z.infer<typeof BacktestConfigSchema>;
