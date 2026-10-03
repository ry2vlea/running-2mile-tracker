import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const context = { console };
vm.createContext(context);
context.globalThis = context;
vm.runInContext(readFileSync(new URL("app.js", root), "utf8"), context);
vm.runInContext(readFileSync(new URL("store.js", root), "utf8"), context);
const storeApi = context.HealthStore;

function memory() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKQuantityTypeIdentifierStepCount" unit="count" value="1000" startDate="2026-10-01 08:00:00 -0400" endDate="2026-10-01 09:00:00 -0400"/>
  <Record type="HKQuantityTypeIdentifierStepCount" unit="count" value="500" startDate="2026-10-01 10:00:00 -0400" endDate="2026-10-01 11:00:00 -0400"/>
  <Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" unit="mi" value="2.5" startDate="2026-10-01 08:00:00 -0400" endDate="2026-10-01 09:00:00 -0400"/>
  <Record type="HKQuantityTypeIdentifierActiveEnergyBurned" unit="kcal" value="300" startDate="2026-10-01 08:00:00 -0400" endDate="2026-10-01 09:00:00 -0400"/>
  <Record type="HKQuantityTypeIdentifierBasalEnergyBurned" unit="kJ" value="418.4" startDate="2026-10-01 08:00:00 -0400" endDate="2026-10-01 09:00:00 -0400"/>
  <Record type="HKQuantityTypeIdentifierRestingHeartRate" unit="count/min" value="58" startDate="2026-10-01 07:00:00 -0400" endDate="2026-10-01 07:00:00 -0400"/>
  <Record type="HKQuantityTypeIdentifierRestingHeartRate" unit="count/min" value="60" startDate="2026-10-01 07:05:00 -0400" endDate="2026-10-01 07:05:00 -0400"/>
  <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" unit="ms" value="40" startDate="2026-10-01 07:00:00 -0400" endDate="2026-10-01 07:00:00 -0400"/>
  <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" unit="ms" value="50" startDate="2026-10-01 07:05:00 -0400" endDate="2026-10-01 07:05:00 -0400"/>
  <Record type="HKQuantityTypeIdentifierBodyMass" unit="lb" value="180" startDate="2026-10-01 07:00:00 -0400" endDate="2026-10-01 07:00:00 -0400"/>
  <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-09-30 23:00:00 -0400" endDate="2026-10-01 03:00:00 -0400"/>
  <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepDeep" startDate="2026-10-01 03:00:00 -0400" endDate="2026-10-01 04:00:00 -0400"/>
  <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepREM" startDate="2026-10-01 04:00:00 -0400" endDate="2026-10-01 05:30:00 -0400"/>
  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" totalDistance="5" totalDistanceUnit="km" startDate="2026-10-01 07:00:00 -0400" endDate="2026-10-01 07:30:00 -0400"/>
  <Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="20" durationUnit="min" totalDistance="1" totalDistanceUnit="mi" startDate="2026-10-01 18:00:00 -0400" endDate="2026-10-01 18:20:00 -0400"/>
  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="20" durationUnit="min" totalDistance="2" totalDistanceUnit="mi" startDate="2026-10-02 07:00:00 -0400" endDate="2026-10-02 07:20:00 -0400"/>
