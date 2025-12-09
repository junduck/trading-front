import { describe, it, expect } from "vitest";
import {
  createCashPosition,
  createEqualWeightedPosition,
  createLinearWeightedPosition,
  createExpWeightedPosition,
} from "./MockContext.js";

describe("createCashPosition", () => {
  it("should create position with specified cash and no holdings", () => {
    const position = createCashPosition(10000);

    expect(position.cash).toBe(10000);
    // Position from trading-core doesn't initialize long Map by default
    expect(position.long).toBeUndefined();
  });

  it("should create position with zero cash", () => {
    const position = createCashPosition(0);

    expect(position.cash).toBe(0);
    expect(position.long).toBeUndefined();
  });

  it("should create position with large cash amount", () => {
    const position = createCashPosition(1000000);

    expect(position.cash).toBe(1000000);
    expect(position.long).toBeUndefined();
  });
});

describe("createEqualWeightedPosition", () => {
  it("should create position with equal shares for all symbols", () => {
    const symbols = ["AAPL", "GOOGL", "MSFT"];
    const position = createEqualWeightedPosition(symbols, 100, 5000);

    expect(position.cash).toBe(5000);
    expect(position.long.size).toBe(3);

    // All symbols should have same quantity
    expect(position.long.get("AAPL")?.quantity).toBe(100);
    expect(position.long.get("GOOGL")?.quantity).toBe(100);
    expect(position.long.get("MSFT")?.quantity).toBe(100);

    // Business logic: each position costs 100 shares * $100 = $10,000
    expect(position.long.get("AAPL")?.totalCost).toBe(10000);
    expect(position.long.get("GOOGL")?.totalCost).toBe(10000);
    expect(position.long.get("MSFT")?.totalCost).toBe(10000);
  });

  it("should create position with default cash of zero", () => {
    const symbols = ["AAPL"];
    const position = createEqualWeightedPosition(symbols, 50);

    expect(position.cash).toBe(0);
    expect(position.long.size).toBe(1);
    expect(position.long.get("AAPL")?.quantity).toBe(50);
  });

  it("should handle single symbol", () => {
    const position = createEqualWeightedPosition(["AAPL"], 100, 1000);

    expect(position.cash).toBe(1000);
    expect(position.long.size).toBe(1);
    expect(position.long.get("AAPL")?.quantity).toBe(100);
  });

  it("should handle empty symbols array", () => {
    const position = createEqualWeightedPosition([], 100, 5000);

    expect(position.cash).toBe(5000);
    expect(position.long).toBeUndefined();
  });

  it("should create position with zero shares", () => {
    const position = createEqualWeightedPosition(["AAPL", "GOOGL"], 0, 10000);

    expect(position.cash).toBe(10000);
    expect(position.long.size).toBe(2);
    expect(position.long.get("AAPL")?.quantity).toBe(0);
    expect(position.long.get("GOOGL")?.quantity).toBe(0);
  });
});

describe("createLinearWeightedPosition", () => {
  it("should create position with linearly increasing shares", () => {
    const symbols = ["AAPL", "GOOGL", "MSFT"];
    const position = createLinearWeightedPosition(symbols, 100, 10, 2000);

    expect(position.cash).toBe(2000);
    expect(position.long.size).toBe(3);

    // Business logic: shares increase linearly: base, base+step, base+2*step
    expect(position.long.get("AAPL")?.quantity).toBe(100); // 100 + 0*10
    expect(position.long.get("GOOGL")?.quantity).toBe(110); // 100 + 1*10
    expect(position.long.get("MSFT")?.quantity).toBe(120); // 100 + 2*10

    expect(position.long.get("AAPL")?.totalCost).toBe(10000); // 100 * $100
    expect(position.long.get("GOOGL")?.totalCost).toBe(11000); // 110 * $100
    expect(position.long.get("MSFT")?.totalCost).toBe(12000); // 120 * $100
  });

  it("should create position with default cash of zero", () => {
    const symbols = ["AAPL", "GOOGL"];
    const position = createLinearWeightedPosition(symbols, 50, 10);

    expect(position.cash).toBe(0);
    expect(position.long.size).toBe(2);
    expect(position.long.get("AAPL")?.quantity).toBe(50);
    expect(position.long.get("GOOGL")?.quantity).toBe(60);
  });

  it("should handle negative step for decreasing weights", () => {
    const symbols = ["AAPL", "GOOGL", "MSFT"];
    const position = createLinearWeightedPosition(symbols, 100, -10);

    // Business logic: shares decrease linearly
    expect(position.long.get("AAPL")?.quantity).toBe(100); // 100 + 0*(-10)
    expect(position.long.get("GOOGL")?.quantity).toBe(90); // 100 + 1*(-10)
    expect(position.long.get("MSFT")?.quantity).toBe(80); // 100 + 2*(-10)
  });

  it("should handle zero step for equal weighting", () => {
    const symbols = ["AAPL", "GOOGL"];
    const position = createLinearWeightedPosition(symbols, 100, 0);

    expect(position.long.get("AAPL")?.quantity).toBe(100);
    expect(position.long.get("GOOGL")?.quantity).toBe(100);
  });

  it("should handle single symbol", () => {
    const position = createLinearWeightedPosition(["AAPL"], 100, 10);

    expect(position.long.size).toBe(1);
    expect(position.long.get("AAPL")?.quantity).toBe(100);
  });

  it("should handle empty symbols array", () => {
    const position = createLinearWeightedPosition([], 100, 10, 5000);

    expect(position.cash).toBe(5000);
    expect(position.long).toBeUndefined();
  });
});

