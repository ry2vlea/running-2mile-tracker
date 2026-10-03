import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const context = { console };
vm.createContext(context);
context.globalThis = context;
vm.runInContext(readFileSync(new URL("app.js", root), "utf8"), context);
vm.runInContext(readFileSync(new URL("health.js", root), "utf8"), context);
const api = context.HealthOS;

function read(name) {
  return readFileSync(new URL(name, root), "utf8");
}

function model(extra) {
  return api.build({
    today: "2026-10-03",
    now: "2026-10-03T20:00:00-04:00",
    runningText: read("data/running_data.csv"),
    bodyText: read("data/body.csv"),
    nutritionText: read("data/nutrition.csv"),
    sleepText: read("data/sleep.csv"),
    activityText: read("data/activity.csv"),
    recoveryText: read("data/recovery.csv"),
    planText: read("data/training_plan.csv"),
    projects: JSON.parse(read("data/projects.json")),
    coach: {
      generated_at: "2026-10-03T18:00:00-04:00",
      data_source: "mock",
      key_numbers: ["Day score 72"],
      today_action: "Easy day.",
      note: "MOCK",
    },
    ...extra,
  });
}

test("the sample day has a full scorecard and a fresh mock coach", () => {
  const built = model();
  assert.equal(built.scorecard.dayScore, 72);
  assert.equal(built.scorecard.partial, false);
  assert.equal(built.scorecard.subs.movement, 80);
  assert.equal(built.scorecard.subs.training, 30);
  assert.equal(built.scorecard.subs.nutrition, 100);
  assert.equal(built.scorecard.subs.hydration, 80);
  assert.equal(built.scorecard.subs.recovery, 58);
  assert.equal(built.scorecard.subs.sleep, 81);
  assert.equal(built.scorecard.win, "nutrition");
  assert.equal(built.scorecard.watch, "training");
  assert.equal(built.scorecard.readiness, 58);
  assert.equal(built.cards.nutrition.kcal, 2280);
  assert.equal(built.cards.nutrition.protein, 142);
  assert.equal(built.prediction.display, "16:28");
  assert.match(built.prediction.method, /estimate, not a race prediction/);
  assert.equal(built.bestBenchmark.display, "16:52");
  assert.equal(built.coach.mock, true);
  assert.equal(built.coach.stale, false);
  assert.equal(built.coach.label, "Oct 3, 2026, 6:00 PM");
});

test("food rows are not added on top of the daily total", () => {
  const built = model();
  assert.equal(built.cards.nutrition.kcal, 2280);
  const oats = built.streams.nutrition.find((row) => row.name === "MOCK oats");
  assert.equal(oats.kcal, 420);
});

test("heat and treadmill estimates sit beside the raw pace", () => {
  const pace = context.RunningDashboard.comparedPace;
  assert.equal(pace({ activityType: "Treadmill", paceSec: 600, inclinePct: 0 }).seconds, 624);
  assert.equal(pace({ activityType: "Treadmill", paceSec: 600, inclinePct: 1 }).seconds, 600);
  assert.equal(pace({ activityType: "Running at the Beach", paceSec: 500, dewPointF: 70 }).seconds, 550);
  assert.equal(pace({ activityType: "Running at the Beach", paceSec: 500 }), null);
  assert.equal(pace({ activityType: "Walking to a Place", paceSec: 600, tempF: 90, humidityPct: 80 }), null);
  const built = context.RunningDashboard.validateRaw({
    date: "2026-10-03", week: "1", activity_type: "Treadmill", workout: "Easy",
    distance_mi: "2.00", duration: "18:00", pace_per_mi: "9:00", continuous_running_time: "18:00",
    walk_breaks: "0", rpe: "4", energy: "moderate", completed: "yes", notes: "",
    is_benchmark: "yes", data_source: "manual", incline_pct: "0",
  });
  assert.equal(built.errors.length, 0);
  const view = context.RunningDashboard.buildView({ rows: [built.row], errors: [] });
  assert.equal(view.metrics.bestTwoMile, null);
});

test("SUB-15 progress and targets come from the logs", () => {
  const project = model().projects.find((item) => item.id === "sub-15");
  assert.equal(project.percent, 30);
  assert.equal(project.current, "16:52");
  const targets = Object.fromEntries(project.targets.map((item) => [item.id, item]));
  assert.equal(targets.sleep.met, false);
  assert.equal(targets.sleep.display, "6:42");
  assert.equal(targets.protein.met, true);
  assert.equal(targets.protein.display, "141.7 g");
  assert.equal(targets.miles.met, true);
  assert.equal(targets.miles.display, "8.70 mi");
  assert.equal(targets.recovery.met, false);
  assert.equal(targets.recovery.display, "68.6");
  assert.equal(targets.consistency.met, true);
  assert.equal(targets.consistency.display, "100% (10/10)");
  for (const id of ["body", "sleep-reset", "consistency-30"]) {
    assert.equal(model().projects.find((item) => item.id === id).status, "placeholder");
  }
});

