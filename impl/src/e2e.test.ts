import type {
  AttributionImpressionOptions,
  AttributionConversionOptions,
} from "./index";

import type { TestContext } from "node:test";

import { Backend, days } from "./backend";
import type { TestConfig } from "./fixture";

import { strict as assert } from "assert";
import { glob, readFile } from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import { Temporal } from "temporal-polyfill";

interface TestCase {
  config?: TestConfig;
  events: Event[];
}

type Event =
  | SaveImpression
  | MeasureConversion
  | ClearImpressionsForSite
  | ClearBrowsingHistoryForAttribution
  | EnableAPI
  | DisableAPI;

type ExpectedError =
  | "RangeError"
  | "ReferenceError"
  | {
      error: "DOMException";
      name: string;
    };

interface SaveImpression {
  event: "saveImpression";
  seconds: number;
  site: string;
  intermediarySite?: string | undefined;
  options: AttributionImpressionOptions;
  expectedError?: ExpectedError;
}

interface MeasureConversion {
  event: "measureConversion";
  seconds: number;
  site: string;
  intermediarySite?: string | undefined;
  options: AttributionConversionOptions;
  expected: number[] | ExpectedError;
}

interface ClearImpressionsForSite {
  event: "clearImpressionsForSite";
  seconds: number;
  site: string;
}

interface ClearBrowsingHistoryForAttribution {
  event: "clearBrowsingHistoryForAttribution";
  seconds: number;
  sites: string[];
  forgetVisits: boolean;
}

interface EnableAPI {
  event: "enableAPI";
  seconds: number;
}

interface DisableAPI {
  event: "disableAPI";
  seconds: number;
}

function assertThrows(
  call: () => unknown,
  expectedError: ExpectedError,
  seconds: number,
): void {
  const check =
    typeof expectedError === "string"
      ? { name: expectedError }
      : (err: unknown) => {
          assert.ok(err instanceof DOMException);
          assert.equal(err.name, expectedError.name);
          return true;
        };

  assert.throws(call, check, `seconds: ${seconds}`);
}

function runTest(
  defaultConfig: Readonly<TestConfig>,
  tc: Readonly<TestCase>,
): void {
  const config = tc.config ?? defaultConfig;

  let now = new Temporal.Instant(0n);

  const backend = new Backend({
    aggregationServices: new Map(
      Object.entries(config.aggregationServices).map(([url, protocol]) => [
        url,
        { protocol },
      ]),
    ),
    includeUnencryptedHistogram: true,

    maxConversionSitesPerImpression: config.maxConversionSitesPerImpression,
    maxConversionCallersPerImpression: config.maxConversionCallersPerImpression,
    maxImpressionSitesForConversion: config.maxImpressionSitesForConversion,
    maxImpressionCallersForConversion: config.maxImpressionCallersForConversion,
    maxCreditSize: config.maxCreditSize,
    maxMatchValues: config.maxMatchValues,
    maxLookbackDays: config.maxLookbackDays,
    maxHistogramSize: config.maxHistogramSize,
    privacyBudgetMicroEpsilons: config.privacyBudgetMicroEpsilons,
    privacyBudgetEpoch: days(config.privacyBudgetEpochDays),
    globalBudgetPerEpochMicroEpsilons: config.globalBudgetPerEpochMicroEpsilons,
    impressionSiteQuotaPerEpochMicroEpsilons:
      config.impressionSiteQuotaPerEpochMicroEpsilons,

    now: () => now,
    fairlyAllocateCreditFraction: () => config.fairlyAllocateCreditFraction,
    epochStart: () => config.epochStart,
  });

  for (const event of tc.events) {
    const newNow = Temporal.Instant.fromEpochMilliseconds(event.seconds * 1e3);
    if (Temporal.Instant.compare(newNow, now) <= 0) {
      throw new RangeError(
        "events must have strictly increasing seconds fields",
      );
    }
    now = newNow;

    switch (event.event) {
      case "saveImpression": {
        const call = () =>
          backend.saveImpression(
            event.site,
            event.intermediarySite,
            event.options,
          );

        if (event.expectedError === undefined) {
          call();
        } else {
          assertThrows(call, event.expectedError, event.seconds);
        }

        break;
      }
      case "measureConversion": {
        const call = () =>
          backend.measureConversion(
            event.site,
            event.intermediarySite,
            event.options,
          );
        if (Array.isArray(event.expected)) {
          assert.deepEqual(
            call().unencryptedHistogram,
            event.expected,
            `seconds: ${event.seconds}`,
          );
        } else {
          assertThrows(call, event.expected, event.seconds);
        }

        break;
      }
      case "clearImpressionsForSite":
        backend.clearImpressionsForSite(event.site);
        break;
      case "clearBrowsingHistoryForAttribution":
        backend.clearState(event.sites, event.forgetVisits);
        break;
      case "enableAPI":
        backend.enabled = true;
        break;
      case "disableAPI":
        backend.enabled = false;
        break;
    }
  }
}

const configName = "CONFIG.json";

async function runTestsInDir(t: TestContext, dir: string): Promise<void> {
  const configJson = await readFile(path.join(dir, configName), "utf8");
  const defaultConfig = JSON.parse(configJson) as TestConfig;

  const promises = [];

  for await (const entry of glob(path.join(dir, "*.json"))) {
    if (path.basename(entry) === configName) {
      continue;
    }

    const promise = t.test(entry, async () => {
      const json = await readFile(entry, "utf8");
      const tc = JSON.parse(json) as TestCase;
      runTest(defaultConfig, tc);
    });

    promises.push(promise);
  }

  await Promise.all(promises);
}

void test("e2e", async (t) => runTestsInDir(t, "e2e-tests"));
