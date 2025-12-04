import { Temporal } from "temporal-polyfill";
import { Backend } from "./backend";
import { defaultConfig, makeBackend, TestConfig } from "./fixture";

import { strict as assert } from "node:assert";
import test from "node:test";

// For this test, we only care about the sites that are involved.
interface SiteTableEntry {
  impression: string;
  conversion: string[];
}

const siteTable: readonly SiteTableEntry[] = [
  {
    impression: "imp-one.example",
    conversion: ["conv-one.example"],
  },
  {
    impression: "imp-two.example",
    conversion: ["conv-two.example"],
  },
  {
    impression: "imp-three.example",
    conversion: ["conv-three.example", "conv-three-plus.example"],
  },
];

async function setupImpressions(config?: TestConfig): Promise<Backend> {
  const backend = makeBackend(config);
  await Promise.all(
    siteTable.map(({ impression, conversion: conversionSites }) =>
      backend.saveImpression(impression, undefined, {
        histogramIndex: 1,
        conversionSites,
      }),
    ),
  );
  return backend;
}

// Clearing state for a given site only affects available privacy budget.
void test("clear-site-state", async () => {
  const backend = await setupImpressions();

  // Check that this rejects correctly.
  assert.throws(() => backend.clearState([], false));

  // Run one query with the affected site.
  const before = backend.measureConversion("conv-one.example", undefined, {
    aggregationService: Object.keys(defaultConfig.aggregationServices)[0]!,
    histogramSize: defaultConfig.maxHistogramSize,
    epsilon: defaultConfig.privacyBudgetMicroEpsilons / 1e6 / 10,
  });
  assert.ok(before.unencryptedHistogram!.some((v) => v > 0));

  backend.clearState(["conv-one.example"], false);

  assert.equal(
    backend.impressions.length,
    siteTable.length,
    "All the impressions remain unaffected",
  );
  assert.equal(
    backend.lastBrowsingHistoryClear,
    null,
    "The last clear time is unaffected",
  );

  // Re-run a query and it should return an all zero result.
  const after = backend.measureConversion("conv-one.example", undefined, {
    aggregationService: Object.keys(defaultConfig.aggregationServices)[0]!,
    histogramSize: defaultConfig.maxHistogramSize,
    epsilon: defaultConfig.privacyBudgetMicroEpsilons / 1e6 / 10,
  });
  assert.ok(after.unencryptedHistogram!.every((v) => v === 0));

  // And all entries in the privacy budget table are for the cleared site.
  for (const entry of backend.privacyBudgetEntries) {
    assert.equal(entry.site, "conv-one.example");
    assert.equal(entry.value, 0);
  }
});

// Forgetting all sites resets the entire thing, except the last reset time.
void test("forget-all-sites", async () => {
  const now = Temporal.Instant.from("2025-01-01T00:00Z");
  const backend = await setupImpressions({ now, ...defaultConfig });
  backend.clearState([], true);

  assert.deepEqual(backend.impressions, []);
  assert.deepEqual(backend.privacyBudgetEntries, []);
  assert.deepEqual(backend.epochStarts, new Map());
  assert.deepEqual(backend.lastBrowsingHistoryClear, now);
});

// Forgetting a site with impressions removes impressions.
void test("forget-one-site-impressions", async () => {
  const now = Temporal.Instant.from("2025-01-01T00:00Z");
  const backend = await setupImpressions({ now, ...defaultConfig });
  backend.clearState(["imp-one.example"], true);

  assert.deepEqual(
    backend.impressions.map((i) => i.impressionSite),
    siteTable.map((i) => i.impression).filter((i) => i !== "imp-one.example"),
    "Impressions for the affected site are removed",
  );
  assert.deepEqual(backend.privacyBudgetEntries, []);
  assert.deepEqual(backend.epochStarts, new Map());
  assert.deepEqual(backend.lastBrowsingHistoryClear, now);
});

// Forgetting a site with conversion state removes those.
void test("forget-one-site-conversions", async () => {
  const now = Temporal.Instant.from("2025-01-01T00:00Z");
  const backend = await setupImpressions({ now, ...defaultConfig });

  const before = backend.measureConversion("conv-one.example", undefined, {
    aggregationService: Object.keys(defaultConfig.aggregationServices)[0]!,
    histogramSize: defaultConfig.maxHistogramSize,
    epsilon: defaultConfig.privacyBudgetMicroEpsilons / 1e6 / 10,
  });
  assert.ok(before.unencryptedHistogram!.some((v) => v > 0));

  assert.ok(backend.privacyBudgetEntries.length > 0);
  assert.equal(backend.epochStarts.size, 1);

  backend.clearState(["conv-one.example"], true);

  // Conversions are unaffected, and conversion state is gone.
  assert.equal(backend.impressions.length, siteTable.length);
  assert.deepEqual(backend.privacyBudgetEntries, []);
  assert.deepEqual(backend.epochStarts, new Map());
  assert.deepEqual(backend.lastBrowsingHistoryClear, now);

  // Re-run a query and it should return an all zero result.
  const after = backend.measureConversion("conv-one.example", undefined, {
    aggregationService: Object.keys(defaultConfig.aggregationServices)[0]!,
    histogramSize: defaultConfig.maxHistogramSize,
    epsilon: defaultConfig.privacyBudgetMicroEpsilons / 1e6 / 10,
  });
  assert.ok(after.unencryptedHistogram!.every((v) => v === 0));

  // Privacy budget entries aren't added; this epoch is off-limits.
  assert.deepEqual(backend.privacyBudgetEntries, []);
  // The epoch start will be initialized.
  assert.equal(backend.epochStarts.size, 1);
});
