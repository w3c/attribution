import type {
  AttributionAggregationService,
  AttributionAggregationServices,
  AttributionConversionOptions,
  AttributionConversionResult,
  AttributionImpressionOptions,
  AttributionImpressionResult,
} from "./index";

import * as index from "./index";

import { Temporal } from "temporal-polyfill";

import { getDomain } from "tldts";

interface Impression {
  matchValue: number;
  impressionSite: string;
  intermediarySite: string | undefined;
  conversionSites: Set<string>;
  conversionCallers: Set<string>;
  timestamp: Temporal.Instant;
  lifetime: Temporal.Duration;
  histogramIndex: number;
  priority: number;
}

interface PrivacyBudgetKey {
  epoch: number;
  site: string;
}

interface PrivacyBudgetStoreEntry extends Readonly<PrivacyBudgetKey> {
  value: number;
}

interface ValidatedConversionOptions {
  aggregationService: Readonly<AttributionAggregationService>;
  epsilon: number;
  histogramSize: number;
  lookback: Temporal.Duration;
  matchValues: ReadonlySet<number>;
  impressionSites: ReadonlySet<string>;
  impressionCallers: ReadonlySet<string>;
  credit: readonly number[];
  value: number;
  maxValue: number;
}

const UNIX_EPOCH = new Temporal.Instant(0n);

export function days(days: number): Temporal.Duration {
  // We use `hours: X` here instead of `days` because days are considered to be
  // "calendar" units, making them incapable of being used in calculations
  // without a reference point.
  return Temporal.Duration.from({ hours: days * 24 });
}

function parseSite(input: string): string {
  const site = getDomain(input, { allowPrivateDomains: true });
  if (site === null) {
    throw new DOMException(`invalid site ${input}`, "SyntaxError");
  }
  return site;
}

function isValidSite(input: string): boolean {
  return parseSite(input) === input;
}

function parseSites(
  input: readonly string[],
  label: string,
  limit: number,
): Set<string> {
  const parsed = new Set<string>();
  if (input.length > limit) {
    throw new RangeError(
      `number of values in ${label} exceeds limit of ${limit}`,
    );
  }
  for (const site of input) {
    parsed.add(parseSite(site));
  }
  return parsed;
}

export interface Delegate {
  readonly aggregationServices: AttributionAggregationServices;
  readonly includeUnencryptedHistogram?: boolean;

  /// The maximum number of conversion sites per impression.
  readonly maxConversionSitesPerImpression: number;
  /// The maximum number of conversion callers per impression.
  readonly maxConversionCallersPerImpression: number;
  /// The maximum number of impression sites for conversion.
  readonly maxImpressionSitesForConversion: number;
  /// The maximum number of impression callers for conversion.
  readonly maxImpressionCallersForConversion: number;
  /// The maximum number of credit values.
  readonly maxCreditSize: number;
  /// The maximum number of match values.
  readonly maxMatchValues: number;
  /// The maximum lookback in days.
  readonly maxLookbackDays: number;
  /// The maximum size of histograms.
  readonly maxHistogramSize: number;
  readonly perSitePrivacyBudget: number;
  readonly privacyBudgetEpoch: Temporal.Duration;
  readonly impressionSiteQuotaPerEpoch: number;
  readonly globalPrivacyBudgetPerEpoch: number;

  now(): Temporal.Instant;
  fairlyAllocateCreditFraction(): number;
  epochStart(): number;
}

function allZeroHistogram(size: number): number[] {
  return new Array<number>(size).fill(0);
}

function assert(condition: boolean): void {
  if (!condition) {
    throw new Error("invalid assertion");
  }
}

function isUnsignedLong(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= 4294967295;
}

function isLong(v: number): boolean {
  return Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;
}

function isDouble(v: number): boolean {
  return Number.isFinite(v);
}

export class Backend {
  enabled: boolean = true;

  readonly #delegate: Delegate;
  #impressions: Readonly<Impression>[] = [];
  #epochStartTime: Temporal.Instant | null = null;
  #globalPrivacyBudgetStore: Map<number, number> = new Map();
  #privacyBudgetStore: PrivacyBudgetStoreEntry[] = [];
  #impressionSiteQuotaStore: PrivacyBudgetStoreEntry[] = [];
  #lastBrowsingHistoryClear: Temporal.Instant | null = null;

