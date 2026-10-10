import { test } from "node:test";
import assert from "node:assert/strict";
import { filterValues, segmentPoints, type ChartResponse } from "./charts.ts";

// Shape of GET /charts/actives_new?segment=attribution_keyword as returned by the API.
const chart: ChartResponse = {
  measures: [{ display_name: "Trial Conversions" }, { display_name: "Total Paid Subscriptions" }],
  segments: [{ display_name: "Total", is_total: true }, { display_name: "No keyword" }, { display_name: "plant care tips" }],
  values: [
    { cohort: 1790553600, measure: 0, segment: 0, value: 3 },
    { cohort: 1790553600, measure: 0, segment: 1, value: 1 },
    { cohort: 1790553600, measure: 1, segment: 1, value: 1 },
    { cohort: 1790553600, measure: 0, segment: 2, value: 2 },
    { cohort: 1790553600, measure: 1, segment: 2, value: 2 },
    { cohort: 1790640000, measure: 0, segment: 2, value: 0, incomplete: true },
  ],
};

test("segmentPoints drops the Total segment, maps 'No keyword' to '' and keys measures by name", () => {
  const points = segmentPoints(chart);
  assert.deepEqual(points, [
    { date: "2026-09-28", segment: "", values: { "Trial Conversions": 1, "Total Paid Subscriptions": 1 }, incomplete: false },
    { date: "2026-09-28", segment: "plant care tips", values: { "Trial Conversions": 2, "Total Paid Subscriptions": 2 }, incomplete: false },
    { date: "2026-09-29", segment: "plant care tips", values: { "Trial Conversions": 0 }, incomplete: true },
  ]);
});

test("segmentPoints handles unsegmented charts", () => {
  const points = segmentPoints({ measures: [{ display_name: "New Trials" }], values: [{ cohort: 1790553600, measure: 0, value: 5 }] });
  assert.deepEqual(points, [{ date: "2026-09-28", segment: "", values: { "New Trials": 5 }, incomplete: false }]);
});

test("segmentPoints rejects values for unknown measures", () => {
  assert.throws(() => segmentPoints({ measures: [], values: [{ cohort: 0, measure: 0, value: 1 }] }), /unknown measure/);
});

test("filterValues returns a filter's options and names the available filters when missing", () => {
  const options = { segments: [], filters: [{ id: "attribution_campaign", display_name: "Attribution Ad Campaign", options: [{ id: "No campaign", display_name: "No campaign" }] }] };
  assert.deepEqual(filterValues(options, "attribution_campaign"), [{ id: "No campaign", display_name: "No campaign" }]);
  assert.throws(() => filterValues(options, "attribution_keyword"), /available: attribution_campaign/);
});
