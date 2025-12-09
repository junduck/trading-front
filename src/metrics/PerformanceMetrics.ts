import {
  CuKurt,
  RunningDownStats,
  RunningSharpe,
  RunningSortino,
  RunningRelDrawdown,
} from "@junduck/trading-core";
import type { OrderAlgo } from "../core/compose.js";

/**
 * Configuration for performance tracking.
 */
export interface PerformanceConfig {
  /** Initial capital for return calculations */
  initialCapital: number;

  /**
   * Annualized risk-free rate for Sharpe/Sortino calculation. Default: 0
   *
   * Usage:
   * - For intraday/per-trade updates: keep at 0 (default)
   * - For regular period updates: provide annualized rate (e.g., 0.02 for 2%)
   *   and set periodsPerYear for proper conversion
   */
  riskFreeRate?: number;

  /**
   * Number of periods per year for annualization. Optional.
   *
   * Examples:
   * - 252: daily trading periods
   * - 52: weekly
   * - 12: monthly
   *
   * When provided, converts annualized riskFreeRate to period rate internally.
   * Leave undefined for event-driven updates (per-trade).
   */
  periodsPerYear?: number;

  /** State key to store performance snapshots (default: "performance") */
  stateKey?: string;
}

/**
 * Single snapshot of performance metrics at a point in time.
 * This is the core data structure for performance state.
 */
export interface PerformanceSnapshot {
  /** When this snapshot was taken */
  timestamp: Date;

  // Portfolio state
  /** Total portfolio value (cash + market value) */
  equity: number;
  /** Cash balance */
  cash: number;
  /** Market value of holdings */
  marketValue: number;

  // Returns
  /** Total return since start */
  totalReturn: number;

  // Risk-adjusted metrics
  /** Sharpe ratio (excess return / volatility) */
  sharpeRatio: number;
  /** Sortino ratio (excess return / downside volatility) */
  sortinoRatio: number;
  /** Calmar ratio (total return / max drawdown) */
  calmarRatio: number;

  // Drawdown tracking
  /** Current drawdown from peak */
  drawdown: number;
  /** Maximum drawdown observed */
  maxDrawdown: number;
  /** When max drawdown started (peak timestamp) */
  maxDrawdownStart: Date;
  /** When max drawdown bottomed (trough timestamp) */
  maxDrawdownEnd: Date;

  // Volatility
  /** Volatility (stddev of returns) */
  volatility: number;
  /** Downside volatility (stddev of negative returns only) */
  downsideVolatility: number;

  // Distribution
  /** Skewness of return distribution */
  skewness: number;
  /** Kurtosis of return distribution */
  kurtosis: number;

  // Trade statistics
  /** Total number of trades executed */
  totalTrades: number;
  /** Total commission paid */
  totalCommission: number;
  /** Realised profit/loss */
  realisedPnL: number;
}

/**
 * Performance metrics tracker.
 * Maintains state and calculates metrics incrementally using cumulative statistics.
 *
 * Business logic:
 * - Updates on each trade (fill event)
 * - Calculates returns as equity deltas
 * - Tracks drawdown state (peak, current DD, max DD)
 * - Uses incremental stats for O(1) updates
 *
 * Risk-free rate handling:
 * - Provide annualized rate in config (e.g., 0.02 for 2%)
 * - If periodsPerYear is set, automatically converts to period rate
 * - For intraday/per-trade updates: leave riskFreeRate at 0 (default)
 *
 * Note: All metrics are period-based. Sharpe/Sortino use period returns.
 */
export class PerformanceMetrics {
  private config: PerformanceConfig;
  private snapshots: PerformanceSnapshot[] = [];

  // Incremental statistics calculators
  private returnStats = new CuKurt();
  private sharpe: RunningSharpe;
  private sortino: RunningSortino;

  // Downside stats
  private downstats: RunningDownStats;

  // Drawdown tracking
  private drawdown: RunningRelDrawdown<Date>;

  // Last equity for return calculation
  private lastEquity: number;

  constructor(config: PerformanceConfig) {
    this.config = config;
    // Convert annualized risk-free rate to period rate if periodsPerYear is provided
    const annualRate = config.riskFreeRate ?? 0;
    const periodRate = config.periodsPerYear
      ? annualRate / config.periodsPerYear
      : annualRate;

    this.sharpe = new RunningSharpe({ riskfree: periodRate });
    this.sortino = new RunningSortino({ riskfree: periodRate });
    this.downstats = new RunningDownStats({ threshold: periodRate });
    this.drawdown = new RunningRelDrawdown(config.initialCapital, new Date(0));
    this.lastEquity = config.initialCapital;
  }

