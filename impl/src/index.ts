export type AttributionProtocol = "dap-15-histogram";

export interface AttributionAggregationService {
  protocol: AttributionProtocol;
}

export type AttributionAggregationServices = ReadonlyMap<
  string,
  Readonly<AttributionAggregationService>
>;

export const DEFAULT_IMPRESSION_LIFETIME_DAYS = 30;
export const DEFAULT_IMPRESSION_MATCH_VALUE = 0;
export const DEFAULT_IMPRESSION_PRIORITY = 0;

export interface AttributionImpressionOptions {
  histogramIndex: number;
  matchValue?: number | undefined; // = DEFAULT_IMPRESSION_PRIORITY
  conversionSites?: string[] | undefined; // = []
  conversionCallers?: string[] | undefined; // = []
  lifetimeDays?: number | undefined; // = DEFAULT_IMPRESSION_LIFETIME_DAYS
  priority?: number | undefined; // = DEFAULT_IMPRESSION_PRIORITY
}

export type AttributionImpressionResult = object;

export const DEFAULT_CONVERSION_EPSILON = 1.0;
export const DEFAULT_CONVERSION_VALUE = 1;
export const DEFAULT_CONVERSION_MAX_VALUE = 1;

export const MAX_CONVERSION_EPSILON = 4294;

export interface AttributionConversionOptions {
  aggregationService: string;
  epsilon?: number | undefined; // = DEFAULT_CONVERSION_EPSILON

  histogramSize: number;

  lookbackDays?: number | undefined;
  matchValues?: number[] | undefined; // = []
  impressionSites?: string[] | undefined; // = []
  impressionCallers?: string[] | undefined; // = []

  credit?: number[] | undefined;
  value?: number | undefined; // = DEFAULT_CONVERSION_VALUE
  maxValue?: number | undefined; // = DEFAULT_CONVERSION_MAX_VALUE
}

export interface AttributionConversionResult {
  report: Uint8Array;

  // Added to facilitate testing and local debugging. Will be absent in "real"
  // API usage.
  unencryptedHistogram?: number[];
}

export interface Attribution {
  readonly aggregationServices: AttributionAggregationServices;

  saveImpression(
    options: AttributionImpressionOptions,
  ): Promise<AttributionImpressionResult>;

  measureConversion(
    options: AttributionConversionOptions,
  ): Promise<AttributionConversionResult>;
}