  constructor(delegate: Delegate) {
    this.#delegate = delegate;
  }

  get epochStartTime(): Temporal.Instant | null {
    return this.#epochStartTime;
  }

  get privacyBudgetEntries(): ReadonlyArray<Readonly<PrivacyBudgetStoreEntry>> {
    return this.#privacyBudgetStore;
  }

  get impressions(): ReadonlyArray<Readonly<Impression>> {
    return this.#impressions;
  }

  get aggregationServices(): AttributionAggregationServices {
    return this.#delegate.aggregationServices;
  }

  get lastBrowsingHistoryClear(): Temporal.Instant | null {
    return this.#lastBrowsingHistoryClear;
  }

  saveImpression(
    impressionSite: string,
    intermediarySite: string | undefined,
    {
      histogramIndex,
      matchValue = index.DEFAULT_IMPRESSION_MATCH_VALUE,
      conversionSites = [],
      conversionCallers = [],
      lifetimeDays = index.DEFAULT_IMPRESSION_LIFETIME_DAYS,
      priority = index.DEFAULT_IMPRESSION_PRIORITY,
    }: AttributionImpressionOptions,
  ): AttributionImpressionResult {
    assert(isValidSite(impressionSite));
    assert(intermediarySite === undefined || isValidSite(intermediarySite));

    // Corresponds to WebIDL conversions.
    assert(isUnsignedLong(histogramIndex));
    assert(isUnsignedLong(matchValue));
    assert(isUnsignedLong(lifetimeDays));
    assert(isLong(priority));

    const timestamp = this.#delegate.now();

    const maxHistogramSize = this.#delegate.maxHistogramSize;
    if (histogramIndex >= maxHistogramSize) {
      throw new RangeError(
        `histogramIndex must be less than maximum histogram size (${maxHistogramSize})`,
      );
    }

    if (lifetimeDays === 0) {
      throw new RangeError("lifetimeDays must be positive");
    }
    lifetimeDays = Math.min(lifetimeDays, this.#delegate.maxLookbackDays);

    const parsedConversionSites = parseSites(
      conversionSites,
      "conversionSites",
      this.#delegate.maxConversionSitesPerImpression,
    );
    const parsedConversionCallers = parseSites(
      conversionCallers,
      "conversionCallers",
      this.#delegate.maxConversionCallersPerImpression,
    );

    if (!this.enabled) {
      return {};
    }

    this.#impressions.push({
      matchValue,
      impressionSite,
      intermediarySite,
      conversionSites: parsedConversionSites,
      conversionCallers: parsedConversionCallers,
      timestamp,
      lifetime: days(lifetimeDays),
      histogramIndex,
      priority,
    });

