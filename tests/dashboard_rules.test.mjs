import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const code = readFileSync(new URL("app.js", root), "utf8");
const context = { console };
vm.createContext(context);
vm.runInContext(code, context);
const api = context.RunningDashboard;

const csv = readFileSync(new URL("data/running_data.csv", root), "utf8");
const header = csv.split(/\r?\n/).find((line) => line.startsWith("date,"));

function row(values) {
  return header + "\n" + values;
}

test("mock sample renders the sample numbers and does not call them a real trend", () => {
  const view = api.buildView(api.parseCsv(csv));
  assert.equal(view.showingMock, true);
  assert.equal(view.parseErrors.length, 0);
  assert.equal(view.anomalies.length, 0);
  assert.equal(view.metrics.bestTwoMile.display, "16:52");
  assert.equal(view.metrics.bestTwoMile.date, "2026-09-26");
  assert.equal(view.metrics.bestTwoMile.gap, "1:52 slower than 15:00");
  assert.equal(view.metrics.bestPace.display, "8:10");
  assert.equal(view.metrics.bestPace.distance, "1.50");
  assert.equal(view.metrics.exerciseMiles, "35.70");
  assert.equal(view.metrics.walkingMiles, "14.00");
  assert.equal(view.metrics.longest.display, "36:00");
  assert.equal(view.metrics.longest.date, "2026-09-25");
  assert.deepEqual(Array.from(view.metrics.benchmarks, (item) => item.date), ["2026-09-12", "2026-09-26"]);
  assert.equal(view.metrics.excluded.length, 1);
  assert.equal(view.metrics.excluded[0].row.date, "2026-09-19");
  assert.equal(view.trend, "insufficient data");
  assert.equal(view.previewTrend, "normal progression");
  assert.deepEqual(Array.from(view.metrics.weeks, (week) => week.exerciseTh), [8500, 8700, 7600, 10900]);
  assert.deepEqual(Array.from(view.metrics.weeks, (week) => week.walkingTh), [3500, 3700, 3300, 3500]);
  assert.deepEqual(Array.from(view.metrics.weeks, (week) => week.continuousSec), [1755, 1960, 1680, 2160]);
  assert.deepEqual(Array.from(view.metrics.weeks, (week) => week.walkBreaks), [3, 0, 2, 0]);
  assert.equal(view.recent[0].date, "2026-09-27");
  assert.equal(view.recent[0].activityType, "Recovery Walk");
  assert.deepEqual(
    Array.from(view.recent.filter((item) => item.date === "2026-09-26"), (item) => item.activityType),
    ["Exercise at La Pista", "Walking to a Place", "Walking to a Place"],
  );
});

test("a real row replaces mock data in every KPI", () => {
  const parsed = api.parseCsv(csv);
  const real = api.parseCsv(row(
    "2026-10-02,5,Exercise at La Pista,2-mile benchmark,2.00,15:30,7:45,15:30,0,8,high,yes,First logged benchmark,yes,manual,,,,,,",
  ));
  assert.equal(real.errors.length, 0);
  const view = api.buildView({ rows: parsed.rows.concat(real.rows), errors: [] });
  assert.equal(view.showingMock, false);
  assert.equal(view.hiddenMockCount, 26);
  assert.equal(view.metrics.bestTwoMile.display, "15:30");
  assert.equal(view.metrics.exerciseMiles, "2.00");
  assert.equal(view.metrics.walkingMiles, "0.00");
  assert.equal(view.metrics.longest.display, "15:30");
  assert.equal(view.metrics.benchmarks.length, 1);
  assert.equal(view.recent.length, 1);
});

test("impossible paces and short segments do not become records", () => {
  const parsed = api.parseCsv(row([
    "2026-10-03,5,Exercise at La Pista,Bad test,2.00,5:00,2:30,5:00,0,9,high,yes,impossible,yes,manual,,,,,,",
    "2026-10-04,5,Running at the Beach,Strides,0.20,1:12,6:00,1:12,0,6,high,yes,short,no,manual,,,,,,",
    "2026-10-04,5,Running at the Beach,Steady,1.50,12:15,8:10,12:15,0,7,high,yes,steady,no,manual,,,,,,",
    "2026-10-05,5,Walking to a Place,TO TRACK,1.00,20:00,20:00,0:00,0,2,low,yes,transport,no,manual,,,,,,",
  ].join("\n")));
  assert.equal(parsed.errors.length, 0);
  const view = api.buildView(parsed);
  assert.equal(view.showingMock, false);
  assert.equal(view.anomalies.length, 1);
  assert.match(view.anomalies[0].anomalies[0], /impossible pace/);
  assert.equal(view.metrics.bestTwoMile, null);
  assert.equal(view.metrics.bestPace.display, "8:10");
  assert.equal(view.metrics.exerciseMiles, "1.70");
  assert.equal(view.metrics.walkingMiles, "1.00");
});

test("a broken benchmark stays in mileage and off the chart", () => {
  const parsed = api.parseCsv(row([
    "2026-10-04,5,Exercise at La Pista,Broken 2-mile,2.00,18:30,9:15,12:00,2,7,moderate,partial,breaks,yes,manual,,,,,,",
    "2026-10-05,6,Exercise at La Pista,2-mile benchmark,2.00,16:52,8:26,16:52,0,8,high,yes,clean,yes,manual,,,,,,",
  ].join("\n")));
  const view = api.buildView(parsed);
  assert.equal(view.metrics.benchmarks.length, 1);
  assert.equal(view.metrics.benchmarks[0].date, "2026-10-05");
  assert.equal(view.metrics.exerciseMiles, "4.00");
  assert.equal(view.metrics.excluded.length, 1);
});

test("pace mismatches and bad activity types are rejected", () => {
  const badPace = api.parseCsv(row(
    "2026-10-06,5,Running at the Beach,Easy aerobic,2.00,18:00,9:05,18:00,0,4,moderate,yes,off,no,manual,,,,,,",
  ));
  assert.ok(badPace.errors.some((issue) => /pace/.test(issue.message)));
  assert.equal(badPace.rows.length, 0);

  const badType = api.parseCsv(row(
    "2026-10-06,5,Jog,Easy aerobic,2.00,18:00,9:00,18:00,0,4,moderate,yes,off,no,manual,,,,,,",
  ));
  assert.ok(badType.errors.some((issue) => /activity_type/.test(issue.message)));
});

test("the page header is the program title", () => {
  const html = readFileSync(new URL("index.html", root), "utf8");
  assert.match(html, /RUNNING — 2-MILE SPEED · ENDURANCE · WEEKLY PROGRESS/);
});
