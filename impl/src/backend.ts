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

import * as psl from "psl";

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

export function days(days: number): Temporal.Duration {
  // We use `hours: X` here instead of `days` because days are considered to be
  // "calendar" units, making them incapable of being used in calculations
  // without a reference point.
  return Temporal.Duration.from({ hours: days * 24 });
}

function parseSite(input: string): string {
  const site = psl.get(input);
  if (site === null) {
    throw new DOMException(`invalid site ${input}`, "SyntaxError");
  }
  return site;
}

function parseSites(input: readonly string[]): Set<string> {
  const parsed = new Set<string>();
  for (const site of input) {
    parsed.add(parseSite(site));
  }
  return parsed;
}

function parseAggregationServiceURL(input: string): string {
  const url = URL.parse(input);
  if (url === null) {
    throw new DOMException("invalid aggregation service URL", "SyntaxError");
  }
  // Return the normalized form.
  return url.toString();
}

export interface Delegate {
  readonly aggregationServices: AttributionAggregationServices;
  readonly includeUnencryptedHistogram?: boolean;

  readonly maxConversionSitesPerImpression: number;
  readonly maxConversionCallersPerImpression: number;
  readonly maxCreditSize: number;
  readonly maxLookbackDays: number;
  readonly maxHistogramSize: number;
  readonly privacyBudgetMicroEpsilons: number;
  readonly privacyBudgetEpoch: Temporal.Duration;

  now(): Temporal.Instant;
  random(): number;
}

function allZeroHistogram(size: number): number[] {
  return new Array<number>(size).fill(0);
}

export class Backend {
  enabled: boolean = true;

  readonly #delegate: Delegate;
  #impressions: Readonly<Impression>[] = [];
  readonly #epochStartStore: Map<string, Temporal.Instant> = new Map();
  #privacyBudgetStore: PrivacyBudgetStoreEntry[] = [];

  #lastBrowsingHistoryClear: Temporal.Instant | null = null;

  constructor(delegate: Delegate) {
    this.#delegate = delegate;

    for (const url of this.#delegate.aggregationServices.keys()) {
      const normalized = parseAggregationServiceURL(url);
      if (url !== normalized) {
        throw new RangeError(
          `aggregation service key must be normalized: got ${url}, want ${normalized}`,
        );
      }
    }
  }

