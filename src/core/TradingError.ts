import type { Event } from "../types/Events.js";

/**
 * ERROR HANDLING CONTRACT
 * =======================
 *
 * All code in the trading system (algorithms, middleware, providers) MUST throw
 * TradingError instances only. This ensures consistent error handling with proper
 * severity, source, and category metadata for automated control flow decisions.
 *
 * Never throw plain Error, string, or other error types. Always use TradingError
 * or the convenience constructors (TradingErrors.algorithm, TradingErrors.provider, etc).
 */

/**
 * Error severity determines the control flow action.
 *
 * - recover: Transient error, log and continue processing next events. Notice that pending is still dropped due to end of call chain.
 * - cancel: Drop pending and cancel all open orders, log, then continue
 * - halt: Drop pending and cancel all open orders, disconnect providers, exit gracefully
 * - fatal: Immediate termination (system integrity compromised)
 */
export type ErrorSeverity = "recover" | "cancel" | "halt" | "fatal";

/**
 * Error source classification.
 */
export type ErrorSource =
  | "algorithm" // User-defined algorithm
  | "system" // TradingBot internal
  | "provider" // Data/Trade provider
  | "validation"; // Order/action validation

/**
 * Error category for semantic classification.
 */
export type ErrorCategory =
  | "network" // Connection, timeout, network issues
  | "data" // Invalid/missing market data
  | "execution" // Order submission/modification failed
  | "validation" // Parameter/state validation failed
  | "logic" // Algorithm logic error
  | "state" // Invalid state transition
  | "system"; // System-level error

/**
 * Unified trading error with structured metadata for logging and AI inspection.
 *
 * Design principles:
 * - Lightweight: Only essential fields, optional metadata for debugging
 * - AI-friendly: Structured, JSON-serializable, semantic fields
 * - Actionable: Clear severity and category for automated handling
 */
export class TradingError extends Error {
  override readonly name = "TradingError";

  /** Error severity determines control flow */
  readonly severity: ErrorSeverity;

  /** Error source (where it originated) */
  readonly source: ErrorSource;

  /** Name of algorithm that threw this error (if applicable) */
  readonly sourceName?: string;

  /** Error category (semantic classification) */
  readonly category: ErrorCategory;

  /** Event that triggered this error */
  readonly event: Event;

  /** Timestamp when error occurred */
  readonly timestamp: Date;

  /** Additional context for debugging (optional, keep lightweight) */
  readonly metadata?: Record<string, unknown>;

  constructor(
    message: string,
    severity: ErrorSeverity,
    source: ErrorSource,
    category: ErrorCategory,
    event: Event,
    sourceName?: string,
    metadata?: Record<string, unknown>
  ) {
    super(message);
    this.severity = severity;
    this.source = source;
    this.category = category;
    this.event = event;
    if (sourceName) {
      this.sourceName = sourceName;
    }
    if (metadata) {
      this.metadata = metadata;
    }

    this.timestamp = new Date();

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TradingError);
    }
  }

  /**
   * Format error for human-readable logging.
   * Uses a standardized format for consistency.
   */
  override toString(): string {
    const parts = [
      `[${this.severity.toUpperCase()}]`,
      `[${this.source}${this.sourceName ? `:${this.sourceName}` : ""}]`,
      `[${this.category}]`,
      this.message,
    ];

    return parts.join(" ");
  }

  /**
   * Serialize to JSON for AI inspection and structured logging.
   * Includes all relevant fields in a flat, easy-to-parse structure.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      severity: this.severity,
      source: this.source,
      category: this.category,
      sourceName: this.sourceName,
      timestamp: this.timestamp.toISOString(),
      event: {
        type: this.event.type,
        timestamp: this.event.timestamp.toISOString(),
      },
      metadata: this.metadata,
      stack: this.stack,
    };
  }
}

/**
 * Convenience constructors for common error scenarios.
 */
export const TradingErrors = {
  /**
   * Algorithm/middleware threw an error.
   */
  algorithm: (
    message: string,
    event: Event,
    sourceName: string,
    severity?: ErrorSeverity,
    category?: ErrorCategory
  ) => {
    return new TradingError(
      message,
      severity ?? "recover",
      "algorithm",
      category ?? "logic",
      event,
      sourceName
    );
  },

  /**
   * Provider error (data/trade provider).
   */
  provider: (
    message: string,
    event: Event,
    sourceName: string,
    severity?: ErrorSeverity,
    category?: ErrorCategory
  ) => {
    return new TradingError(
      message,
      severity ?? "halt",
      "provider",
      category ?? "network",
      event,
      sourceName
    );
  },

  /**
   * Validation error (order/action validation).
   */
  validation: (
    message: string,
    event: Event,
    severity?: ErrorSeverity,
    metadata?: Record<string, unknown>
  ) => {
    return new TradingError(
      message,
      severity ?? "recover",
      "validation",
      "validation",
      event,
      undefined,
      metadata
    );
  },

  /**
   * System error (TradingBot internal).
   * Can accept either Event or options object with severity/category.
   */
  system: (
    message: string,
    event: Event,
    severityOrOptions?:
      | ErrorSeverity
      | { severity?: ErrorSeverity; category?: ErrorCategory; cause?: Error },
    category?: ErrorCategory
  ) => {
    // Handle both call signatures
    let severity: ErrorSeverity = "fatal";
    let cat: ErrorCategory = "system";
    let metadata: Record<string, unknown> | undefined;

    if (typeof severityOrOptions === "object" && severityOrOptions !== null) {
      severity = severityOrOptions.severity ?? "fatal";
      cat = severityOrOptions.category ?? "system";
      if (severityOrOptions.cause) {
        metadata = { cause: severityOrOptions.cause };
      }
    } else if (typeof severityOrOptions === "string") {
      severity = severityOrOptions;
      cat = category ?? "system";
    }

    return new TradingError(message, severity, "system", cat, event, undefined, metadata);
  },
};
