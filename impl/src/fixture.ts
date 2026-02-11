import { AttributionProtocol } from "./index";
import { Backend, days } from "./backend";
import { Temporal } from "temporal-polyfill";
import e2eConfig from "../e2e-tests/CONFIG.json";

export const defaultConfig = e2eConfig as Readonly<TestConfig>;

export interface TestConfig {
  now?: Temporal.Instant;
  aggregationServices: Record<string, AttributionProtocol>;
  maxConversionSitesPerImpression: number;
  maxConversionCallersPerImpression: number;
  maxImpressionSitesForConversion: number;
  maxImpressionCallersForConversion: number;
  maxCreditSize: number;
  maxMatchValues: number;
  maxLookbackDays: number;
  maxHistogramSize: number;
  privacyBudgetMicroEpsilons: number;
  privacyBudgetEpochDays: number;
  epochStart: number;
  fairlyAllocateCreditFraction: number;
  globalBudgetPerEpochMicroEpsilons: number;
  impressionSiteQuotaPerEpochMicroEpsilons: number;
}

export function makeBackend(
  config: Readonly<TestConfig> = defaultConfig,
): Backend {
  const now = config.now ?? new Temporal.Instant(0n);

  return new Backend({
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
}