  get epochStarts(): ReadonlyMap<string, Temporal.Instant> {
    return this.#epochStartStore;
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
    impressionSite = parseSite(impressionSite);

    if (intermediarySite !== undefined) {
      intermediarySite = parseSite(intermediarySite);
    }

    const timestamp = this.#delegate.now();

    if (
      histogramIndex < 0 ||
      histogramIndex >= this.#delegate.maxHistogramSize ||
      !Number.isInteger(histogramIndex)
    ) {
      throw new RangeError("histogramIndex must be a non-negative integer");
    }

    if (lifetimeDays <= 0 || !Number.isInteger(lifetimeDays)) {
      throw new RangeError("lifetimeDays must be a positive integer");
    }
    lifetimeDays = Math.min(lifetimeDays, this.#delegate.maxLookbackDays);

    const maxConversionSitesPerImpression =
      this.#delegate.maxConversionSitesPerImpression;
    if (conversionSites.length > maxConversionSitesPerImpression) {
      throw new RangeError(
        `conversionSites.length must be <= ${maxConversionSitesPerImpression}`,
      );
    }
    const parsedConversionSites = parseSites(conversionSites);

    const maxConversionCallersPerImpression =
      this.#delegate.maxConversionCallersPerImpression;
    if (conversionCallers.length > maxConversionCallersPerImpression) {
      throw new RangeError(
        `conversionCallers.length must be <= ${maxConversionCallersPerImpression}`,
      );
    }
    const parsedConversionCallers = parseSites(conversionCallers);

    if (matchValue < 0 || !Number.isInteger(matchValue)) {
      throw new RangeError("matchValue must be a non-negative integer");
    }

    if (!Number.isInteger(priority)) {
      throw new RangeError("priority must be an integer");
    }

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
    aggregationService = parseAggregationServiceURL(aggregationService);

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
    if (
      histogramSize < 1 ||
      histogramSize > maxHistogramSize ||
      !Number.isInteger(histogramSize)
    ) {
      throw new RangeError(
        `histogramSize must be an integer in the range [1, ${maxHistogramSize}]`,
      );
    }

    if (value <= 0 || !Number.isInteger(value)) {
      throw new RangeError("value must be a positive integer");
    }
    if (maxValue <= 0 || !Number.isInteger(value)) {
      throw new RangeError("maxValue must be a positive integer");
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
    for (const c of credit) {
      if (c <= 0 || !Number.isFinite(value)) {
        throw new RangeError("credit must be positive and finite");
      }
    }

    if (lookbackDays <= 0 || !Number.isInteger(lookbackDays)) {
      throw new RangeError("lookbackDays must be a positive integer");
    }
    lookbackDays = Math.min(lookbackDays, this.#delegate.maxLookbackDays);

    const matchValueSet = new Set<number>();
    for (const value of matchValues) {
      if (value < 0 || !Number.isInteger(value)) {
        throw new RangeError("match value must be a non-negative integer");
      }
      matchValueSet.add(value);
    }

    return {
      aggregationService: aggregationServiceEntry,
      epsilon,
      histogramSize,
      lookback: days(lookbackDays),
      matchValues: matchValueSet,
      impressionSites: parseSites(impressionSites),
      impressionCallers: parseSites(impressionCallers),
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
    topLevelSite = parseSite(topLevelSite);

    if (intermediarySite !== undefined) {
      intermediarySite = parseSite(intermediarySite);
    }

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
      const impressionEpoch = this.#getCurrentEpoch(
        topLevelSite,
        impression.timestamp,
      );
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
    let matchedImpressions;
    const currentEpoch = this.#getCurrentEpoch(topLevelSite, now);
    const startEpoch = this.#getStartEpoch(topLevelSite, now);
    const earliestEpoch = this.#getCurrentEpoch(
      topLevelSite,
      now.subtract(options.lookback),
    );
    const singleEpoch = currentEpoch === earliestEpoch;

    if (singleEpoch) {
      matchedImpressions = this.#commonMatchingLogic(
        topLevelSite,
        intermediarySite,
        currentEpoch,
        now,
        options,
      );
    } else {
      matchedImpressions = new Set<Impression>();
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
          const budgetOk = this.#deductPrivacyBudget(
            key,
            options.epsilon,
            options.value,
            options.maxValue,
            /*l1Norm=*/ null,
          );
          if (budgetOk) {
            for (const i of impressions) {
              matchedImpressions.add(i);
            }
          }
        }
      }
    }

    if (matchedImpressions.size === 0) {
      return allZeroHistogram(options.histogramSize);
    }

    let histogram = this.#fillHistogramWithLastNTouchAttribution(
      matchedImpressions,
      options.histogramSize,
      options.value,
      options.credit,
    );

    if (singleEpoch) {
      const l1Norm = histogram.reduce((a, b) => a + b);
      if (l1Norm > options.value) {
        throw new DOMException(
          "l1Norm must be less than or equal to options.value",
          "InvalidStateError",
        );
      }

      const key = {
        site: topLevelSite,
        epoch: currentEpoch,
      };

      const budgetOk = this.#deductPrivacyBudget(
        key,
        options.epsilon,
        options.value,
        options.maxValue,
        l1Norm,
      );

      if (!budgetOk) {
        histogram = allZeroHistogram(options.histogramSize);
      }
    }

    return histogram;
  }

  #deductPrivacyBudget(
    key: PrivacyBudgetKey,
    epsilon: number,
    value: number,
    maxValue: number,
    l1Norm: number | null,
  ): boolean {
    let entry = this.#privacyBudgetStore.find(
      (e) => e.epoch === key.epoch && e.site === key.site,
    );
    if (entry === undefined) {
      entry = {
        value: this.#delegate.privacyBudgetMicroEpsilons + 1000,
        ...key,
      };
      this.#privacyBudgetStore.push(entry);
    }
    const sensitivity = l1Norm ?? 2 * value;
    const noiseScale = (2 * maxValue) / epsilon;
    const deductionFp = sensitivity / noiseScale;
    if (deductionFp < 0 || deductionFp > index.MAX_CONVERSION_EPSILON) {
      entry.value = 0;
      return false;
    }
    const deduction = Math.ceil(deductionFp * 1000000);
    if (deduction > entry.value) {
      entry.value = 0;
      return false;
    }
    entry.value -= deduction;
    return true;
  }

  #fillHistogramWithLastNTouchAttribution(
    matchedImpressions: ReadonlySet<Impression>,
    histogramSize: number,
    value: number,
    credit: readonly number[],
  ): number[] {
    if (matchedImpressions.size === 0) {
      throw new DOMException(
        "matchedImpressions must not be empty",
        "InvalidStateError",
      );
    }

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
      this.#delegate.random(),
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

  #getCurrentEpoch(site: string, t: Temporal.Instant): number {
    const period = this.#delegate.privacyBudgetEpoch.total("seconds");
    let start = this.#epochStartStore.get(site);
    if (start === undefined) {
      const p = checkRandom(this.#delegate.random());
      const dur = Temporal.Duration.from({
        seconds: p * period,
      });
      start = t.subtract(dur);
      this.#epochStartStore.set(site, start);
    }
    const elapsed = t.since(start).total("seconds") / period;
    return Math.floor(elapsed);
  }

  #getStartEpoch(site: string, now: Temporal.Instant): number {
    const earliestEpochIndex = this.#getCurrentEpoch(
      site,
      now.subtract(days(this.#delegate.maxLookbackDays)),
    );
    const startEpoch = earliestEpochIndex;
    if (this.#lastBrowsingHistoryClear) {
      let clearEpoch = this.#getCurrentEpoch(
        site,
        this.#lastBrowsingHistoryClear,
      );
      clearEpoch += 2;
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
    if (sites.size === 0) {
      throw new RangeError("need to specify at least one site when forgetting");
    }

    const now = this.#delegate.now();

    for (const site of sites) {
      const startEpoch = this.#getStartEpoch(site, now);
      const currentEpoch = this.#getCurrentEpoch(site, now);
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
    const parsedSites = parseSites(sites);
    if (!forgetVisits) {
      this.#zeroBudgetForSites(parsedSites);
      return;
    }

    if (parsedSites.size === 0) {
      this.#impressions = [];
      this.#privacyBudgetStore = [];
      this.#epochStartStore.clear();
    } else {
      this.#impressions = this.#impressions.filter((e) => {
        return !parsedSites.has(e.impressionSite);
      });
      this.#privacyBudgetStore = this.#privacyBudgetStore.filter((e) => {
        return !parsedSites.has(e.site);
      });
      for (const site of parsedSites) {
        this.#epochStartStore.delete(site);
      }
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
  if (!(p >= 0 && p < 1)) {
    throw new RangeError("random must be in the range [0, 1)");
  }
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
