/**
 * Order sizing utilities for calculating trade quantities.
 *
 * These utilities convert cash/value amounts to order quantities,
 * handling lot sizes and rounding strategies.
 */

import type { Position } from "@junduck/trading-core";

/**
 * Options for order sizing calculations.
 */
export interface OrderSizingOptions {
  /** Percentage of cash/amount to use, 0.0-1.0 (default: 1.0) */
  weight?: number;
  /** Rounding strategy for fractional lots (default: "floor") */
  rounding?: "floor" | "ceil" | "round";
  /** Minimum quantity increment/lot size (default: 1) */
  lotSize?: number;
}

/**
 * Calculate maximum quantity purchasable with available cash.
 *
 * @param cashOrPosition - Available cash amount or Position object
 * @param price - Price per unit
 * @param options - Sizing options (weight, rounding, lot size)
 * @returns Quantity to purchase (respecting lot size constraints)
 *
 * @example
 * // Buy maximum with all cash
 * const qty = maxQty(10000, 33.5);
 *
 * @example
 * // Convenient shorthand with Position object
 * const qty = maxQty(ctx.position, price, { weight: 0.3, lotSize: 100 });
 *
 * @example
 * // Explicit cash amount
 * const qty = maxQty(ctx.position.cash, price, { weight: 0.3, lotSize: 100 });
 */
export function maxQty(
  cashOrPosition: number | Position,
  price: number,
  options?: OrderSizingOptions
): number {
  const weight = options?.weight ?? 1.0;
  const rounding = options?.rounding ?? "floor";
  const lotSize = options?.lotSize ?? 1;

  if (weight < 0 || weight > 1) {
    throw new Error(`Weight must be between 0 and 1, got: ${weight}`);
  }

  const cash = typeof cashOrPosition === "number" ? cashOrPosition : cashOrPosition.cash;
  const effectiveCash = cash * weight;
  return qtyForValue(effectiveCash, price, { rounding, lotSize });
}

/**
 * Calculate quantity for a given dollar amount.
 *
 * @param amount - Target dollar amount to invest
 * @param price - Price per unit
 * @param options - Sizing options (weight, rounding, lot size)
 * @returns Quantity to purchase (respecting lot size constraints)
 *
 * @example
 * // Buy $5000 worth
 * const qty = qtyForValue(5000, 33.5);
 *
 * @example
 * // 40% allocation of total equity, with lot size
 * const targetValue = totalEquity * 0.4;
 * const qty = qtyForValue(targetValue, price, { lotSize: 100 });
 *
 * @example
 * // Use 90% of target value with ceiling rounding
 * const qty = qtyForValue(10000, price, { weight: 0.9, rounding: "ceil" });
 */
export function qtyForValue(
  amount: number,
  price: number,
  options?: OrderSizingOptions
): number {
  const weight = options?.weight ?? 1.0;
  const rounding = options?.rounding ?? "floor";
  const lotSize = options?.lotSize ?? 1;

  if (price <= 0) {
    throw new Error(`Invalid price: ${price}`);
  }

  if (lotSize <= 0) {
    throw new Error(`Invalid lot size: ${lotSize}`);
  }

  if (weight < 0 || weight > 1) {
    throw new Error(`Weight must be between 0 and 1, got: ${weight}`);
  }

  const effectiveAmount = amount * weight;
  const rawQty = effectiveAmount / price;
  const lots = rawQty / lotSize;

  let roundedLots: number;
  switch (rounding) {
    case "floor":
      roundedLots = Math.floor(lots);
      break;
    case "ceil":
      roundedLots = Math.ceil(lots);
      break;
    case "round":
      roundedLots = Math.round(lots);
      break;
  }

  return roundedLots * lotSize;
}