describe("createExpWeightedPosition", () => {
  it("should create position with exponentially increasing shares", () => {
    const symbols = ["AAPL", "GOOGL", "MSFT"];
    const position = createExpWeightedPosition(symbols, 100, 0.1, 3000);

    expect(position.cash).toBe(3000);
    expect(position.long.size).toBe(3);

    // Business logic: shares grow exponentially: base*(1+growth)^i
    expect(position.long.get("AAPL")?.quantity).toBe(100); // 100 * (1.1)^0 = 100
    expect(position.long.get("GOOGL")?.quantity).toBe(110); // 100 * (1.1)^1 = 110
    expect(position.long.get("MSFT")?.quantity).toBe(121); // 100 * (1.1)^2 = 121

    expect(position.long.get("AAPL")?.totalCost).toBe(10000);
    expect(position.long.get("GOOGL")?.totalCost).toBe(11000);
    expect(position.long.get("MSFT")?.totalCost).toBe(12100);
  });

  it("should create position with default cash of zero", () => {
    const symbols = ["AAPL", "GOOGL"];
    const position = createExpWeightedPosition(symbols, 100, 0.2);

    expect(position.cash).toBe(0);
    expect(position.long.size).toBe(2);
    expect(position.long.get("AAPL")?.quantity).toBe(100); // 100 * (1.2)^0
    expect(position.long.get("GOOGL")?.quantity).toBe(120); // 100 * (1.2)^1
  });

  it("should handle zero growth for equal weighting", () => {
    const symbols = ["AAPL", "GOOGL", "MSFT"];
    const position = createExpWeightedPosition(symbols, 100, 0);

    // Business logic: zero growth means all positions are base amount
    expect(position.long.get("AAPL")?.quantity).toBe(100);
    expect(position.long.get("GOOGL")?.quantity).toBe(100);
    expect(position.long.get("MSFT")?.quantity).toBe(100);
  });

  it("should handle negative growth for decreasing weights", () => {
    const symbols = ["AAPL", "GOOGL", "MSFT"];
    const position = createExpWeightedPosition(symbols, 100, -0.1);

    // Business logic: shares decrease exponentially
    expect(position.long.get("AAPL")?.quantity).toBe(100); // 100 * (0.9)^0 = 100
    expect(position.long.get("GOOGL")?.quantity).toBe(90); // 100 * (0.9)^1 = 90
    expect(position.long.get("MSFT")?.quantity).toBe(81); // 100 * (0.9)^2 = 81
  });

  it("should handle large growth rate", () => {
    const symbols = ["AAPL", "GOOGL"];
    const position = createExpWeightedPosition(symbols, 10, 1);

    // Business logic: 100% growth doubles each position
    expect(position.long.get("AAPL")?.quantity).toBe(10); // 10 * (2)^0
    expect(position.long.get("GOOGL")?.quantity).toBe(20); // 10 * (2)^1
  });

  it("should handle single symbol", () => {
    const position = createExpWeightedPosition(["AAPL"], 100, 0.5);

    expect(position.long.size).toBe(1);
    expect(position.long.get("AAPL")?.quantity).toBe(100);
  });

  it("should handle empty symbols array", () => {
    const position = createExpWeightedPosition([], 100, 0.2, 8000);

    expect(position.cash).toBe(8000);
    expect(position.long).toBeUndefined();
  });

  it("should round fractional shares to integers", () => {
    const symbols = ["AAPL", "GOOGL"];
    const position = createExpWeightedPosition(symbols, 100, 0.15);

    // Business logic: 100 * 1.15^1 = 115 (exact), ensures rounding works
    expect(position.long.get("AAPL")?.quantity).toBe(100);
    expect(position.long.get("GOOGL")?.quantity).toBe(115);
  });

  it("should handle very large exponential growth", () => {
    const symbols = ["AAPL", "GOOGL", "MSFT"];
    const position = createExpWeightedPosition(symbols, 10, 2);

    // Business logic: 200% growth triples each position
    expect(position.long.get("AAPL")?.quantity).toBe(10); // 10 * 3^0
    expect(position.long.get("GOOGL")?.quantity).toBe(30); // 10 * 3^1
    expect(position.long.get("MSFT")?.quantity).toBe(90); // 10 * 3^2
  });
});
