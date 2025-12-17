import type {
  AttributionConversionOptions,
  AttributionImpressionOptions,
} from "./index";

import type { BareItem, Dictionary, Item } from "structured-headers";

import { parseDictionary } from "structured-headers";

const MAX_UINT32: number = 4294967295;

const MIN_INT32: number = -2147483648;
const MAX_INT32: number = 2147483647;

function get(dict: Dictionary, key: string): BareItem | Item[] | undefined {
  const [value] = dict.get(key) ?? [undefined];
  return value;
}

function getInteger(dict: Dictionary, key: string): number | undefined {
  const value = get(dict, key);
  if (value === undefined) {
    return value;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${key} must be an integer`);
  }

  return value;
}

function get32BitUnsignedInteger(
  dict: Dictionary,
  key: string,
): number | undefined {
  const value = getInteger(dict, key);
  if (value === undefined) {
    return value;
  }

  if (value < 0 || value > MAX_UINT32) {
    throw new RangeError(`${key} must be in the 32-bit unsigned range`);
  }

  return value;
}

function getPositive32BitUnsignedInteger(
  dict: Dictionary,
  key: string,
): number | undefined {
  const value = get32BitUnsignedInteger(dict, key);
  if (value === undefined) {
    return value;
  }

  if (value === 0) {
    throw new RangeError(`${key} must be positive`);
  }

  return value;
}

function parseInnerList<T>(
  dict: Dictionary,
  key: string,
  parseItem: (i: number, value: BareItem) => T,
): T[] | undefined {
  const values = get(dict, key);
  if (values === undefined) {
    return values;
  }

  if (!Array.isArray(values)) {
    throw new TypeError(`${key} must be an inner list`);
  }

  const result = [];
  for (const [i, [value]] of values.entries()) {
    result.push(parseItem(i, value));
  }
  return result;
}

function parseInnerListOfSites(
  dict: Dictionary,
  key: string,
): string[] | undefined {
  return parseInnerList(dict, key, (i, value) => {
    if (typeof value !== "string") {
      throw new TypeError(`${key}[${i}] must be a string`);
    }
    return value;
  });
}

function validate32BitUnsignedInteger(
  value: BareItem | Item[] | undefined,
  errPrefix: string,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_UINT32
  ) {
    throw new RangeError(
      `${errPrefix} must be an integer in the 32-bit unsigned range`,
    );
  }
}

function validatePositiveInteger(
  value: BareItem | Item[] | undefined,
  errPrefix: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${errPrefix} must be a positive integer`);
  }
}

export function parseSaveImpressionHeader(
  input: string,
): AttributionImpressionOptions {
  const dict = parseDictionary(input);

  const histogramIndex = get32BitUnsignedInteger(dict, "histogram-index");
  if (histogramIndex === undefined) {
    throw new TypeError("histogram-index is required");
  }

  const opts: AttributionImpressionOptions = { histogramIndex };

  opts.conversionSites = parseInnerListOfSites(dict, "conversion-sites");
  opts.conversionCallers = parseInnerListOfSites(dict, "conversion-callers");

  opts.matchValue = get32BitUnsignedInteger(dict, "match-value");

  opts.lifetimeDays = getInteger(dict, "lifetime-days");
  if (opts.lifetimeDays !== undefined && opts.lifetimeDays <= 0) {
    throw new RangeError("lifetime-days must be positive");
  }

  opts.priority = getInteger(dict, "priority");
  if (
    opts.priority !== undefined &&
    (opts.priority < MIN_INT32 || opts.priority > MAX_INT32)
  ) {
    throw new RangeError("priority must be in the 32-bit signed range");
  }

  return opts;
}

export type ParsedMeasureConversionHeader = [
  opts: AttributionConversionOptions,
  reportUrl: URL,
];

export function parseMeasureConversionHeader(
  input: string,
  baseUrl: URL,
): ParsedMeasureConversionHeader {
  const dict = parseDictionary(input);

  const aggregationService = get(dict, "aggregation-service");
  if (aggregationService === undefined) {
    throw new TypeError("aggregation-service is required");
  }
  if (typeof aggregationService !== "string") {
    throw new TypeError("aggregation-service must be a string");
  }

  const histogramSize = getPositive32BitUnsignedInteger(dict, "histogram-size");

  const reportUrlString = get(dict, "report-url");
  if (reportUrlString === undefined) {
    throw new TypeError("report-url is required");
  }
  if (typeof reportUrlString !== "string") {
    throw new TypeError("report-url must be a string");
  }
  const reportUrl = new URL(reportUrlString, baseUrl);
  // The specification requires reportUrl to be potentially trustworthy, but
  // there is no direct analogue of this in JS, so for now we let the protocol
  // check below suffice.
  if (reportUrl.protocol !== "https:") {
    throw new TypeError("report-url's scheme must be https");
  }

  const opts: AttributionConversionOptions = {
    aggregationService,
    histogramSize,
  };

  const epsilon = get(dict, "epsilon");
  if (epsilon !== undefined && typeof epsilon !== "number") {
    throw new TypeError("epsilon must be a decimal or an integer");
  }
  opts.epsilon = epsilon;

  const lookbackDays = get(dict, "lookback-days");
  if (lookbackDays !== undefined) {
    validatePositiveInteger(lookbackDays, "lookback-days");
  }
  opts.lookbackDays = lookbackDays;

  opts.matchValues = parseInnerList(dict, "match-values", (i, value) => {
    validate32BitUnsignedInteger(value, `match-values[${i}]`);
    return value;
  });

  opts.impressionSites = parseInnerListOfSites(dict, "impression-sites");
  opts.impressionCallers = parseInnerListOfSites(dict, "impression-callers");

  opts.credit = parseInnerList(dict, "credit", (i, value) => {
    if (typeof value !== "number") {
      throw new RangeError(`credit[${i}] must be a decimal or an integer`);
    }
    return value;
  });

  opts.value = getPositive32BitUnsignedInteger(dict, "value");
  opts.maxValue = getPositive32BitUnsignedInteger(dict, "max-value");

  return [opts, reportUrl];
}
