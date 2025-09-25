import type { AttributionImpressionOptions } from "./index";

import type { Dictionary } from "structured-headers";

import { parseDictionary } from "structured-headers";

const MAX_UINT32: number = 4294967295;

const MIN_INT32: number = -2147483648;
const MAX_INT32: number = 2147483647;

function parseInnerListOfSites(dict: Dictionary, key: string): string[] {
  const [values] = dict.get(key) ?? [[]];
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

  const [histogramIndex] = dict.get("histogram-index") ?? [undefined];
  if (
    typeof histogramIndex !== "number" ||
    !Number.isInteger(histogramIndex) ||
    histogramIndex < 0 ||
    histogramIndex > MAX_UINT32
  ) {
    throw new RangeError(
      "histogram-index must be an integer in the 32-bit unsigned range",
    );
  }

  const conversionSites = parseInnerListOfSites(dict, "conversion-sites");
  const conversionCallers = parseInnerListOfSites(dict, "conversion-callers");

  const [matchValue] = dict.get("match-value") ?? [0];
  if (
    typeof matchValue !== "number" ||
    !Number.isInteger(matchValue) ||
    matchValue < 0 ||
    matchValue > MAX_UINT32
  ) {
    throw new RangeError(
      "match-value must be an integer in the 32-bit unsigned range",
    );
  }

  let [lifetimeDays] = dict.get("lifetime-days") ?? [30];
  if (
    typeof lifetimeDays !== "number" ||
    !Number.isInteger(lifetimeDays) ||
    lifetimeDays <= 0
  ) {
    throw new RangeError("lifetime-days must be a positive integer");
  }

  if (lifetimeDays > MAX_UINT32) {
    lifetimeDays = MAX_UINT32;
  }

  const [priority] = dict.get("priority") ?? [0];
  if (
    typeof priority !== "number" ||
    !Number.isInteger(priority) ||
    priority < MIN_INT32 ||
    priority > MAX_INT32
  ) {
    throw new RangeError(
      "priority must be an integer in the 32-bit signed range",
    );
  }

  return {
    histogramIndex,
    matchValue,
    conversionSites,
    conversionCallers,
    lifetimeDays,
    priority,
  };
}
