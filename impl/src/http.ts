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

function optional<T>(
  dict: Dictionary,
  key: string,
  f: (value: BareItem | Item[], errPrefix: string) => T,
): T | undefined {
  const value = get(dict, key);
  return value === undefined ? value : f(value, key);
}

function required<T>(
  dict: Dictionary,
  key: string,
  f: (value: BareItem | Item[], errPrefix: string) => T,
): T {
  const value = get(dict, key);
  if (value === undefined) {
    throw new TypeError(`${key} is required`);
  }
  return f(value, key);
}

function asInteger(value: BareItem | Item[], errPrefix: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${errPrefix} be an integer`);
  }
  return value;
}

function asDecimalOrInteger(
  value: BareItem | Item[],
  errPrefix: string,
): number {
  if (typeof value !== "number") {
    throw new TypeError(`${errPrefix} must be a decimal or an integer`);
  }
  return value;
}

function as32BitUnsignedInteger(
  value: BareItem | Item[],
  errPrefix: string,
): number {
  const integer = asInteger(value, errPrefix);
  if (integer < 0 || integer > MAX_UINT32) {
    throw new RangeError(`${errPrefix} must be in the 32-bit unsigned range`);
  }
  return integer;
}

function as32BitSignedInteger(
  value: BareItem | Item[],
  errPrefix: string,
): number {
  const integer = asInteger(value, errPrefix);
  if (integer < MIN_INT32 || integer > MAX_INT32) {
    throw new RangeError(`${errPrefix} must be in the 32-bit signed range`);
  }
  return integer;
}

function asPositive(value: number, errPrefix: string): number {
  if (value <= 0) {
    throw new TypeError(`${errPrefix} be positive`);
  }
  return value;
}

function asPositiveInteger(
  value: BareItem | Item[],
  errPrefix: string,
): number {
  return asPositive(asInteger(value, errPrefix), errPrefix);
}

function asPositive32BitUnsignedInteger(
  value: BareItem | Item[],
  errPrefix: string,
): number {
  return asPositive(as32BitUnsignedInteger(value, errPrefix), errPrefix);
}

function asString(value: BareItem | Item[], errPrefix: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${errPrefix} must be a string`);
  }
  return value;
}

function asInnerList<T>(
  values: BareItem | Item[],
  errPrefix: string,
  parseItem: (value: BareItem, errPrefix: string) => T,
): T[] {
  if (!Array.isArray(values)) {
    throw new TypeError(`${errPrefix} must be an inner list`);
  }
  return values.map(([value], i) => parseItem(value, `${errPrefix}[${i}]`));
}

function asInnerListOfStrings(
  values: BareItem | Item[],
  errPrefix: string,
): string[] {
  return asInnerList(values, errPrefix, asString);
}

export function parseSaveImpressionHeader(
  input: string,
): AttributionImpressionOptions {
  const dict = parseDictionary(input);

  return {
    histogramIndex: required(dict, "histogram-index", as32BitUnsignedInteger),
    conversionSites: optional(dict, "conversion-sites", asInnerListOfStrings),
    conversionCallers: optional(
      dict,
      "conversion-callers",
      asInnerListOfStrings,
    ),
    matchValue: optional(dict, "match-value", as32BitUnsignedInteger),
    lifetimeDays: optional(dict, "lifetime-days", asPositiveInteger),
    priority: optional(dict, "priority", as32BitSignedInteger),
  };
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

  const reportUrl = required(dict, "report-url", (value, errPrefix) => {
    const url = new URL(asString(value, errPrefix), baseUrl);
    // The specification requires reportUrl to be potentially trustworthy, but
    // there is no direct analogue of this in JS, so for now we let the protocol
    // check below suffice.
    if (url.protocol !== "https:") {
      throw new TypeError(`${errPrefix}'s scheme must be https`);
    }
    return url;
  });

  const opts = {
    aggregationService: required(dict, "aggregation-service", asString),
    histogramSize: required(
      dict,
      "histogram-size",
      asPositive32BitUnsignedInteger,
    ),
    epsilon: optional(dict, "epsilon", asDecimalOrInteger),
    lookbackDays: optional(dict, "lookback-days", asPositiveInteger),
    matchValues: optional(dict, "match-values", (values, errPrefix) =>
      asInnerList(values, errPrefix, as32BitUnsignedInteger),
    ),
    impressionSites: optional(dict, "impression-sites", asInnerListOfStrings),
    impressionCallers: optional(
      dict,
      "impression-callers",
      asInnerListOfStrings,
    ),
    credit: optional(dict, "credit", (values, errPrefix) =>
      asInnerList(values, errPrefix, asDecimalOrInteger),
    ),
    value: optional(dict, "value", asPositive32BitUnsignedInteger),
    maxValue: optional(dict, "max-value", asPositive32BitUnsignedInteger),
  };

  return [opts, reportUrl];
}
