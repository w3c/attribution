import type { AttributionImpressionOptions } from "./index";

import * as http from "./http";

import { strict as assert } from "assert";
import test from "node:test";

interface TestCase<T> {
  name: string;
  input: string;
  expected?: T;
}

async function runTests<T>(
  t: test.TestContext,
  parse: (input: string) => T,
  cases: readonly TestCase<T>[],
): Promise<void> {
  await Promise.all(
    cases.map((tc) =>
      t.test(tc.name, () => {
        if (tc.expected) {
          const actual = parse(tc.input);
          assert.deepEqual(actual, tc.expected);
        } else {
          assert.throws(() => parse(tc.input));
        }
      }),
    ),
  );
}

const impressionTests: TestCase<AttributionImpressionOptions>[] = [
  { name: "invalid-structured-header-syntax", input: "!" },
  { name: "not-structured-header-dictionary", input: "histogram-index" },
  { name: "a-different-type", input: "10" },

  {
    name: "valid-minimal",
    input: "histogram-index=123",
    expected: {
      histogramIndex: 123,
      matchValue: undefined,
      conversionSites: undefined,
      conversionCallers: undefined,
      lifetimeDays: undefined,
      priority: undefined,
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
      matchValue: undefined,
      conversionSites: [],
      conversionCallers: [],
      lifetimeDays: undefined,
      priority: undefined,
    },
  },

  { name: "histogram-index-missing", input: "" },
  { name: "histogram-index-wrong-type", input: "histogram-index=a" },
  { name: "histogram-index-negative", input: "histogram-index=-1" },
  { name: "histogram-index-not-integer", input: "histogram-index=1.2" },

  {
    name: "valid-histogram-index-eq-32-bit-max",
    input: "histogram-index=4294967295",
    expected: {
      histogramIndex: 4294967295,
      matchValue: undefined,
      conversionSites: undefined,
      conversionCallers: undefined,
      lifetimeDays: undefined,
      priority: undefined,
    },
  },
  {
    name: "histogram-index-gt-32-bit-max",
    input: "histogram-index=4294967296",
  },

  {
    name: "conversion-sites-wrong-type",
    input: "conversion-sites=a, histogram-index=1",
  },
  {
    name: "conversion-sites-item-wrong-type",
    input: "conversion-sites=(a), histogram-index=1",
  },

  {
    name: "conversion-callers-wrong-type",
    input: "conversion-callers=a, histogram-index=1",
  },
  {
    name: "conversion-callers-item-wrong-type",
    input: "conversion-callers=(a), histogram-index=1",
  },

  { name: "match-value-wrong-type", input: "match-value=a, histogram-index=1" },
  { name: "match-value-negative", input: "match-value=-1, histogram-index=1" },
  {
    name: "match-value-not-integer",
    input: "match-value=1.2, histogram-index=1",
  },
  {
    name: "valid-match-value-eq-32-bit-max",
    input: "match-value=4294967295, histogram-index=1",
    expected: {
      histogramIndex: 1,
      matchValue: 4294967295,
      conversionSites: undefined,
      conversionCallers: undefined,
      lifetimeDays: undefined,
      priority: undefined,
    },
  },
  {
    name: "match-value-gt-32-bit-max",
    input: "match-value=4294967296, histogram-index=1",
  },

  {
    name: "lifetime-days-wrong-type",
    input: "lifetime-days=a, histogram-index=1",
  },
  {
    name: "lifetime-days-negative",
    input: "lifetime-days=-1, histogram-index=1",
  },
  {
    name: "lifetime-days-not-integer",
    input: "lifetime-days=1.2, histogram-index=1",
  },
  { name: "lifetime-days-zero", input: "lifetime-days=0, histogram-index=1" },
  {
    name: "valid-lifetime-days-maximal",
    input: "lifetime-days=999999999999999, histogram-index=1",
    expected: {
      histogramIndex: 1,
      matchValue: undefined,
      conversionSites: undefined,
      conversionCallers: undefined,
      lifetimeDays: 999999999999999,
      priority: undefined,
    },
  },

  { name: "priority-wrong-type", input: "priority=a, histogram-index=1" },
  { name: "priority-not-integer", input: "priority=1.2, histogram-index=1" },
  {
    name: "valid-priority-eq-32-bit-max",
    input: "priority=2147483647, histogram-index=1",
    expected: {
      histogramIndex: 1,
      matchValue: undefined,
      conversionSites: undefined,
      conversionCallers: undefined,
      lifetimeDays: undefined,
      priority: 2147483647,
    },
  },
  {
    name: "valid-priority-eq-32-bit-min",
    input: "priority=-2147483648, histogram-index=1",
    expected: {
      histogramIndex: 1,
      matchValue: undefined,
      conversionSites: undefined,
      conversionCallers: undefined,
      lifetimeDays: undefined,
      priority: -2147483648,
    },
  },
  {
    name: "priority-gt-32-bit-max",
    input: "priority=2147483648, histogram-index=1",
  },
  {
    name: "priority-lt-32-bit-min",
    input: "priority=-2147483649, histogram-index=1",
  },
];