</HealthData>`;

test("demo stays on until a real row exists and never uses that row with the sample", () => {
  storeApi.useStorage(memory());
  const empty = storeApi.load();
  assert.equal(storeApi.hasRealData(empty), false);
  assert.equal(storeApi.demoActive(empty), true);
  storeApi.setDemo(false);
  assert.equal(storeApi.demoActive(empty), false);
  storeApi.setDemo(true);
  const saved = storeApi.emptyStore();
  saved.running.push({ date: "2026-10-03", activity_type: "Treadmill", data_source: "manual", distance_mi: "1.00" });
  storeApi.save(saved);
  assert.equal(storeApi.demoActive(storeApi.load()), false);
  const texts = storeApi.storeToTexts(storeApi.load());
  assert.match(texts.runningText, /Treadmill/);
  assert.doesNotMatch(texts.runningText, /mock/);
});

test("a saved coach note turns demo off", () => {
  storeApi.useStorage(memory());
  const parsed = storeApi.parseCoachUpdate("Keep the run easy.\nDay score 70\nSleep 7:10");
  assert.equal(parsed.coach.today_action, "Keep the run easy.");
  assert.equal(parsed.coach.key_numbers[0], "Day score 70");
  assert.equal(parsed.coach.key_numbers[1], "Sleep 7:10");
  const json = storeApi.parseCoachUpdate('{"today_action":"Rest","key_numbers":["HRV 50"],"note":"short"}');
  assert.equal(json.coach.today_action, "Rest");
  const store = storeApi.emptyStore();
  store.coach = json.coach;
  storeApi.save(store);
  assert.equal(storeApi.demoActive(storeApi.load()), false);
});

test("apple health xml is parsed locally and does not replace a manual run", () => {
  storeApi.useStorage(memory());
  let store = storeApi.emptyStore();
  store.activity.push({ date: "2026-10-01", steps: "1111", distance_mi: "1.00", active_kcal: "100", basal_kcal: "100", total_kcal: "200", data_source: "manual", notes: "keep me" });
  store.running.push({
    date: "2026-10-02", week: "5", activity_type: "Running at the Beach", workout: "Easy",
    distance_mi: "2.00", duration: "18:00", pace_per_mi: "9:00", continuous_running_time: "18:00",
    walk_breaks: "0", rpe: "4", energy: "moderate", completed: "yes", notes: "keep",
    is_benchmark: "no", data_source: "manual",
  });
  store = storeApi.importAppleHealth(store, xml);
  store = storeApi.importAppleHealth(store, xml);
  const manual = store.activity.filter((row) => row.data_source === "manual");
  const imported = store.activity.filter((row) => row.data_source === "apple_health_import" && row.date === "2026-10-01");
  assert.equal(manual.length, 1);
  assert.equal(manual[0].steps, "1111");
  assert.equal(imported.length, 1);
  assert.equal(imported[0].steps, "1500");
  assert.equal(imported[0].basal_kcal, "100");
  assert.equal(store.body[0].weight_kg, "81.65");
  assert.equal(store.recovery[0].resting_hr, "59");
  assert.equal(store.recovery[0].hrv_ms, "45");
  assert.equal(store.sleep[0].date, "2026-10-01");
  assert.equal(store.sleep[0].duration, "6:30:00");
  assert.equal(store.sleep[0].core, "4:00:00");
  assert.equal(store.sleep[0].deep, "1:00:00");
  assert.equal(store.sleep[0].rem, "1:30:00");
  const beach = store.running.find((row) => row.data_source === "apple_health_import" && row.activity_type === "Running at the Beach");
  assert.equal(beach.distance_mi, "3.11");
  assert.equal(beach.pace_per_mi, "9:39");
  const walk = store.running.find((row) => row.activity_type === "Walking to a Place");
  assert.equal(walk.continuous_running_time, "0:00");
  assert.equal(store.running.filter((row) => row.data_source === "apple_health_import").length, 2);
  assert.equal(store.running.some((row) => row.date === "2026-10-02" && row.data_source === "apple_health_import"), false);
  const built = context.RunningDashboard.validateRaw(beach);
  assert.equal(built.errors.length, 0);
});

test("a bad pace is rejected and a check-in uses the same ranges", () => {
  const bad = context.RunningDashboard.validateRaw({
    date: "2026-10-03", week: "1", activity_type: "Running at the Beach", workout: "Easy",
    distance_mi: "3.00", duration: "27:00", pace_per_mi: "8:00", continuous_running_time: "27:00",
    walk_breaks: "0", rpe: "4", energy: "moderate", completed: "yes", notes: "",
    is_benchmark: "no", data_source: "manual",
  });
  assert.equal(bad.row, null);
  assert.match(bad.errors.map((issue) => issue.message).join(" "), /pace/);
  const checkin = storeApi.applyCheckin(storeApi.emptyStore(), { date: "2026-10-03", weight: "10", sleep: "7:30" });
  assert.ok(checkin.errors.some((message) => message.includes("weight_kg")));
  const ok = storeApi.applyCheckin(storeApi.emptyStore(), { date: "2026-10-03", weight: "78.1", sleep: "7:30", steps: "6400" });
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.store.sleep[0].duration, "7:30:00");
  assert.equal(ok.store.activity[0].steps, "6400");
});
