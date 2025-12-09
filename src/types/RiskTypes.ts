/** Risk severity levels. */
export type RiskSeverity = "low" | "medium" | "high" | "critical";

/** Risk event categories. */
export type RiskCategory =
  | "account" // Account-related risks
  | "position" // Position-related risks
  | "market" // Market-related risks
  | "execution" // Execution-related risks
  | "strategy" // Strategy-related risks
  | "operational"; // Operational risks

/** Risk event types. */
export type RiskType =
  // Account risks
  | "margin_call" // Account has insufficient margin to maintain positions
  | "pattern_day_trader" // Account has exceeded pattern day trading limits
  | "buying_power" // Account has insufficient buying power for new positions
  | "account_equity" // Account equity has fallen below threshold
  // Position risks
  | "position" // Position size exceeds allowed limits
  | "concentration" // Portfolio is too concentrated in single asset/sector
  | "drawdown" // Portfolio drawdown exceeds acceptable level
  | "exposure" // Exposure to specific asset/sector exceeds limits
  // Market risks
  | "leverage" // Account leverage exceeds acceptable levels
  | "volatility" // Market volatility exceeds risk parameters
  | "correlation" // High correlation detected between positions
  | "liquidity" // Insufficient market liquidity for position size
  | "market_regime" // Market regime change detected
  // Execution risks
  | "slippage" // Order execution slippage exceeds acceptable range
  | "latency" // Execution latency exceeds threshold
  // Strategy risks
  | "model_drift" // Strategy model performance deviating from expectations
  | "overfitting" // Strategy shows signs of overfitting
  | "parameter_drift" // Strategy parameters have drifted from optimal values
  // Operational risks
  | "system_error"; // System errors affecting trading operations

/**
 * Base risk event data structure.
 */
export interface BaseRiskData {
  /** Risk category for grouping and filtering */
  category: RiskCategory;
  /** Risk event type */
  riskType: RiskType;
  /** Risk severity level */
  severity: RiskSeverity;
  /** Risk score (0-100, higher = greater risk) */
  score: number;
  /** Risk event message */
  message: string;
  /** Detailed description of the risk event */
  description?: string;
}

/**
 * Risk metrics for threshold-based risks.
 */
export interface RiskMetrics {
  /** Current value that triggered the event */
  currentValue?: number;
  /** Limit value that was breached/approached */
  limitValue?: number;
  /** Percentage of limit used (0-100) */
  limitUsage?: number;
}

/**
 * Risk impact information.
 */
export interface RiskImpact {
  /** Affected symbols or assets */
  affectedSymbols?: string[];
  /** Affected position IDs */
  affectedPositions?: string[];
  /** Affected order IDs */
  affectedOrders?: string[];
}

/**
 * Risk tracking information.
 */
export interface RiskTracking {
  /** Time when the risk was first detected */
  firstDetected?: Date;
  /** Number of times this risk has occurred */
  occurrenceCount?: number;
  /** Unique identifier for this risk instance */
  riskId?: string;
}

/**
 * Risk mitigation information.
 */
export interface RiskMitigation {
  /** Risk mitigation suggestions */
  mitigation?: string[];
  /** Additional metadata for the risk event */
  metadata?: Record<string, any>;
}

/**
 * Complete risk data structure combining all risk-related information.
 */
export interface RiskData
  extends BaseRiskData,
    RiskMetrics,
    RiskImpact,
    RiskTracking,
    RiskMitigation {}
