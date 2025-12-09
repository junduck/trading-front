import { BaseProvider } from "./BaseProvider.js";
import type { ExternalEvent } from "../types/Events.js";

/**
 * Abstract interface for connecting to external signal data.
 */
export abstract class ExternalProvider extends BaseProvider<ExternalEvent> {}
