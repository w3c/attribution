import { fairlyAllocateCredit } from "./backend";

import { strict as assert } from "node:assert";
import test from "node:test";
import { inverseErrorFunction } from "simple-statistics";

interface FairlyAllocateCreditTestCase {
  name: string;
  credit: number[];
  value: number;
  needsRand?: boolean;
}

function noRand(): number {
  throw new Error("no rand expected");
}

type Interval = [min: number, max: number];

// https://en.wikipedia.org/wiki/Probit
function normalPpf(q: number, stdDev: number): number {
  return stdDev * Math.sqrt(2) * inverseErrorFunction(2 * q - 1);
}

const minNForIntervalApprox = 1000;

function getIntervalApprox(n: number, p: number, alpha: number): Interval {
  if (n < minNForIntervalApprox) {
    throw new RangeError(`n must be >= ${minNForIntervalApprox}`);
  }

  // Approximates a binomial distribution with a normal distribution which is a bit
  // simpler as it is symmetric.
  const mean = n * p;
  const variance = mean * (1 - p);
  const diff = normalPpf(1 - alpha / 2, Math.sqrt(variance));
  return [mean - diff, mean + diff];
}

function getAllIntervals(
  n: number,
  creditFractions: readonly number[],
  alphaTotal: number,
): Interval[] {
  // We are testing one hypothesis per dimension, so divide `alphaTotal` by
  // the number of dimensions: https://en.wikipedia.org/wiki/Bonferroni_correction
  const alpha = alphaTotal / creditFractions.length;
  return creditFractions.map((cf) => getIntervalApprox(n, cf, alpha));
}

function runFairlyAllocateCreditTest(
  tc: Readonly<FairlyAllocateCreditTestCase>,
): void {
  // TODO: replace with precise sum
  const sumCredit = tc.credit.reduce((a, b) => a + b, 0);
  const normalizedFloatCredit = tc.credit.map((item) => item / sumCredit);

  const [rand, k] = tc.needsRand ? [Math.random, 1000] : [noRand, 1];

  const totals = new Array<number>(tc.credit.length).fill(0);

  for (let n = 0; n < k; ++n) {
    const actualCredit = fairlyAllocateCredit(tc.credit, tc.value, rand);

    assert.equal(actualCredit.length, tc.credit.length);

    for (const [j, actual] of actualCredit.entries()) {
      assert.ok(Number.isInteger(actual));

      const normalized = normalizedFloatCredit[j]! * tc.value;
      const diff = Math.abs(actual - normalized);
      assert.ok(
        diff < 1,
        `credit error >= 1: actual=${actual}, normalized=${normalized}`,
      );

      totals[j]! += actual / tc.value;
    }

    assert.equal(
      // TODO: replace with precise sum
      actualCredit.reduce((a, b) => a + b, 0),
      tc.value,
      `actual credit does not sum to value: ${actualCredit.join(", ")}`,
    );
  }

  const alpha = 0.00001; // Probability of test failing at random.

  const intervals: Interval[] =
    k > 1
      ? getAllIntervals(
          k,
          normalizedFloatCredit.map((c) => c - Math.floor(c)),
          alpha,
        )
      : normalizedFloatCredit.map((c) => [c, c]);

  for (const [j, total] of totals.entries()) {
    const [min, max] = intervals[j]!;
    assert.ok(
      total >= min && total <= max,
      `total for credit[${j}] ${total} not in ${1 - alpha} confidence interval [${min}, ${max}]`,
    );
  }
}

const testCases: FairlyAllocateCreditTestCase[] = [
  {
    name: "credit-equal-to-value",
    credit: [1],
    value: 1,
    needsRand: false,
  },
  {
    name: "credit-less-than-value",
    credit: [2],
    value: 3,
    needsRand: false,
  },
  {
    name: "credit-less-than-1",
    credit: [0.25],
    value: 4,
    needsRand: false,
  },
  {
    name: "2-credit-divides-value-evenly",
    credit: [3, 1],
    value: 8,
    needsRand: false,
  },
  {
    name: "3-credit-divides-value-evenly",
    credit: [2, 1, 1],
    value: 8,
    needsRand: false,
  },
  {
    name: "2-credit-divides-value-unevenly",
    credit: [1, 1],
    value: 5,
    needsRand: true,
  },
  {
    name: "3-credit-divides-value-unevenly",
    credit: [2, 1, 1],
    value: 5,
    needsRand: true,
  },
];

void test("fairly-allocate-credit", async (t) => {
  await Promise.all(
    testCases.map((tc) =>
      t.test(tc.name, () => runFairlyAllocateCreditTest(tc)),
    ),
  );
});
