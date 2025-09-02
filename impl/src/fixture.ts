import { AttributionProtocol } from "./index";
import { Backend, Delegate, days } from "./backend";
import { Temporal } from "temporal-polyfill";
import e2eConfig from "../e2e-tests/CONFIG.json";

export const defaultConfig = e2eConfig as TestConfig;

export interface TestConfig {
  now?: string;
  aggregationServices: Record<string, AttributionProtocol>;
  maxConversionSitesPerImpression: number;
  maxConversionCallersPerImpression: number;
  maxCreditSize: number;
  maxLifetimeDays: number;
  maxHistogramSize: number;
  privacyBudgetMicroEpsilons: number;
  privacyBudgetEpochDays: number;
}

export function make_backend(overrideConfig?: Readonly<TestConfig>): Backend {
  const config = overrideConfig ?? defaultConfig;
  const now = config.now
    ? Temporal.Instant.from(config.now)
    : new Temporal.Instant(0n);

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
    maxCreditSize: config.maxCreditSize,
    maxLifetimeDays: config.maxLifetimeDays,
    maxHistogramSize: config.maxHistogramSize,
    privacyBudgetMicroEpsilons: config.privacyBudgetMicroEpsilons,
    privacyBudgetEpoch: days(config.privacyBudgetEpochDays),

    now: () => now,
    random: () => 0.5,
    earliestEpochIndex: () => 0,
  } as Delegate);
}
