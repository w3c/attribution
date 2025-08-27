import type {
  AttributionImpressionOptions,
  AttributionConversionOptions,
} from "./index";

import * as index from "./index";

import { Backend, days } from "./backend";

import { Temporal } from "temporal-polyfill";

let now = new Temporal.Instant(0n);

const backend = new Backend({
  aggregationServices: new Map([["", { protocol: "dap-15-histogram" }]]),
  includeUnencryptedHistogram: true,

  // TODO: Allow these values to be configured in the UI.
  maxConversionSitesPerImpression: 10,
  maxConversionCallersPerImpression: 10,
  maxCreditSize: Infinity,
  maxLifetimeDays: 30,
  maxHistogramSize: 100,
  privacyBudgetMicroEpsilons: 1000000,
  privacyBudgetEpoch: days(7),

  now: () => now,
  random: () => 0.5,
  earliestEpochIndex: (site: string) => {
    void site; // TODO
    return 0;
  },
});

function numberOrUndefined(input: HTMLInputElement): number | undefined {
  const val = input.valueAsNumber;
  return Number.isNaN(val) ? undefined : val;
}

function spaceSeparated(input: HTMLInputElement): string[] {
  return input.value
    .trim()
    .split(/\s+/)
    .filter((v) => v.length > 0);
}

function reportValidity(this: HTMLFormElement) {
  this.reportValidity();
}

function sites(
  site: HTMLInputElement,
  intermediary: HTMLInputElement,
): [string, string | undefined] {
  return [
    site.value,
    intermediary.value.length === 0 ? undefined : intermediary.value,
  ];
}

function listCell(tr: HTMLTableRowElement, vs: Iterable<string>): void {
  const td = tr.insertCell();

  let ul;

  for (const v of vs) {
    if (!ul) {
      ul = document.createElement("ul");
    }

    const li = document.createElement("li");
    li.innerText = v;
    ul.append(li);
  }

  if (ul) {
    td.append(ul);
  }
}

const impressionTable = document.querySelector("tbody")!;

function updateImpressionsTable() {
  impressionTable.replaceChildren();
  for (const i of backend.impressions) {
    const tr = document.createElement("tr");

    tr.insertCell().innerText = i.timestamp.toString();
    tr.insertCell().innerText = i.impressionSite;
    tr.insertCell().innerText = i.intermediarySite ?? "";
    tr.insertCell().innerText = i.histogramIndex.toString();
    tr.insertCell().innerText = i.matchValue.toString();
    tr.insertCell().innerText = (i.lifetime.hours / 24).toString();
    tr.insertCell().innerText = i.priority.toString();
    listCell(tr, i.conversionSites);
    listCell(tr, i.conversionCallers);

    impressionTable.append(tr);
  }
}

{
  const form = document.querySelector<HTMLFormElement>("#time")!;

  const time = document.querySelector("time")!;
  time.innerText = now.toString();

  const daysInput = form.elements.namedItem("days") as HTMLInputElement;

  form.addEventListener("input", reportValidity);

  form.addEventListener("submit", function (this: HTMLFormElement, e) {
    e.preventDefault();

    if (!this.reportValidity()) {
      return;
    }

    now = now.add(days(daysInput.valueAsNumber));
    time.innerText = now.toString();
    backend.clearExpiredImpressions();
    updateImpressionsTable();
  });
}

{
  const form = document.querySelector<HTMLFormElement>("#saveImpression")!;

  const site = form.elements.namedItem("impressionSite") as HTMLInputElement;

  const intermediary = form.elements.namedItem(
    "impressionIntermediary",
  ) as HTMLInputElement;

  const histogramIndex = form.elements.namedItem(
    "histogramIndex",
  ) as HTMLInputElement;
  histogramIndex.min = "0";
  histogramIndex.value = "0";

  const matchValue = form.elements.namedItem("matchValue") as HTMLInputElement;
  matchValue.min = "0";
  matchValue.valueAsNumber = index.DEFAULT_IMPRESSION_MATCH_VALUE;

  const lifetimeDays = form.elements.namedItem(
    "lifetimeDays",
  ) as HTMLInputElement;
  lifetimeDays.min = "1";
  lifetimeDays.valueAsNumber = index.DEFAULT_IMPRESSION_LIFETIME_DAYS;

  const priority = form.elements.namedItem("priority") as HTMLInputElement;
  priority.valueAsNumber = index.DEFAULT_IMPRESSION_PRIORITY;

  const conversionSites = form.elements.namedItem(
    "conversionSites",
  ) as HTMLInputElement;

  const conversionCallers = form.elements.namedItem(
    "conversionCallers",
  ) as HTMLInputElement;

  const output = form.querySelector("ol")!;

  form.addEventListener("input", reportValidity);

  form.addEventListener("submit", function (this: HTMLFormElement, e) {
    e.preventDefault();

    if (!this.reportValidity()) {
      return;
    }

    const opts: AttributionImpressionOptions = {
      histogramIndex: histogramIndex.valueAsNumber,
      lifetimeDays: numberOrUndefined(lifetimeDays),
      matchValue: numberOrUndefined(matchValue),
      priority: numberOrUndefined(priority),
      conversionSites: spaceSeparated(conversionSites),
      conversionCallers: spaceSeparated(conversionCallers),
    };

    const li = document.createElement("li");

    try {
      backend.saveImpression(...sites(site, intermediary), opts);
      li.innerText = "Success";
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      li.innerText = `Error: ${e}`;
    }

    output.append(li);
    updateImpressionsTable();
  });
}

