import { BaseProviderSync } from "./BaseProviderSync.js";
import type { ExternalEvent } from "../types/Events.js";

/**
 * Abstract interface for synchronous external signal data (e.g., backtesting).
 *
 * All methods are designed for zero-overhead synchronous execution.
 */
export abstract class ExternalProviderSync extends BaseProviderSync<ExternalEvent> {}
