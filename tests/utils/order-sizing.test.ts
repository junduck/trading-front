import { describe, it, expect } from "vitest";
import { maxQty, qtyForValue } from "../../src/utils/order-sizing.js";
import { createPosition } from "@junduck/trading-core";

describe("qtyForValue", () => {
  it("calculates quantity for exact dollar amount", () => {
    expect(qtyForValue(1000, 10)).toBe(100);
    expect(qtyForValue(5000, 25)).toBe(200);
  });

  it("floors fractional quantities by default", () => {
    expect(qtyForValue(1000, 33)).toBe(30); // 30.303... -> 30
    expect(qtyForValue(10000, 33.5)).toBe(298); // 298.507... -> 298
  });

  it("supports different rounding strategies", () => {
    const amount = 1000;
    const price = 33; // 30.303...

    expect(qtyForValue(amount, price, { rounding: "floor" })).toBe(30);
    expect(qtyForValue(amount, price, { rounding: "ceil" })).toBe(31);
    expect(qtyForValue(amount, price, { rounding: "round" })).toBe(30);
  });

  it("handles lot sizes correctly", () => {
    // Chinese A-shares: 100-share lots
    expect(qtyForValue(10000, 33, { lotSize: 100 })).toBe(300); // 303.03 -> 3 lots -> 300
    expect(qtyForValue(10000, 50, { lotSize: 100 })).toBe(200); // 200 -> 2 lots -> 200
    expect(qtyForValue(10000, 101, { lotSize: 100 })).toBe(0); // 99.01 -> 0 lots -> 0
  });

  it("combines lot size with different rounding strategies", () => {
    const amount = 10000;
    const price = 33; // 303.03 shares = 3.0303 lots

    expect(qtyForValue(amount, price, { lotSize: 100, rounding: "floor" })).toBe(
      300
    );
    expect(qtyForValue(amount, price, { lotSize: 100, rounding: "ceil" })).toBe(
      400
    );
    expect(qtyForValue(amount, price, { lotSize: 100, rounding: "round" })).toBe(
      300
    );
  });

  it("applies weight parameter", () => {
    expect(qtyForValue(10000, 100, { weight: 1.0 })).toBe(100);
    expect(qtyForValue(10000, 100, { weight: 0.5 })).toBe(50);
    expect(qtyForValue(10000, 100, { weight: 0.3 })).toBe(30);
    expect(qtyForValue(10000, 100, { weight: 0.0 })).toBe(0);
  });

  it("combines weight with lot size", () => {
    // 30% of 10000 = 3000, at price 33 = 90.909 shares = 0.909 lots -> 0
    expect(qtyForValue(10000, 33, { weight: 0.3, lotSize: 100 })).toBe(0);

    // 40% of 10000 = 4000, at price 33 = 121.21 shares = 1.212 lots -> 100
    expect(qtyForValue(10000, 33, { weight: 0.4, lotSize: 100 })).toBe(100);
  });

  it("validates price", () => {
    expect(() => qtyForValue(1000, 0)).toThrow("Invalid price");
    expect(() => qtyForValue(1000, -10)).toThrow("Invalid price");
  });

  it("validates lot size", () => {
    expect(() => qtyForValue(1000, 10, { lotSize: 0 })).toThrow(
      "Invalid lot size"
    );
    expect(() => qtyForValue(1000, 10, { lotSize: -1 })).toThrow(
      "Invalid lot size"
    );
  });

  it("validates weight", () => {
    expect(() => qtyForValue(1000, 10, { weight: -0.1 })).toThrow(
      "Weight must be between 0 and 1"
    );
    expect(() => qtyForValue(1000, 10, { weight: 1.5 })).toThrow(
      "Weight must be between 0 and 1"
    );
  });

  it("handles edge case: insufficient amount for one lot", () => {
    expect(qtyForValue(50, 100, { lotSize: 100 })).toBe(0);
  });

  it("handles edge case: exact lot size match", () => {
    expect(qtyForValue(10000, 100, { lotSize: 100 })).toBe(100);
    expect(qtyForValue(10000, 50, { lotSize: 100 })).toBe(200);
  });
});