{
  const form = document.querySelector<HTMLFormElement>("#measureConversion")!;

  const site = form.elements.namedItem("conversionSite") as HTMLInputElement;

  const intermediary = form.elements.namedItem(
    "conversionIntermediary",
  ) as HTMLInputElement;

  const histogramSize = form.elements.namedItem(
    "histogramSize",
  ) as HTMLInputElement;
  histogramSize.min = "1";
  histogramSize.value = "1";

  const epsilon = form.elements.namedItem("epsilon") as HTMLInputElement;
  epsilon.min = "0.01";
  epsilon.step = "0.01";
  epsilon.max = index.MAX_CONVERSION_EPSILON.toString();
  epsilon.valueAsNumber = index.DEFAULT_CONVERSION_EPSILON;

  const value = form.elements.namedItem("value") as HTMLInputElement;
  value.min = "1";
  value.valueAsNumber = index.DEFAULT_CONVERSION_VALUE;

  const maxValue = form.elements.namedItem("maxValue") as HTMLInputElement;
  maxValue.min = "1";
  maxValue.valueAsNumber = index.DEFAULT_CONVERSION_MAX_VALUE;

  const lookbackDays = form.elements.namedItem(
    "lookbackDays",
  ) as HTMLInputElement;
  lookbackDays.min = "1";

  const credit = form.elements.namedItem("credit") as HTMLInputElement;

  const matchValues = form.elements.namedItem(
    "matchValues",
  ) as HTMLInputElement;

  const impressionSites = form.elements.namedItem(
    "impressionSites",
  ) as HTMLInputElement;

  const impressionCallers = form.elements.namedItem(
    "impressionCallers",
  ) as HTMLInputElement;

  const output = form.querySelector("ol")!;

  const epochStarts = document.querySelector<HTMLDListElement>("#epochStarts")!;

  const privacyBudgetEntries = document.querySelector<HTMLDListElement>(
    "#privacyBudgetEntries",
  )!;

  form.addEventListener("input", reportValidity);

  form.addEventListener("submit", function (this: HTMLFormElement, e) {
    e.preventDefault();

    if (!this.reportValidity()) {
      return;
    }

    const opts: AttributionConversionOptions = {
      aggregationService: "",
      epsilon: numberOrUndefined(epsilon),
      histogramSize: histogramSize.valueAsNumber,
      matchValues: spaceSeparated(matchValues).map((v) =>
        Number.parseInt(v, 10),
      ),
      logicOptions: {
        credit: spaceSeparated(credit).map(Number.parseFloat),
      },
      lookbackDays: numberOrUndefined(lookbackDays),
      maxValue: numberOrUndefined(maxValue),
      value: numberOrUndefined(value),
      impressionSites: spaceSeparated(impressionSites),
      impressionCallers: spaceSeparated(impressionCallers),
    };

    const li = document.createElement("li");
    try {
      const result = backend.measureConversion(
        ...sites(site, intermediary),
        opts,
      );

      const dl = document.createElement("dl");
      let zeroes = 0;
      for (const [i, v] of result.unencryptedHistogram!.entries()) {
        if (v === 0) {
          zeroes++;
          continue;
        }

        const dt = document.createElement("dt");
        dt.innerText = i.toString();

        const dd = document.createElement("dd");
        dd.innerText = v.toString();

        dl.append(dt, dd);
      }

      li.innerText = `Histogram: ${zeroes} zeroes`;
      if (zeroes !== result.unencryptedHistogram!.length) {
        li.append(" and…", dl);
      }
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      li.innerText = `Error: ${e}`;
    }

    output.append(li);

    epochStarts.replaceChildren();
    for (const [site, start] of backend.epochStarts) {
      const dt = document.createElement("dt");
      dt.innerText = site;
      const dd = document.createElement("dd");
      dd.innerText = start.toString();
      epochStarts.append(dt, dd);
    }

    privacyBudgetEntries.replaceChildren();
    for (const entry of backend.privacyBudgetEntries) {
      const dt = document.createElement("dt");
      dt.innerText = `${entry.site} @ epoch ${entry.epoch}`;
      const dd = document.createElement("dd");
      dd.innerText = entry.value.toString();
      privacyBudgetEntries.append(dt, dd);
    }
  });
}