test("a coach note goes stale only after two full days", () => {
  const fresh = api.coachState({ generated_at: "2026-10-03T18:00:00-04:00", data_source: "mock" }, "2026-10-05T18:00:00-04:00");
  const stale = api.coachState({ generated_at: "2026-10-03T18:00:00-04:00", data_source: "mock" }, "2026-10-05T18:00:01-04:00");
  assert.equal(fresh.stale, false);
  assert.equal(stale.stale, true);
  assert.equal(api.coachState(null, "2026-10-03T20:00:00-04:00").missing, true);
});

test("calorie points, partial days, and a daily row beat food rows", () => {
  const header = "date,week,activity_type,workout,distance_mi,duration,pace_per_mi,continuous_running_time,walk_breaks,rpe,energy,completed,notes,is_benchmark,data_source,avg_hr,max_hr,avg_cadence,active_calories,stride_length_m,ground_contact_time_ms\n";
  const built = api.build({
    today: "2026-10-03",
    now: "2026-10-03T12:00:00Z",
    runningText: header,
    bodyText: "date,height_cm,weight_kg,bmi,body_fat_pct,waist_cm,chest_cm,hips_cm,data_source,notes\n",
    nutritionText: [
      "date,row_kind,name,kcal,protein_g,carbs_g,fat_g,hydration_ml,data_source,notes",
      "2026-10-03,daily,Daily total,2900,,0,0,1000,manual,band",
      "2026-10-03,food,Extra,500,40,0,0,,manual,ignored",
    ].join("\n"),
    sleepText: "date,duration,bedtime,wake,rem,deep,core,awake,in_bed,data_source,notes\n2026-10-03,8:00:00,22:30,06:30,1:50:00,1:30:00,4:40:00,0:20:00,8:20:00,manual,ok\n",
    activityText: "date,steps,distance_mi,active_kcal,basal_kcal,total_kcal,data_source,notes\n2026-10-03,4000,1.00,100,100,200,manual,ok\n",
    recoveryText: "date,hrv_ms,resting_hr,soreness,fatigue,readiness,data_source,notes\n2026-10-03,,,3,3,,manual,formula\n",
    planText: "date,session,goal,notes,data_source\n",
    projects: { projects: [] },
    coach: null,
  });
  assert.equal(built.cards.nutrition.kcal, 2900);
  assert.equal(built.scorecard.subs.nutrition, 96);
  assert.equal(built.scorecard.subs.movement, 50);
  assert.equal(built.scorecard.subs.hydration, 40);
  assert.equal(built.scorecard.subs.sleep, 100);
  assert.equal(built.scorecard.subs.recovery, 68);
  assert.equal(built.scorecard.subs.training, null);
  assert.equal(built.scorecard.partial, false);
  assert.equal(built.coach.missing, true);

  const partial = api.build({
    today: "2026-10-04",
    now: "2026-10-04T12:00:00Z",
    runningText: header,
    bodyText: "date,height_cm,weight_kg,bmi,body_fat_pct,waist_cm,chest_cm,hips_cm,data_source,notes\n",
    nutritionText: "date,row_kind,name,kcal,protein_g,carbs_g,fat_g,hydration_ml,data_source,notes\n2026-10-04,daily,Daily total,,,0,0,2500,manual,water\n",
    sleepText: "date,duration,bedtime,wake,rem,deep,core,awake,in_bed,data_source,notes\n2026-10-04,7:30:00,23:00,06:30,1:40:00,1:20:00,4:30:00,0:10:00,7:40:00,manual,ok\n",
    activityText: "date,steps,distance_mi,active_kcal,basal_kcal,total_kcal,data_source,notes\n2026-10-04,8000,2.00,100,100,200,manual,ok\n",
    recoveryText: "date,hrv_ms,resting_hr,soreness,fatigue,readiness,data_source,notes\n",
    planText: "date,session,goal,notes,data_source\n",
    projects: { projects: [] },
    coach: null,
  });
  assert.equal(partial.scorecard.subs.movement, 100);
  assert.equal(partial.scorecard.subs.hydration, 100);
  assert.equal(partial.scorecard.subs.sleep, 100);
  assert.equal(partial.scorecard.subs.nutrition, null);
  assert.equal(partial.scorecard.present, 3);
  assert.equal(partial.scorecard.partial, true);
  assert.equal(partial.scorecard.dayScore, 100);
});

test("the screens name the coach and keep the training title", () => {
  const ui = read("ui.js");
  const html = read("index.html");
  assert.match(html, /My Health OS/);
  assert.match(ui, /AI Coach/);
  assert.match(ui, /AI-generated/);
  assert.match(ui, /data-stale/);
  assert.match(ui, /id="scorecard"/);
  assert.match(ui, /RUNNING — 2-MILE SPEED · ENDURANCE · WEEKLY PROGRESS/);
  assert.match(ui, /Am I actually changing\?/);
  assert.match(ui, /Copy my summary/);
  assert.match(ui, /Paste coach update/);
  assert.match(ui, /Clearing browser data deletes it/);
  assert.doesNotMatch(ui, /ai_coach\.json/);
  assert.doesNotMatch(ui, /id="relationships"/);
  assert.doesNotMatch(read("store.js"), /fetch\(/);
  assert.doesNotMatch(read("index.html"), /cdn|google-analytics|googletagmanager/i);
});
