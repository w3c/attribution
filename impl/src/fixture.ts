import { AttributionProtocol } from "./index";
import { Backend, days } from "./backend";
import { Temporal } from "temporal-polyfill";
import e2eConfig from "../e2e-tests/CONFIG.json";

export const defaultConfig = e2eConfig as Readonly<TestConfig>;

export interface TestConfig {
  now?: Temporal.Instant;
  aggregationServices: Record<string, AttributionProtocol>;
  globalPrivacyBudgetPerEpoch: number;
  maxConversionSitesPerImpression: number;
  maxConversionCallersPerImpression: number;
  maxImpressionSitesForConversion: number;
  maxImpressionCallersForConversion: number;
  maxCreditSize: number;
  maxMatchValues: number;
  maxLookbackDays: number;
  maxHistogramSize: number;
  perSitePrivacyBudget: number;
  privacyBudgetEpochDays: number;
  epochStart: number;
  fairlyAllocateCreditFraction: number;
  impressionSiteQuotaPerEpoch: number;
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

    globalPrivacyBudgetPerEpoch: config.globalPrivacyBudgetPerEpoch,
    impressionSiteQuotaPerEpoch: config.impressionSiteQuotaPerEpoch,
    maxConversionSitesPerImpression: config.maxConversionSitesPerImpression,
    maxConversionCallersPerImpression: config.maxConversionCallersPerImpression,
    maxImpressionSitesForConversion: config.maxImpressionSitesForConversion,
    maxImpressionCallersForConversion: config.maxImpressionCallersForConversion,
    maxCreditSize: config.maxCreditSize,
    maxMatchValues: config.maxMatchValues,
    maxLookbackDays: config.maxLookbackDays,
    maxHistogramSize: config.maxHistogramSize,
    perSitePrivacyBudget: config.perSitePrivacyBudget,
    privacyBudgetEpoch: days(config.privacyBudgetEpochDays),

    now: () => now,
    fairlyAllocateCreditFraction: () => config.fairlyAllocateCreditFraction,
    epochStart: () => config.epochStart,
  });
}
