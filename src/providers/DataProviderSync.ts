import { BaseProviderSync } from "./BaseProviderSync.js";
import type { MarketEvent } from "../types/Events.js";

export abstract class DataProviderSync extends BaseProviderSync<MarketEvent> {}