    return {};
  }

  #validateConversionOptions({
    aggregationService,
    epsilon = index.DEFAULT_CONVERSION_EPSILON,
    histogramSize,
    impressionSites = [],
    impressionCallers = [],
    lookbackDays = this.#delegate.maxLookbackDays,
    credit = [1],
    maxValue = index.DEFAULT_CONVERSION_MAX_VALUE,
    matchValues = [],
    value = index.DEFAULT_CONVERSION_VALUE,
  }: AttributionConversionOptions): ValidatedConversionOptions {
    // Corresponds to WebIDL conversions.
    assert(isDouble(epsilon));
    assert(isUnsignedLong(histogramSize));
    assert(isUnsignedLong(lookbackDays));
    assert(credit.every(isDouble));
    assert(isUnsignedLong(maxValue));
    assert(matchValues.every(isUnsignedLong));
    assert(isUnsignedLong(value));

    const aggregationServiceEntry =
      this.aggregationServices.get(aggregationService);
    if (aggregationServiceEntry === undefined) {
      throw new ReferenceError("unknown aggregation service");
    }

    if (epsilon <= 0 || epsilon > index.MAX_CONVERSION_EPSILON) {
      throw new RangeError(
        `epsilon must be in the range (0, ${index.MAX_CONVERSION_EPSILON}]`,
      );
    }

    const maxHistogramSize = this.#delegate.maxHistogramSize;
    if (histogramSize < 1 || histogramSize > maxHistogramSize) {
      throw new RangeError(
        `histogramSize must be in the range [1, ${maxHistogramSize}]`,
      );
    }

    if (value === 0) {
      throw new RangeError("value must be positive");
    }

    if (value > maxValue) {
      throw new RangeError("value must be <= maxValue");
    }

    const maxCreditSize = this.#delegate.maxCreditSize;
    if (credit.length === 0 || credit.length > maxCreditSize) {
      throw new RangeError(
        `credit size must be in the range [1, ${maxCreditSize}]`,
      );
    }
    if (credit.some((c) => c <= 0)) {
      throw new RangeError("credit must be positive");
    }

    lookbackDays = Math.min(lookbackDays, this.#delegate.maxLookbackDays);
    if (lookbackDays === 0) {
      throw new RangeError("lookbackDays must be positive");
    }

    const maxMatchValues = this.#delegate.maxMatchValues;
    if (matchValues.length > maxMatchValues) {
      throw new RangeError(
        `number of values in matchValues exceeds limit of ${maxMatchValues}`,
      );
    }

    const parsedImpressionSites = parseSites(
      impressionSites,
      "impressionSites",
      this.#delegate.maxImpressionSitesForConversion,
    );
    const parsedImpressionCallers = parseSites(
      impressionCallers,
      "impressionCallers",
      this.#delegate.maxImpressionCallersForConversion,
    );

    return {
      aggregationService: aggregationServiceEntry,
      epsilon,
      histogramSize,
      lookback: days(lookbackDays),
      matchValues: new Set(matchValues),
      impressionSites: parsedImpressionSites,
      impressionCallers: parsedImpressionCallers,
      credit,
      value,
      maxValue,
    };
  }

  measureConversion(
    topLevelSite: string,
    intermediarySite: string | undefined,
    options: AttributionConversionOptions,
  ): AttributionConversionResult {
    assert(isValidSite(topLevelSite));
    assert(intermediarySite === undefined || isValidSite(intermediarySite));

    const now = this.#delegate.now();

    const validatedOptions = this.#validateConversionOptions(options);

    const report = this.enabled
      ? this.#doAttributionAndFillHistogram(
          topLevelSite,
          intermediarySite,
          now,
          validatedOptions,
        )
      : allZeroHistogram(validatedOptions.histogramSize);

    const result: AttributionConversionResult = {
      report: this.#encryptReport(report),
    };
    if (this.#delegate.includeUnencryptedHistogram) {
      result.unencryptedHistogram = report;
    }
    return result;
  }

  #commonMatchingLogic(
    topLevelSite: string,
    intermediarySite: string | undefined,
    epoch: number,
    now: Temporal.Instant,
    {
      lookback,
      impressionSites,
      impressionCallers,
      matchValues,
    }: ValidatedConversionOptions,
  ): Set<Impression> {
    const matching = new Set<Impression>();

    for (const impression of this.#impressions) {
      const impressionEpoch = this.#getCurrentEpoch(impression.timestamp);
      if (impressionEpoch !== epoch) {
        continue;
      }
      if (
        Temporal.Instant.compare(
          now,
          impression.timestamp.add(impression.lifetime),
        ) > 0
      ) {
        continue;
      }
      if (
        Temporal.Instant.compare(now, impression.timestamp.add(lookback)) > 0
      ) {
        continue;
      }
      if (
        impression.conversionSites.size > 0 &&
        !impression.conversionSites.has(topLevelSite)
      ) {
        continue;
      }
      const conversionCaller = intermediarySite ?? topLevelSite;
      if (
        impression.conversionCallers.size > 0 &&
        !impression.conversionCallers.has(conversionCaller)
      ) {
        continue;
      }
      if (matchValues.size > 0 && !matchValues.has(impression.matchValue)) {
        continue;
      }
      if (
        impressionSites.size > 0 &&
        !impressionSites.has(impression.impressionSite)
      ) {
        continue;
      }
      const impressionCaller =
        impression.intermediarySite ?? impression.impressionSite;
      if (
        impressionCallers.size > 0 &&
        !impressionCallers.has(impressionCaller)
      ) {
        continue;
      }
      matching.add(impression);
    }

    return matching;
  }

  #doAttributionAndFillHistogram(
    topLevelSite: string,
    intermediarySite: string | undefined,
    now: Temporal.Instant,
    options: ValidatedConversionOptions,
  ): number[] {
    const currentEpoch = this.#getCurrentEpoch(now);
    const startEpoch = this.#getStartEpoch(now);
    const earliestEpoch = this.#getCurrentEpoch(now.subtract(options.lookback));
    const isSingleEpoch = currentEpoch === earliestEpoch;
    let l1Norm = 0;

    if (isSingleEpoch) {
      const impressions = this.#commonMatchingLogic(
        topLevelSite,
        intermediarySite,
        currentEpoch,
        now,
        options,
      );
      if (impressions.size === 0) {
        return allZeroHistogram(options.histogramSize);
      }
      const histogram = this.#fillHistogramWithLastNTouchAttribution(
        impressions,
        options.histogramSize,
        options.value,
        options.credit,
      );
      l1Norm = histogram.reduce((a, b) => a + b, 0);
      assert(l1Norm <= options.value);
    }

    const matchedImpressions = new Set<Impression>();
    const deductedImpressionQuotas: PrivacyBudgetKey[] = [];
    const deductedGlobalBudgets = new Set<number>();

    for (let epoch = startEpoch; epoch <= currentEpoch; ++epoch) {
      const impressions = this.#commonMatchingLogic(
        topLevelSite,
        intermediarySite,
        epoch,
        now,
        options,
      );
      if (impressions.size > 0) {
        const key = { epoch, site: topLevelSite };
        const budgetAndSafetyOk = this.#deductPrivacyAndSafetyBudgets(
          key,
          impressions,
          options.epsilon,
          options.value,
          options.maxValue,
          isSingleEpoch,
          l1Norm,
          deductedImpressionQuotas,
          deductedGlobalBudgets,
        );
        if (budgetAndSafetyOk) {
          for (const i of impressions) {
            matchedImpressions.add(i);
          }
        }
      }
    }

    if (matchedImpressions.size === 0) {
      return allZeroHistogram(options.histogramSize);
    }

    const histogram = this.#fillHistogramWithLastNTouchAttribution(
      matchedImpressions,
      options.histogramSize,
      options.value,
      options.credit,
    );

    return histogram;
  }

  #deductPrivacyAndSafetyBudgets(
    key: PrivacyBudgetKey,
    impressions: ReadonlySet<Impression>,
    epsilon: number,
    value: number,
    maxValue: number,
    isSingleEpoch: boolean,
    l1Norm: number,
    deductedImpressionQuotas: PrivacyBudgetKey[],
    deductedGlobalBudgets: Set<number>,
  ): boolean {
    const l1NormSensitivity = isSingleEpoch ? l1Norm : 2 * value;
    const valueSensitivity = 2 * value;
    const noiseScale = (2 * maxValue) / epsilon;
    const l1NormDeductionFp = l1NormSensitivity / noiseScale;
    const valueDeductionFp = valueSensitivity / noiseScale;
    const l1NormDeduction = Math.ceil(l1NormDeductionFp * 1000000);
    const valueDeduction = Math.ceil(valueDeductionFp * 1000000);
    if (
      !this.#checkForAvailablePrivacyBudget(
        key,
        l1NormDeduction,
        valueDeduction,
        impressions,
        isSingleEpoch,
      )
    ) {
      return false;
    }
    let entry = this.#privacyBudgetStore.find(
      (e) => e.epoch === key.epoch && e.site === key.site,
    );
    if (entry === undefined) {
      entry = {
        value: this.#delegate.perSitePrivacyBudget,
        ...key,
      };
      this.#privacyBudgetStore.push(entry);
    }
    const deduction = isSingleEpoch ? l1NormDeduction : valueDeduction;
    const currentValue = entry.value;
    entry.value = currentValue - deduction;
    const epoch = key.epoch;
    if (!deductedGlobalBudgets.has(epoch)) {
      deductedGlobalBudgets.add(epoch);
      const value = this.#globalPrivacyBudgetStore.get(epoch)!;
      this.#globalPrivacyBudgetStore.set(epoch, value - valueDeduction);
    }
    for (const impression of impressions) {
      const impressionSite = impression.impressionSite;
      const impressionQuotaKey = { site: impressionSite, epoch };
      let entryI = this.#impressionSiteQuotaStore.find(
        (e) =>
          e.epoch === impressionQuotaKey.epoch &&
          e.site === impressionQuotaKey.site,
      );
      if (entryI === undefined) {
        entryI = {
          value: this.#delegate.impressionSiteQuotaPerEpoch,
          ...impressionQuotaKey,
        };
        this.#impressionSiteQuotaStore.push(entryI);
      }
      if (
        deductedImpressionQuotas.find(
          (e) =>
            e.epoch === impressionQuotaKey.epoch &&
            e.site === impressionQuotaKey.site,
        ) === undefined
      ) {
        deductedImpressionQuotas.push(impressionQuotaKey);
        entryI.value -= valueDeduction;
      }
    }
    return true;
  }

  #checkForAvailablePrivacyBudget(
    key: PrivacyBudgetKey,
    l1NormDeduction: number,
    valueDeduction: number,
    impressions: ReadonlySet<Impression>,
    isSingleEpoch: boolean,
  ): boolean {
    const deduction = isSingleEpoch ? l1NormDeduction : valueDeduction;
    const currentValue =
      this.#privacyBudgetStore.find(
        (e) => e.epoch === key.epoch && e.site === key.site,
      )?.value ?? this.#delegate.perSitePrivacyBudget;
    if (deduction > currentValue) {
      return false;
    }
    const epoch = key.epoch;
    const currentGlobalValue =
      this.#globalPrivacyBudgetStore.get(epoch) ??
      this.#delegate.globalPrivacyBudgetPerEpoch;
    if (valueDeduction > currentGlobalValue) {
      return false;
    }
    for (const impression of impressions) {
      const impressionSite = impression.impressionSite;
      const impressionQuotaKey = { site: impressionSite, epoch };
      const currentImpressionQuotaValue =
        this.#impressionSiteQuotaStore.find(
          (e) =>
            e.epoch === impressionQuotaKey.epoch &&
            e.site === impressionQuotaKey.site,
        )?.value ?? this.#delegate.impressionSiteQuotaPerEpoch;
      if (valueDeduction > currentImpressionQuotaValue) {
        return false;
      }
    }
    return true;
  }

  #fillHistogramWithLastNTouchAttribution(
    matchedImpressions: ReadonlySet<Impression>,
    histogramSize: number,
    value: number,
    credit: readonly number[],
  ): number[] {
    assert(matchedImpressions.size > 0);

    const sortedImpressions = Array.from(matchedImpressions).toSorted(
      (a, b) => {
        if (a.priority < b.priority) {
          return 1;
        }
        if (a.priority > b.priority) {
          return -1;
        }
        return Temporal.Instant.compare(b.timestamp, a.timestamp);
      },
    );

    const N = Math.min(credit.length, sortedImpressions.length);

    const lastNImpressions = sortedImpressions.slice(0, N);

    credit = credit.slice(0, N);

    const normalizedCredit = fairlyAllocateCredit(credit, value, () =>
      this.#delegate.fairlyAllocateCreditFraction(),
    );

    const histogram = allZeroHistogram(histogramSize);

    for (const [i, impression] of lastNImpressions.entries()) {
      const value = normalizedCredit[i];
      const index = impression.histogramIndex;
      if (index < histogram.length) {
        histogram[index]! += value!;
      }
    }
    return histogram;
  }

  #encryptReport(report: readonly number[]): Uint8Array {
    void report;
    return new Uint8Array(0); // TODO
  }

  #getCurrentEpoch(t: Temporal.Instant): number {
    const period = this.#delegate.privacyBudgetEpoch.total("seconds");
    if (this.#epochStartTime === null) {
      const rand = t.subtract(
        Temporal.Duration.from({
          seconds: checkRandom(this.#delegate.epochStart()) * period,
        }),
      );
      const hours = Math.floor(rand.since(UNIX_EPOCH).total("hours"));
      this.#epochStartTime = UNIX_EPOCH.add(Temporal.Duration.from({ hours }));
    }
    const start = this.#epochStartTime;
    const elapsed = t.since(start).total("seconds") / period;
    return Math.floor(elapsed);
  }

  #getStartEpoch(now: Temporal.Instant): number {
    const earliestEpochIndex = this.#getCurrentEpoch(
      now.subtract(days(this.#delegate.maxLookbackDays)),
    );
    const startEpoch = earliestEpochIndex;
    if (this.#lastBrowsingHistoryClear) {
      let clearEpoch = this.#getCurrentEpoch(this.#lastBrowsingHistoryClear);
      clearEpoch += 1;
      if (clearEpoch > startEpoch) {
        return clearEpoch;
      }
    }
    return startEpoch;
  }

  clearImpressionsForSite(site: string): void {
    function shouldRemoveImpression(i: Impression): boolean {
      if (i.intermediarySite === undefined && i.impressionSite === site) {
        return true;
      }
      if (i.intermediarySite === site) {
        return true;
      }
      if (i.conversionSites.has(site)) {
        i.conversionSites.delete(site);
        if (i.conversionSites.size === 0) {
          return true;
        }
      }
      if (i.conversionCallers.has(site)) {
        i.conversionCallers.delete(site);
        if (i.conversionCallers.size === 0) {
          return true;
        }
      }
      return false;
    }

    this.#impressions = this.#impressions.filter(
      (i) => !shouldRemoveImpression(i),
    );
  }

  #zeroBudgetForSites(sites: ReadonlySet<string>): void {
    assert(sites.size > 0);

    const now = this.#delegate.now();

    for (const site of sites) {
      const startEpoch = this.#getStartEpoch(now);
      const currentEpoch = this.#getCurrentEpoch(now);
      for (let epoch = startEpoch; epoch <= currentEpoch; ++epoch) {
        const entry = this.#privacyBudgetStore.find(
          (e) => e.epoch === epoch && e.site === site,
        );
        if (entry === undefined) {
          this.#privacyBudgetStore.push({
            site,
            epoch,
            value: 0,
          });
        } else {
          entry.value = 0;
        }
      }
    }
  }

  clearState(sites: readonly string[], forgetVisits: boolean): void {
    const parsedSites = parseSites(sites, "sites", Infinity);
    if (!forgetVisits) {
      this.#zeroBudgetForSites(parsedSites);
      return;
    }

    if (parsedSites.size === 0) {
      this.#impressions = [];
      this.#privacyBudgetStore = [];
      this.#impressionSiteQuotaStore = [];
      this.#globalPrivacyBudgetStore.clear();
    } else {
      this.#impressions = this.#impressions.filter((e) => {
        return !parsedSites.has(e.impressionSite);
      });
      this.#privacyBudgetStore = this.#privacyBudgetStore.filter((e) => {
        return !parsedSites.has(e.site);
      });
      this.#impressionSiteQuotaStore = this.#impressionSiteQuotaStore.filter(
        (e) => {
          return !parsedSites.has(e.site);
        },
      );
    }

    this.#lastBrowsingHistoryClear = this.#delegate.now();
  }

  clearExpiredImpressions(): void {
    const now = this.#delegate.now();

    this.#impressions = this.#impressions.filter((impression) => {
      return (
        Temporal.Instant.compare(
          now,
          impression.timestamp.add(impression.lifetime),
        ) < 0
      );
    });
  }
}

