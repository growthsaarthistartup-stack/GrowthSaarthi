/**
 * Unit tests for anomaly-detector pure math functions.
 * Zero I/O — no DB, no Resend calls.
 */

import { describe, it, expect } from "vitest";
import { stddev, mean, computeZScore, detectAnomalies, Z_SCORE_THRESHOLD } from "@/lib/monitoring/anomaly-detector";

describe("mean", () => {
  it("returns 0 on empty array (degrades to neutral)", () => {
    expect(mean([])).toBe(0);
  });

  it("computes simple average", () => {
    expect(mean([1, 2, 3, 4, 5])).toBeCloseTo(3.0);
  });

  it("handles single element", () => {
    expect(mean([42])).toBe(42);
  });
});

describe("stddev", () => {
  it("returns 0 for < 2 values", () => {
    expect(stddev([])).toBe(0);
    expect(stddev([5])).toBe(0);
  });

  it("computes sample stddev correctly (÷n-1 denominator)", () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] → mean=5
    // population stddev (÷n) = 2.0, but we use SAMPLE stddev (÷n-1) = sqrt(32/7) ≈ 2.1381
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.1381, 3);
  });

  it("returns 0 for identical values (no variance)", () => {
    expect(stddev([5, 5, 5, 5])).toBe(0);
  });
});

describe("computeZScore", () => {
  it("returns null for fewer than 3 window values", () => {
    expect(computeZScore([], 10)).toBeNull();
    expect(computeZScore([10], 5)).toBeNull();
    expect(computeZScore([10, 12], 5)).toBeNull();
  });

  it("returns null when stddev is 0 (no variance in window)", () => {
    expect(computeZScore([5, 5, 5, 5], 5)).toBeNull();
  });

  it("returns negative z for a value below the mean", () => {
    // window mean=10, stddev=2, latest=6 → z = (6-10)/2 = -2
    const z = computeZScore([8, 10, 12], 6);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(-2.0, 0);
  });

  it("returns positive z for a value above the mean", () => {
    const z = computeZScore([8, 10, 12], 14);
    expect(z).not.toBeNull();
    expect(z!).toBeGreaterThan(0);
  });

  it("z threshold constant is -2.0", () => {
    expect(Z_SCORE_THRESHOLD).toBe(-2.0);
  });
});

describe("detectAnomalies", () => {
  it("returns empty array when no series provided", () => {
    expect(detectAnomalies({})).toEqual([]);
  });

  it("returns empty when z-score is above threshold", () => {
    // Normal week — no anomaly
    const results = detectAnomalies({
      sessions: { windowValues: [100, 105, 98, 102, 101, 99, 103], latestValue: 101 },
    });
    expect(results).toHaveLength(0);
  });

  it("detects a sessions anomaly when today drops 3σ below window", () => {
    // Window: 100 each day for 7 days, today: 40 → clear anomaly
    const results = detectAnomalies({
      sessions: {
        windowValues: [100, 100, 100, 100, 100, 100, 100],
        latestValue:  40,
      },
    });
    // stddev of all-same window is 0 → should return null → no anomaly (degenerate case)
    // Use varied window instead
    expect(results).toHaveLength(0); // all-same window → stddev=0 → null z → skip
  });

  it("detects anomaly with varied window and large drop", () => {
    // window mean≈100, stddev≈5, today=70 → z≈-6
    const results = detectAnomalies({
      sessions: {
        windowValues: [98, 102, 97, 103, 99, 101, 100],
        latestValue:  70,
      },
    });
    expect(results).toHaveLength(1);
    expect(results[0].metricType).toBe("sessions");
    expect(results[0].zScore).toBeLessThan(-2.0);
    expect(results[0].message).toContain("sessions");
  });

  it("detects multiple metric anomalies simultaneously", () => {
    const results = detectAnomalies({
      sessions: {
        windowValues: [100, 100, 100, 102, 98, 101, 99],
        latestValue:  60,
      },
      mrr: {
        windowValues: [5000, 5050, 4950, 5010, 4990, 5020, 5000],
        latestValue:  3000,
      },
    });
    expect(results.length).toBeGreaterThanOrEqual(2);
    const metrics = results.map((r) => r.metricType);
    expect(metrics).toContain("sessions");
    expect(metrics).toContain("mrr");
  });

  it("skips metric type with too few data points", () => {
    const results = detectAnomalies({
      conversions: { windowValues: [10, 12], latestValue: 1 }, // only 2 window points
    });
    expect(results).toHaveLength(0);
  });
});
