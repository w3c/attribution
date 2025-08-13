import type { AttributionImpressionOptions } from "./index";

import { parseSaveImpressionHeader } from "./http";

import { strict as assert } from "assert";
import test from "node:test";

interface TestCase {
  name: string;
  input: string;
  expected?: AttributionImpressionOptions;
}

function runTests(cases: readonly TestCase[]): void {
  void test("parseSaveImpression", async (t) => {
    await Promise.all(
      cases.map((tc) =>
        t.test(tc.name, () => {
          if (tc.expected) {
            const actual = parseSaveImpressionHeader(tc.input);
            assert.deepEqual(actual, tc.expected);
          } else {
            assert.throws(() => parseSaveImpressionHeader(tc.input));
          }
        }),
      ),
    );
  });
}

runTests([
  {
    name: "valid-minimal",
    input: "histogram-index=123",
    expected: {
      histogramIndex: 123,
      matchValue: 0,
      conversionSites: [],
      conversionCallers: [],
      lifetimeDays: 30,
      priority: 0,
    },
  },

  {
    name: "valid-maximal",
    input: `histogram-index=123;x, match-value=4, conversion-sites=("b" "a";y);z, conversion-callers=("c"), lifetime-days=5, priority=-6, octopus=?1`,
    expected: {
      histogramIndex: 123,
      matchValue: 4,
      conversionSites: ["b", "a"],
      conversionCallers: ["c"],
      lifetimeDays: 5,
      priority: -6,
    },
  },

  {
    name: "valid-empty-sites",
    input: "histogram-index=1, conversion-sites=(), conversion-callers=()",
    expected: {
      histogramIndex: 1,
      matchValue: 0,
      conversionSites: [],
      conversionCallers: [],
      lifetimeDays: 30,
      priority: 0,
    },
  },

  { name: "histogram-index-missing", input: "" },
  { name: "histogram-index-wrong-type", input: "histogram-index=a" },
  { name: "histogram-index-negative", input: "histogram-index=-1" },
  { name: "histogram-index-not-integer", input: "histogram-index=1.2" },

  {
    name: `conversion-sites-wrong-type`,
    input: `conversion-sites=a, histogram-index=1`,
  },
  {
    name: `conversion-sites-item-wrong-type`,
    input: `conversion-sites=(a), histogram-index=1`,
  },

  {
    name: `conversion-callers-wrong-type`,
    input: `conversion-callers=a, histogram-index=1`,
  },
  {
    name: `conversion-callers-item-wrong-type`,
    input: `conversion-callers=(a), histogram-index=1`,
  },

  { name: `match-value-wrong-type`, input: `match-value=a, histogram-index=1` },
  { name: `match-value-negative`, input: `match-value=-1, histogram-index=1` },
  {
    name: `match-value-not-integer`,
    input: `match-value=1.2, histogram-index=1`,
  },

  {
    name: `lifetime-days-wrong-type`,
    input: `lifetime-days=a, histogram-index=1`,
  },
  {
    name: `lifetime-days-negative`,
    input: `lifetime-days=-1, histogram-index=1`,
  },
  {
    name: `lifetime-days-not-integer`,
    input: `lifetime-days=1.2, histogram-index=1`,
  },
  { name: `lifetime-days-zero`, input: `lifetime-days=0, histogram-index=1` },

  { name: `priority-wrong-type`, input: `priority=a, histogram-index=1` },
  { name: `priority-not-integer`, input: `priority=1.2, histogram-index=1` },
]);