void test("parseSaveImpressionHeader", (t) =>
  runTests(t, http.parseSaveImpressionHeader, impressionTests));

const baseURL = new URL("https://base.example/abc/");

const conversionTests: TestCase<http.ParsedMeasureConversionHeader>[] = [
  { name: "invalid-structured-header-syntax", input: "!" },
  { name: "not-structured-header-dictionary", input: "aggregation-service" },
  { name: "a-different-type", input: "10" },

  {
    name: "valid-minimal",
    input: `aggregation-service="", histogram-size=1, report-url="https://r.example"`,
    expected: [
      {
        aggregationService: "",
        histogramSize: 1,

        credit: undefined,
        epsilon: undefined,
        impressionCallers: undefined,
        impressionSites: undefined,
        lookbackDays: undefined,
        matchValues: undefined,
        maxValue: undefined,
        value: undefined,
      },
      new URL("https://r.example"),
    ],
  },

  {
    name: "valid-maximal",
    input: `aggregation-service="foo", histogram-size=1, report-url="https://r.example/bar?x=y", epsilon=2.1, value=4, max-value=3, lookback-days=5, match-values=(0 6), credit=(0 0.5 0.25), impression-callers=("a" "b"), impression-sites=("c")`,
    expected: [
      {
        aggregationService: "foo",
        histogramSize: 1,
        epsilon: 2.1,
        value: 4,
        maxValue: 3,
        lookbackDays: 5,
        matchValues: [0, 6],
        credit: [0, 0.5, 0.25],
        impressionCallers: ["a", "b"],
        impressionSites: ["c"],
      },
      new URL("https://r.example/bar?x=y"),
    ],
  },

  {
    name: "valid-empty-lists",
    input: `credit=(), impression-sites=(), impression-callers=(), match-values=(), aggregation-service="", histogram-size=1, report-url="https://r.example"`,
    expected: [
      {
        credit: [],
        impressionSites: [],
        impressionCallers: [],
        matchValues: [],
        aggregationService: "",
        histogramSize: 1,

        epsilon: undefined,
        lookbackDays: undefined,
        maxValue: undefined,
        value: undefined,
      },
      new URL("https://r.example"),
    ],
  },

  {
    name: "aggregation-service-missing",
    input: `histogram-size=1, report-url="https://r.example/"`,
  },
  {
    name: "aggregation-service-wrong-type",
    input: `aggregation-service=a, histogram-size=1, report-url="https://r.example"`,
  },

  {
    name: "histogram-size-missing",
    input: `aggregation-service="", report-url="https://r.example"`,
  },
  {
    name: "histogram-size-wrong-type",
    input: `histogram-size=a, aggregation-service="", report-url="https://r.example"`,
  },
  {
    name: "histogram-size-zero",
    input: `histogram-size=0, aggregation-service="", report-url="https://r.example"`,
  },
  {
    name: "histogram-size-negative",
    input: `histogram-size=-1, aggregation-service="", report-url="https://r.example"`,
  },
  {
    name: "histogram-size-not-integer",
    input: `histogram-size=1.2, aggregation-service="", report-url="https://r.example"`,
  },
  {
    name: "valid-histogram-size-eq-32-bit-max",
    input: `histogram-size=4294967295, aggregation-service="", report-url="https://r.example"`,
    expected: [
      {
        histogramSize: 4294967295,
        aggregationService: "",

        credit: undefined,
        epsilon: undefined,
        impressionCallers: undefined,
        impressionSites: undefined,
        lookbackDays: undefined,
        matchValues: undefined,
        maxValue: undefined,
        value: undefined,
      },
      new URL("https://r.example"),
    ],
  },
  {
    name: "histogram-size-gt-32-bit-max",
    input: `histogram-size=4294967296, aggregation-service="", report-url="https://r.example"`,
  },

  {
    name: "report-url-missing",
    input: `aggregation-service="foo", histogram-size=1`,
  },
  {
    name: "report-url-wrong-type",
    input: `report-url=a, aggregation-service="", histogram-size=1`,
  },
  {
    name: "report-url-bad-url-syntax",
    input: `report-url="https://:", aggregation-service="", histogram-size=1`,
  },
  {
    name: "report-url-invalid-scheme",
    input: `report-url="http://r.example", aggregation-service="", histogram-size=1`,
  },
  {
    name: "valid-report-url-relative",
    input: `report-url="xyz", aggregation-service="", histogram-size=1`,
    expected: [
      {
        aggregationService: "",
        histogramSize: 1,

        credit: undefined,
        epsilon: undefined,
        impressionCallers: undefined,
        impressionSites: undefined,
        lookbackDays: undefined,
        matchValues: undefined,
        maxValue: undefined,
        value: undefined,
      },
      new URL("https://base.example/abc/xyz"),
    ],
  },

  {
    name: "epsilon-wrong-type",
    input: `epsilon=a, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "valid-epsilon-integer",
    input: `epsilon=2, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
    expected: [
      {
        epsilon: 2,
        aggregationService: "",
        histogramSize: 1,

        credit: undefined,
        impressionCallers: undefined,
        impressionSites: undefined,
        lookbackDays: undefined,
        matchValues: undefined,
        maxValue: undefined,
        value: undefined,
      },
      new URL("https://r.example"),
    ],
  },

  {
    name: "lookback-days-wrong-type",
    input: `lookback-days=a, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "lookback-days-zero",
    input: `lookback-days=0, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "lookback-days-negative",
    input: `lookback-days=-1, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "lookback-days-not-integer",
    input: `lookback-days=1.2, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "valid-lookback-days-maximal",
    input: `lookback-days=999999999999999, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
    expected: [
      {
        lookbackDays: 999999999999999,
        aggregationService: "",
        histogramSize: 1,

        credit: undefined,
        epsilon: undefined,
        impressionCallers: undefined,
        impressionSites: undefined,
        matchValues: undefined,
        maxValue: undefined,
        value: undefined,
      },
      new URL("https://r.example"),
    ],
  },

  {
    name: "match-values-wrong-type",
    input: `match-values=a, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "match-values-item-wrong-type",
    input: `match-values=(a), aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "match-values-item-negative",
    input: `match-values=(-1), aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "match-values-item-not-integer",
    input: `match-values=(1.2), aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "valid-value-item-eq-32-bit-max",
    input: `match-values=(4294967295), aggregation-service="", histogram-size=1, report-url="https://r.example"`,
    expected: [
      {
        matchValues: [4294967295],
        aggregationService: "",
        histogramSize: 1,

        credit: undefined,
        epsilon: undefined,
        impressionCallers: undefined,
        impressionSites: undefined,
        lookbackDays: undefined,
        maxValue: undefined,
        value: undefined,
      },
      new URL("https://r.example"),
    ],
  },
  {
    name: "match-values-item-gt-32-bit-max",
    input: `match-values=(4294967296), aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },

  {
    name: "impression-sites-wrong-type",
    input: `impression-sites=a, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "impression-sites-item-wrong-type",
    input: `impression-sites=(a), aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },

  {
    name: "impression-callers-wrong-type",
    input: `impression-callers=a, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "impression-callers-item-wrong-type",
    input: `impression-callers=(a), aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },

  {
    name: "credit-wrong-type",
    input: `credit=a, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "credit-item-wrong-type",
    input: `credit=(a), aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },

  {
    name: "value-wrong-type",
    input: `value=a, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "value-zero",
    input: `value=0, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "value-negative",
    input: `value=-1, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "value-not-integer",
    input: `value=1.2, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "valid-value-eq-32-bit-max",
    input: `value=4294967295, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
    expected: [
      {
        value: 4294967295,
        aggregationService: "",
        histogramSize: 1,

        credit: undefined,
        epsilon: undefined,
        impressionCallers: undefined,
        impressionSites: undefined,
        lookbackDays: undefined,
        matchValues: undefined,
        maxValue: undefined,
      },
      new URL("https://r.example"),
    ],
  },
  {
    name: "value-gt-32-bit-max",
    input: `value=4294967296, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },

  {
    name: "max-value-wrong-type",
    input: `max-value=a, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "max-value-zero",
    input: `max-value=0, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "max-value-negative",
    input: `max-value=-1, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "max-value-not-integer",
    input: `max-value=1.2, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
  {
    name: "valid-max-value-eq-32-bit-max",
    input: `max-value=4294967295, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
    expected: [
      {
        maxValue: 4294967295,
        aggregationService: "",
        histogramSize: 1,

        credit: undefined,
        epsilon: undefined,
        impressionCallers: undefined,
        impressionSites: undefined,
        lookbackDays: undefined,
        matchValues: undefined,
        value: undefined,
      },
      new URL("https://r.example"),
    ],
  },
  {
    name: "max-value-gt-32-bit-max",
    input: `max-value=4294967296, aggregation-service="", histogram-size=1, report-url="https://r.example"`,
  },
];

void test("parseMeasureConversionHeader", (t) =>
  runTests(
    t,
    (input) => http.parseMeasureConversionHeader(input, baseURL),
    conversionTests,
  ));
