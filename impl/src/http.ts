import type { AttributionImpressionOptions } from "./index";

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

function parseInnerListOfSites(
  dict: Dictionary,
  key: string,
): string[] | undefined {
  const values = get(dict, key);
  if (values === undefined) {
    return values;
  }

  if (!Array.isArray(values)) {
    throw new TypeError(`${key} must be an inner list`);
  }

  const sites = [];
  for (const [i, [value]] of values.entries()) {
    if (typeof value !== "string") {
      throw new TypeError(`${key}[${i}] must be a string`);
    }
    sites.push(value);
  }
  return sites;
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