function checkRandom(p: number): number {
  assert(p >= 0 && p < 1);
  return p;
}

export function fairlyAllocateCredit(
  credit: readonly number[],
  value: number,
  rand: () => number,
): number[] {
  // TODO: replace with precise sum
  const sumCredit = credit.reduce((a, b) => a + b, 0);

  const roundedCredit = credit.map((item) => (value * item) / sumCredit);

  let idx1 = 0;

  for (let n = 1; n < roundedCredit.length; ++n) {
    let idx2 = n;

    const frac1 = roundedCredit[idx1]! - Math.floor(roundedCredit[idx1]!);
    const frac2 = roundedCredit[idx2]! - Math.floor(roundedCredit[idx2]!);
    if (frac1 === 0 && frac2 === 0) {
      continue;
    }

    const [incr1, incr2] =
      frac1 + frac2 > 1 ? [1 - frac1, 1 - frac2] : [-frac1, -frac2];

    const p1 = incr2 / (incr1 + incr2);

    const r = checkRandom(rand());

    let incr;
    if (r < p1) {
      incr = incr1;
      [idx1, idx2] = [idx2, idx1];
    } else {
      incr = incr2;
    }

    roundedCredit[idx2]! += incr;
    roundedCredit[idx1]! -= incr;
  }

  return roundedCredit.map((item) => Math.round(item));
}