  /**
   * Update metrics with new portfolio state.
   * Called on each fill event (trade execution).
   *
   * Business logic:
   * 1. Calculate return from last equity point
   * 2. Update all incremental statistics
   * 3. Update drawdown tracking
   * 4. Create and store snapshot
   */
  update(
    timestamp: Date,
    equity: number,
    cash: number,
    marketValue: number,
    totalTrades: number,
    totalCommission: number,
    realisedPnL: number
  ): PerformanceSnapshot {
    // Calculate period return (equity change)
    const ret = equity / this.lastEquity - 1;
    this.lastEquity = equity;

    // Update incremental statistics (CuKurt provides mean, variance, skew, kurt)
    const retStats = this.returnStats.update(ret);
    const sharpeRatio = this.sharpe.update(ret);
    const sortinoRatio = this.sortino.update(ret);
    const downStats = this.downstats.update(ret);
    const dd = this.drawdown.update(equity, timestamp);

    // Calculate cumulative metrics
    const totalReturn = equity / this.config.initialCapital - 1;
    const calmarRatio = dd.max > 0 ? totalReturn / dd.max : 0;

    const snapshot: PerformanceSnapshot = {
      timestamp,
      equity,
      cash,
      marketValue,
      totalReturn,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      drawdown: dd.value,
      maxDrawdown: dd.max,
      maxDrawdownStart: dd.maxFrom,
      maxDrawdownEnd: dd.maxTo,
      volatility: Math.sqrt(retStats.variance),
      downsideVolatility: downStats.stddev,
      skewness: retStats.skew,
      kurtosis: retStats.kurt,
      totalTrades,
      totalCommission,
      realisedPnL,
    };

    this.snapshots.push(snapshot);
    return snapshot;
  }

  /**
   * Get latest performance snapshot.
   * Returns null if no updates have been recorded yet.
   */
  latest(): PerformanceSnapshot | null {
    return this.snapshots[this.snapshots.length - 1] ?? null;
  }

  /**
   * Get all historical snapshots (ordered by time).
   */
  getHistory(): readonly PerformanceSnapshot[] {
    return this.snapshots;
  }

  /**
   * Reset metrics to initial state.
   * Useful when starting a new backtest run.
   */
  reset(): void {
    this.snapshots = [];
    this.returnStats = new CuKurt();

    // Convert annualized risk-free rate to period rate if periodsPerYear is provided
    const annualRate = this.config.riskFreeRate ?? 0;
    const periodRate = this.config.periodsPerYear
      ? annualRate / this.config.periodsPerYear
      : annualRate;

    this.sharpe = new RunningSharpe({ riskfree: periodRate });
    this.sortino = new RunningSortino({ riskfree: periodRate });
    this.downstats = new RunningDownStats({ threshold: periodRate });
    this.drawdown = new RunningRelDrawdown(
      this.config.initialCapital,
      new Date(0)
    );
    this.lastEquity = this.config.initialCapital;
  }
}

/**
 * Create performance tracking middleware.
 *
 * Business logic:
 * - Listens to order events
 * - Updates metrics only on fill events (when effect is present)
 * - Writes performance snapshot to ctx.state for downstream middleware
 * - Works identically in backtest and live trading
 *
 * @param config - Performance tracking configuration
 * @returns Order algorithm middleware function (only works with order events)
 *
 * @example
 * ```ts
 * // For daily backtesting with 2% annual risk-free rate
 * bot.order({
 *   strategy: [
 *     performanceTracker({
 *       initialCapital: 100000,
 *       riskFreeRate: 0.02,
 *       periodsPerYear: 252  // trading days per year
 *     }),
 *     async (ctx, next) => {
 *       const perf = ctx.get<PerformanceSnapshot>("performance");
 *       if (perf && perf.drawdown > 0.15) {
 *         console.warn("Drawdown exceeded 15%!");
 *       }
 *       await next();
 *     }
 *   ]
 * });
 *
 * // For intraday/per-trade tracking (no risk-free rate needed)
 * performanceTracker({ initialCapital: 100000 })
 * ```
 */
export function performanceTracker(config: PerformanceConfig): OrderAlgo {
  const metrics = new PerformanceMetrics(config);
  const stateKey = config.stateKey ?? "performance";
  let tradeCount = 0;

  return (ctx, next) => {
    // Only update on fill events (when fills are present)
    if (ctx.event.fill.length > 0) {
      tradeCount++;

      // Use equity from context (calculated by TradingBot on market/order events)
      const equity = ctx.equity;
      const marketValue = equity - ctx.cash;

      // Update metrics and write snapshot to context state
      const snapshot = metrics.update(
        ctx.event.timestamp,
        equity,
        ctx.cash,
        marketValue,
        tradeCount,
        ctx.totalCommission,
        ctx.realisedPnL
      );

      // Write to state for downstream middleware to access
      ctx.set(stateKey, snapshot);
    }

    next();
  };
}