describe("maxQty", () => {
  it("calculates maximum quantity from cash", () => {
    expect(maxQty(10000, 100)).toBe(100);
    expect(maxQty(10000, 50)).toBe(200);
  });

  it("floors fractional quantities by default", () => {
    expect(maxQty(10000, 33)).toBe(303); // 303.03... -> 303
    expect(maxQty(10000, 33.5)).toBe(298); // 298.507... -> 298
  });

  it("supports different rounding strategies", () => {
    const cash = 10000;
    const price = 33; // 303.03...

    expect(maxQty(cash, price, { rounding: "floor" })).toBe(303);
    expect(maxQty(cash, price, { rounding: "ceil" })).toBe(304);
    expect(maxQty(cash, price, { rounding: "round" })).toBe(303);
  });

  it("handles lot sizes (Chinese A-shares)", () => {
    expect(maxQty(10000, 33, { lotSize: 100 })).toBe(300); // 303.03 -> 3 lots
    expect(maxQty(10000, 50, { lotSize: 100 })).toBe(200); // 200 -> 2 lots
    expect(maxQty(5000, 100, { lotSize: 100 })).toBe(0); // 50 -> 0 lots
  });

  it("applies weight for portfolio allocation", () => {
    // Allocate 30% of cash
    expect(maxQty(10000, 100, { weight: 0.3 })).toBe(30);
    expect(maxQty(10000, 50, { weight: 0.5 })).toBe(100);
    expect(maxQty(10000, 25, { weight: 0.25 })).toBe(100);
  });

  it("combines weight and lot size for rebalancing", () => {
    // Allocate 30% of 10000 = 3000, at price 33 = 90.909 shares = 0.909 lots -> 0
    expect(maxQty(10000, 33, { weight: 0.3, lotSize: 100 })).toBe(0);

    // Allocate 40% of 10000 = 4000, at price 33 = 121.21 shares = 1.212 lots -> 100
    expect(maxQty(10000, 33, { weight: 0.4, lotSize: 100 })).toBe(100);

    // Allocate 50% of 10000 = 5000, at price 33 = 151.51 shares = 1.515 lots -> 100
    expect(maxQty(10000, 33, { weight: 0.5, lotSize: 100 })).toBe(100);
  });

  it("handles realistic Chinese market scenario", () => {
    const cash = 100000; // ¥100,000
    const price = 33.5; // ¥33.50 per share

    // Use all cash with 100-share lots
    expect(maxQty(cash, price, { lotSize: 100 })).toBe(2900); // 2985.07 -> 29 lots

    // Allocate 25% with lot size
    expect(maxQty(cash, price, { weight: 0.25, lotSize: 100 })).toBe(700); // 746.26 -> 7 lots
  });

  it("validates inputs same as qtyForValue", () => {
    expect(() => maxQty(10000, 0)).toThrow("Invalid price");
    expect(() => maxQty(10000, 10, { lotSize: 0 })).toThrow("Invalid lot size");
    expect(() => maxQty(10000, 10, { weight: 1.5 })).toThrow(
      "Weight must be between 0 and 1"
    );
  });

  it("accepts Position object for convenient shorthand", () => {
    const position = createPosition(50000);

    // Shorthand: pass position directly
    expect(maxQty(position, 100)).toBe(500);
    expect(maxQty(position, 100, { weight: 0.4 })).toBe(200);
    expect(maxQty(position, 33, { lotSize: 100 })).toBe(1500);

    // Equivalent to passing cash explicitly
    expect(maxQty(position.cash, 100)).toBe(500);
  });
});

describe("real-world scenarios", () => {
  it("portfolio rebalancing: equal weight 3 assets", () => {
    const totalEquity = 100000;
    const weight = 1 / 3; // ~0.333
    const prices = { AAPL: 150, GOOGL: 120, MSFT: 300 };

    const targetValue = totalEquity * weight; // 33333.33

    expect(qtyForValue(targetValue, prices.AAPL)).toBe(222); // Floor
    expect(qtyForValue(targetValue, prices.GOOGL)).toBe(277);
    expect(qtyForValue(targetValue, prices.MSFT)).toBe(111);
  });

  it("Chinese market: buy with 30% allocation", () => {
    const cash = 100000; // Available cash
    const price = 15.8; // Stock price
    const allocationWeight = 0.3; // 30% of cash

    const qty = maxQty(cash, price, { weight: allocationWeight, lotSize: 100 });

    expect(qty).toBe(1800); // 30000 / 15.8 = 1898.73 -> 18 lots -> 1800 shares
  });

  it("US market: fractional shares not allowed", () => {
    const cash = 10000;
    const price = 337.5; // Expensive stock

    expect(maxQty(cash, price)).toBe(29); // 29.629... -> 29 shares
  });
});
