/* Screens for My Health OS. Demo files are public and fake.
   A real log is read from this browser only. */

const ROUTES = [
  ["today", "Today"],
  ["log", "Log"],
  ["body", "Body"],
  ["nutrition", "Nutrition"],
  ["sleep", "Sleep"],
  ["activity", "Activity"],
  ["training", "Training"],
  ["recovery", "Recovery"],
  ["trends", "Trends"],
  ["goals", "Goals"],
  ["coach", "Coach"],
];

const DEMO_FILES = {
  runningText: "data/running_data.csv",
  bodyText: "data/body.csv",
  nutritionText: "data/nutrition.csv",
  sleepText: "data/sleep.csv",
  activityText: "data/activity.csv",
  recoveryText: "data/recovery.csv",
  planText: "data/training_plan.csv",
};

let model = null;
let route = "today";
let demo = true;
let listening = false;
const PRIVACY = "Your data stays in this browser. Clearing browser data deletes it. Export a backup first. Nothing is uploaded.";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function formatLong(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return days[date.getUTCDay()] + ", " + months[month - 1] + " " + day;
}

function signed(value, digits) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const shown = digits === undefined ? String(value) : Number(value).toFixed(digits);
  return (value > 0 ? "+" : "") + shown;
}

function mockBanner(label) {
  return '<div class="banner" role="status"><strong>Mock data</strong>' + escapeHtml(label) + "</div>";
}

function meter(score) {
  const width = score === null || score === undefined ? 0 : Math.max(0, Math.min(100, score));
  return '<div class="meter" aria-hidden="true"><span style="width:' + width + '%"></span></div>';
}

function coachBadges(coach) {
  const bits = ['<span class="badge">AI-generated</span>'];
  if (coach.mock) bits.push('<span class="badge warn">Mock</span>');
  if (coach.stale) bits.push('<span class="badge flag" data-stale="true">Stale</span>');
  if (coach.generatedAt) bits.push('<time datetime="' + escapeHtml(coach.generatedAt) + '">' + escapeHtml(coach.label) + "</time>");
  return '<p class="kicker">' + bits.join(" ") + "</p>";
}

function coachNumbers(doc) {
  const numbers = doc.key_numbers;
  const list = Array.isArray(numbers) ? numbers : String(numbers || "").split("\n").filter(Boolean);
  const items = list.map((item) => "<li>" + escapeHtml(item) + "</li>").join("");
  return (items ? "<ul>" + items + "</ul>" : "")
    + "<h3>Today's action</h3><p>" + escapeHtml(doc.today_action || "No action yet.") + "</p>"
    + (doc.note ? "<p class=\"lede\">" + escapeHtml(doc.note) + "</p>" : "");
}

function coachCard(compact) {
  const coach = model.coach;
  const tools = '<div class="actions"><button type="button" class="copy-summary">Copy my summary</button></div><p class="copy-status lede" role="status"></p>';
  if (coach.missing) {
    return '<article class="card coach-card"><h2>AI Coach</h2><p class="lede">No note on this device yet. Copy a summary, paste it to your assistant, then paste the reply on the Coach screen. This page does not call an API.</p>' + tools + "</article>";
  }
  return '<article class="card coach-card" data-coach="' + (coach.stale ? "stale" : "fresh") + '">'
    + coachBadges(coach)
    + "<h2>AI Coach</h2>"
    + '<p class="lede">Saved in this browser. The page does not send it anywhere.</p>'
    + coachNumbers(coach.coach || {})
    + tools
    + "</article>";
}

function renderToday() {
  const score = model.scorecard;
  const cards = model.cards;
  const balance = cards.energy.balance;
  const metrics = [
    ["Body", cards.body.weight === null ? "—" : cards.body.weight.toFixed(1) + " kg", cards.body.trend],
    ["Sleep", cards.sleep.duration, cards.sleep.score === null ? "No score" : "Score " + cards.sleep.score],
    ["Nutrition", cards.nutrition.kcal === null ? "—" : cards.nutrition.kcal + " kcal", cards.nutrition.protein === null ? "" : cards.nutrition.protein + " g protein"],
    ["Activity", cards.activity.steps === null ? "—" : cards.activity.steps.toLocaleString("en-US") + " steps", cards.activity.miles === null ? "" : cards.activity.miles.toFixed(2) + " mi today"],
    ["Energy", cards.energy.burned === null ? "—" : cards.energy.burned + " kcal", balance === null ? "" : signed(balance, 0) + " kcal balance"],
    ["Heart", cards.heart.rhr === null ? "—" : cards.heart.rhr + " bpm", cards.heart.hrv === null ? "" : cards.heart.hrv + " ms HRV"],
  ];
  const metricHtml = metrics.map(([label, value, detail]) => (
    '<article class="kpi"><p class="kpi-label">' + escapeHtml(label) + '</p><p class="kpi-value">' + escapeHtml(value) + '</p><p class="kpi-detail">' + escapeHtml(detail) + "</p></article>"
  )).join("");
  const subs = ["movement", "training", "nutrition", "hydration", "recovery", "sleep"].map((id) => {
    const value = score.subs[id];
    return '<div class="sub"><div class="sub-top"><span>' + model.subLabels[id] + "</span><strong>" + (value === null ? "—" : value) + "</strong></div>" + meter(value) + "</div>";
  }).join("");
  const plan = model.planToday;
  const best = model.bestBenchmark;
  const banner = demo
    ? mockBanner(" Demo mode. These rows are fake and are not mixed with a log on this device.")
    : "";
  return banner
    + '<p class="date-line">' + escapeHtml(formatLong(model.today)) + "</p>"
    + '<article class="card readiness"><p class="kpi-label">Readiness</p><p class="score-big">' + escapeHtml(score.readiness === null ? "—" : score.readiness) + "</p>"
    + meter(score.readiness) + '<p class="lede">' + escapeHtml(score.readinessMethod) + "</p></article>"
    + coachCard(true)
    + '<section class="kpis" aria-label="Today">' + metricHtml + "</section>"
    + '<article class="card"><h2>Today\'s plan</h2>'
    + (plan ? "<p class=\"session\">" + escapeHtml(plan.session) + "</p><p class=\"lede\">Goal " + escapeHtml(plan.goal) + "</p>" : "<p class=\"empty\">No plan row for this date.</p>")
    + "<p>Best valid 2-mile: <strong>" + (best ? escapeHtml(best.display) + "</strong> on " + escapeHtml(best.date) : "—</strong>") + "</p>"
    + "<p>Predicted time: <strong>" + escapeHtml(model.prediction.display || "—") + "</strong></p>"
    + '<p class="lede">' + escapeHtml(model.prediction.method) + "</p></article>"
    + '<section class="card" id="scorecard"><h2>Day score</h2><p class="score-big">' + escapeHtml(score.dayScore === null ? "—" : score.dayScore) + "</p>"
    + (score.partial ? '<p class="lede">Partial score. Fewer than four subscores were logged.</p>' : "")
    + "<p>Win of the day: <strong>" + escapeHtml(score.win ? model.subLabels[score.win] : "—") + "</strong></p>"
    + "<p>Watch item: <strong>" + escapeHtml(score.watch ? model.subLabels[score.watch] : "—") + "</strong></p>"
    + subs + "</section>";
}

function rowsTable(headers, rows) {
  if (!rows.length) return '<p class="empty">Nothing logged in this stream.</p>';
  const head = headers.map((header) => "<th>" + escapeHtml(header) + "</th>").join("");
  const body = rows.map((row) => "<tr>" + row.map((cell) => "<td>" + escapeHtml(cell) + "</td>").join("") + "</tr>").join("");
  return '<div class="table-wrap"><table><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
}

function recent(rows, limit) {
  const sorted = rows.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  return limit ? sorted.slice(0, limit) : sorted;
}

function renderBody() {
  const meta = model.streamMeta.body;
  const rows = recent(model.streams.body).map((row) => [
    row.date,
    row.weightKg === null ? "—" : row.weightKg.toFixed(1),
    row.bmi === null ? "—" : row.bmi.toFixed(1),
    row.bodyFat === null ? "—" : row.bodyFat.toFixed(1),
    [row.waist, row.chest, row.hips].every((value) => value === null) ? "—" : [row.waist, row.chest, row.hips].map((value) => value ?? "—").join(" / "),
  ]);
  return (meta.mockOnly ? mockBanner("Body rows are a labeled sample.") : "")
    + "<h2>Body</h2>"
    + '<p class="lede">Weight, BMI, and the measurements you choose to log. Today’s 30-day change is ' + escapeHtml(model.cards.body.trend) + ".</p>"
    + rowsTable(["Date", "kg", "BMI", "Fat %", "Waist / chest / hips"], rows);
}

function renderNutrition() {
  const meta = model.streamMeta.nutrition;
  const daily = recent(model.streams.nutrition.filter((row) => row.rowKind === "daily"));
  const food = model.streams.nutrition.filter((row) => row.rowKind === "food" && row.date === model.today);
  return (meta.mockOnly ? mockBanner("Nutrition rows are a labeled sample.") : "")
    + "<h2>Nutrition</h2>"
    + '<p class="lede">A daily row is the total. Food rows on the same date are detail and are not added on top.</p>'
    + rowsTable(["Date", "kcal", "Protein", "Carbs", "Fat", "Water ml"], daily.map((row) => [
      row.date, row.kcal ?? "—", row.protein ?? "—", row.carbs ?? "—", row.fat ?? "—", row.hydration ?? "—",
    ]))
    + (food.length ? "<h3>Food detail for " + escapeHtml(model.today) + "</h3>" + rowsTable(["Name", "kcal", "Protein"], food.map((row) => [row.name, row.kcal ?? "—", row.protein ?? "—"])) : "");
}

function renderSleep() {
  const meta = model.streamMeta.sleep;
  const debt = model.sleepDebt;
  return (meta.mockOnly ? mockBanner("Sleep rows are a labeled sample.") : "")
    + "<h2>Sleep</h2>"
    + '<p class="lede">The date is the morning you woke up. Sleep debt over 7 days, against 7:30 a night, is ' + escapeHtml(debt.display) + ".</p>"
    + rowsTable(["Date", "Asleep", "Bed", "Wake", "Core", "Deep", "REM"], recent(model.streams.sleep).map((row) => [
      row.date,
      row.durationSec === null ? "—" : clockText(row.durationSec),
      row.bedtime || "—",
      row.wake || "—",
      row.coreSec === null ? "—" : clockText(row.coreSec),
      row.deepSec === null ? "—" : clockText(row.deepSec),
      row.remSec === null ? "—" : clockText(row.remSec),
    ]));
}

function clockText(seconds) {
  const left = Math.max(0, Math.round(seconds));
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left - hours * 3600) / 60);
  const secs = left - hours * 3600 - minutes * 60;
  if (!hours) return minutes + ":" + String(secs).padStart(2, "0");
  if (!secs) return hours + ":" + String(minutes).padStart(2, "0");
  return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
}

function renderActivity() {
  const meta = model.streamMeta.activity;
  return (meta.mockOnly ? mockBanner("Activity rows are daily totals, separate from the training log.") : "")
    + "<h2>Activity</h2>"
    + '<p class="lede">Steps and calories for the day. Exercise miles stay on Training and are not added to this distance.</p>'
    + rowsTable(["Date", "Steps", "Distance", "Active", "Basal", "Total"], recent(model.streams.activity).map((row) => [
      row.date, row.steps ?? "—", row.distanceMi === null ? "—" : row.distanceMi.toFixed(2), row.activeKcal ?? "—", row.basalKcal ?? "—", row.totalKcal ?? "—",
    ]));
}

function renderRecovery() {
  const meta = model.streamMeta.recovery;
  return (meta.mockOnly ? mockBanner("Recovery rows are a labeled sample.") : "")
    + "<h2>Recovery</h2>"
    + rowsTable(["Date", "HRV", "RHR", "Soreness", "Fatigue", "Readiness"], recent(model.streams.recovery).map((row) => [
      row.date, row.hrv ?? "—", row.rhr ?? "—", row.soreness ?? "—", row.fatigue ?? "—", row.readiness ?? "—",
    ]));
}

function renderTraining() {
  const banner = model.streamMeta.running.mockOnly ? mockBanner("Training rows are a labeled sample until a real workout is logged.") : "";
  return banner + '<h2 class="program-title">RUNNING — 2-MILE SPEED · ENDURANCE · WEEKLY PROGRESS</h2>'
    + '<div id="status"></div><section id="kpis" class="kpis" aria-label="Key numbers"></section>'
    + '<div class="charts"><article class="card" id="chart-two-mile"></article><article class="card" id="chart-endurance"></article><article class="card" id="chart-weekly"></article></div>'
    + '<section class="card" id="recent" aria-label="Recent activities"></section><section id="flagged"></section>';
}

function renderTrends() {
  const rows = model.trends.map((item) => (
    '<li class="' + (item.status === "insufficient" ? "quiet" : "") + '"><strong>' + escapeHtml(item.label) + "</strong><p>" + escapeHtml(item.text) + "</p></li>"
  )).join("");
  return "<h2>Am I actually changing?</h2>"
    + '<p class="lede">Last 7 days against the 7 days before that. A window with fewer than 3 points says insufficient data.</p>'
    + '<ul class="stack">' + rows + "</ul>";
}

function renderGoals() {
  const cards = model.projects.map((project) => {
    if (project.status === "placeholder") {
      return '<article class="card project"><p class="kicker"><span class="badge warn">Placeholder</span></p><h2>' + escapeHtml(project.name) + "</h2><p>" + escapeHtml(project.goal) + "</p><p class=\"lede\">No live targets yet, so this card does not invent a progress number.</p></article>";
    }
    const targets = project.targets.map((target) => (
      '<li><span class="badge ' + (target.met ? "" : "flag") + '">' + (target.met ? "Met" : "Not yet") + "</span> "
      + escapeHtml(target.label) + " <strong>" + escapeHtml(target.display) + "</strong></li>"
    )).join("");
    return '<article class="card project"><h2>' + escapeHtml(project.name) + "</h2><p>" + escapeHtml(project.goal) + "</p>"
      + '<p class="score-big">' + escapeHtml(project.percent === null ? "—" : project.percent + "%") + "</p>"
      + meter(project.percent)
      + "<p>Current best " + escapeHtml(project.current || "—") + " · start " + escapeHtml(project.start) + " · goal " + escapeHtml(project.goal_time) + "</p>"
      + '<ul class="stack">' + targets + "</ul></article>";
  }).join("");
  return "<h2>Projects</h2><p class=\"lede\">Targets live in data/projects.json. Status is calculated from the logs.</p>" + cards;
}

function field(name, label, type, value, extra) {
  return '<label>' + escapeHtml(label) + '<input name="' + name + '" type="' + (type || "text") + '" value="' + escapeHtml(value || "") + '"' + (extra || "") + "></label>";
}

function renderLog() {
  const today = demo ? localToday() : model.today;
  const types = globalThis.RunningDashboard.EXERCISE_TYPES.concat(globalThis.RunningDashboard.WALKING_TYPES);
  const options = types.map((type) => '<option>' + escapeHtml(type) + "</option>").join("");
  return '<div class="banner" role="status"><strong>On this device only.</strong> ' + escapeHtml(PRIVACY) + "</div>"
    + "<h2>Log</h2>"
    + '<p class="lede">Walk there, the track session, and the walk back are three rows. A treadmill row counts as exercise miles. It is not a 2-mile benchmark.</p>'
    + '<div class="actions"><button type="button" data-preset="there">Walk there</button><button type="button" data-preset="track">Track workout</button><button type="button" data-preset="back">Walk back</button><button type="button" data-preset="treadmill">Treadmill</button></div>'
    + '<form id="activity-form" class="stack-form">'
    + field("date", "Date", "date", today)
    + field("week", "Week", "number", "1", ' min="1"')
    + '<label>Activity<select name="activity_type">' + options + "</select></label>"
    + field("workout", "Workout", "text", "", ' required')
    + field("distance_mi", "Distance (mi)", "text", "", ' inputmode="decimal"')
    + field("duration", "Duration", "text", "", ' placeholder="27:00"')
    + field("pace_per_mi", "Pace / mi", "text", "", ' placeholder="9:00"')
    + field("continuous_running_time", "Continuous", "text", "", ' placeholder="27:00"')
    + field("walk_breaks", "Walk breaks", "number", "0", ' min="0"')
    + field("rpe", "RPE", "number", "4", ' min="1" max="10"')
    + '<label>Energy<select name="energy"><option>low</option><option selected>moderate</option><option>high</option></select></label>'
    + '<label>Completed<select name="completed"><option>yes</option><option>partial</option><option>no</option></select></label>'
    + '<label>Benchmark<select name="is_benchmark"><option>no</option><option>yes</option></select></label>'
    + field("avg_hr", "Avg heart rate", "number", "", ' min="30" max="230"')
    + field("temp_f", "Temp °F", "number", "", ' min="20" max="120"')
    + field("humidity_pct", "Humidity %", "number", "", ' min="0" max="100"')
    + field("incline_pct", "Treadmill incline %", "number", "", ' min="0" max="15" step="0.1"')
    + '<label>Notes<textarea name="notes" rows="2"></textarea></label>'
    + '<p class="lede">Pace updates from duration ÷ distance. Heat and treadmill lines are estimates and do not replace the raw pace. Source is manual.</p>'
    + '<p id="activity-errors" class="form-errors" role="alert"></p>'
    + '<button type="submit">Save activity</button></form>'
    + "<h2>Daily check-in</h2>"
    + '<form id="checkin-form" class="stack-form">'
    + field("date", "Date", "date", today)
    + field("weight", "Weight kg", "text", "", ' inputmode="decimal"')
    + field("height", "Height cm", "text", "", ' inputmode="decimal"')
    + field("kcal", "Calories", "number", "")
    + field("protein", "Protein g", "number", "")
    + field("hydration", "Water ml", "number", "")
    + field("sleep", "Sleep", "text", "", ' placeholder="7:30"')
    + field("steps", "Steps", "number", "")
    + field("readiness", "Readiness", "number", "", ' min="0" max="100"')
    + field("hrv", "HRV ms", "number", "")
    + field("rhr", "Resting HR", "number", "")
    + field("soreness", "Soreness 1–10", "number", "", ' min="1" max="10"')
    + field("fatigue", "Fatigue 1–10", "number", "", ' min="1" max="10"')
    + field("session", "Plan session", "text", "")
    + field("goal", "Plan goal", "text", "")
    + '<button type="submit">Save check-in</button><p id="checkin-errors" class="form-errors" role="alert"></p></form>'
    + "<h2>Import and backup</h2>"
    + '<p class="lede">Choose a CSV, a JSON backup, or an Apple Health export.xml. Unzip the Health export on this device and pick export.xml. The file is parsed here and is not uploaded.</p>'
    + '<form id="import-form" class="stack-form"><label>File<input id="import-file" type="file" accept=".csv,.json,.xml,text/csv,application/json,text/xml"></label>'
    + '<button type="submit">Import into this browser</button><p id="import-status" class="lede" role="status"></p></form>'
    + '<div class="actions"><button type="button" id="export-json">Download JSON backup</button><button type="button" id="export-csv">Download running CSV</button></div>'
    + (demo ? "" : "<h3>Saved activities</h3>" + rowsTable(["Date", "Type", "Workout", "Distance", "Time"], (globalThis.HealthStore.load().running || []).slice().reverse().map((row) => [row.date, row.activity_type, row.workout, row.distance_mi, row.duration])));
}

function renderCoachPage() {
  return '<p class="lede">The coach card is filled on this device. Copy the summary, paste it to your assistant, then paste the reply below.</p>'
    + coachCard(false)
    + '<form id="coach-form" class="stack-form"><label>Paste coach update<textarea id="coach-paste" rows="6" placeholder="First line is today\'s action. More lines are key numbers. JSON is fine."></textarea></label>'
    + '<button type="submit">Save coach update</button><p id="coach-errors" class="form-errors" role="alert"></p></form>';
}

const RENDERERS = {
  today: renderToday,
  log: renderLog,
  body: renderBody,
  nutrition: renderNutrition,
  sleep: renderSleep,
  activity: renderActivity,
  training: renderTraining,
  recovery: renderRecovery,
  trends: renderTrends,
  goals: renderGoals,
  coach: renderCoachPage,
};

function renderNav() {
  const nav = document.querySelector("#nav");
  nav.innerHTML = ROUTES.map(([id, label]) => (
    '<a href="#' + id + '"' + (id === route ? ' aria-current="page"' : "") + ">" + label + "</a>"
  )).join("");
}

function render() {
  const app = document.querySelector("#app");
  app.innerHTML = RENDERERS[route]();
  renderNav();
  renderPrivacy();
  if (route === "training") globalThis.RunningDashboard.presentTraining(model.runningView);
  bindPage();
}

function renderPrivacy() {
  const host = document.querySelector("#privacy");
  if (!host) return;
  const store = globalThis.HealthStore.load();
  const locked = globalThis.HealthStore.hasRealData(store);
  host.hidden = false;
  host.innerHTML = '<p>' + escapeHtml(PRIVACY) + "</p>"
    + '<label class="demo-toggle"><input id="demo-toggle" type="checkbox"' + (demo ? " checked" : "") + (locked ? " disabled" : "") + "> Demo data</label>"
    + (locked ? '<p class="lede">Demo is off because this browser has your log.</p>' : "");
}

function currentRoute() {
  const name = location.hash.replace("#", "") || "today";
  return RENDERERS[name] ? name : "today";
}

function localToday() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

function sampleToday(texts) {
  const dates = [];
  texts.forEach((text) => {
    const found = text.match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [];
    dates.push(...found);
  });
  return dates.sort().at(-1) || localToday();
}

async function loadText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load " + url);
  return response.text();
}

function formRaw(form) {
  const raw = {};
  new FormData(form).forEach((value, key) => { raw[key] = String(value).trim(); });
  return raw;
}

function activityRaw(form) {
  const raw = formRaw(form);
  raw.data_source = "manual";
  raw.dew_point_f = "";
  raw.max_hr = "";
  raw.avg_cadence = "";
  raw.active_calories = "";
  raw.stride_length_m = "";
  raw.ground_contact_time_ms = "";
  if (!raw.pace_per_mi) raw.pace_per_mi = globalThis.RunningDashboard.suggestPace(raw.duration, raw.distance_mi);
  return raw;
}

function showErrors(id, errors) {
  const host = document.querySelector(id);
  if (!host) return;
  host.textContent = errors.join(" ");
}

async function refresh() {
  await boot();
}

function bindPage() {
  const toggle = document.querySelector("#demo-toggle");
  if (toggle && !toggle.dataset.bound) {
    toggle.dataset.bound = "1";
    toggle.addEventListener("change", async () => {
      globalThis.HealthStore.setDemo(toggle.checked);
      await refresh();
    });
  }
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = document.querySelector("#activity-form");
      const preset = button.dataset.preset;
      const set = (name, value) => { const input = form.elements[name]; if (input) input.value = value; };
      if (preset === "there") {
        set("activity_type", "Walking to a Place");
        set("workout", "TO TRACK");
        set("continuous_running_time", "0:00");
        set("is_benchmark", "no");
      } else if (preset === "back") {
        set("activity_type", "Walking to a Place");
        set("workout", "FROM TRACK");
        set("continuous_running_time", "0:00");
        set("is_benchmark", "no");
      } else if (preset === "track") {
        set("activity_type", "Exercise at La Pista");
        set("workout", "");
        set("is_benchmark", "no");
      } else if (preset === "treadmill") {
        set("activity_type", "Treadmill");
        set("workout", "Treadmill");
        set("incline_pct", "1");
        set("is_benchmark", "no");
      }
      const raw = activityRaw(form);
      const built = globalThis.RunningDashboard.validateRaw(raw);
      showErrors("#activity-errors", built.errors.map((issue) => issue.message));
    });
  });
  const activity = document.querySelector("#activity-form");
  if (activity) {
    activity.addEventListener("input", () => {
      const pace = activity.elements.pace_per_mi;
      const suggested = globalThis.RunningDashboard.suggestPace(activity.elements.duration.value, activity.elements.distance_mi.value);
      if (suggested && document.activeElement !== pace) pace.value = suggested;
      const built = globalThis.RunningDashboard.validateRaw(activityRaw(activity));
      showErrors("#activity-errors", built.row ? [] : built.errors.map((issue) => issue.message));
    });
    activity.addEventListener("submit", async (event) => {
      event.preventDefault();
      const raw = activityRaw(activity);
      const built = globalThis.RunningDashboard.validateRaw(raw);
      if (!built.row) {
        showErrors("#activity-errors", built.errors.map((issue) => issue.message));
        return;
      }
      const store = globalThis.HealthStore.load();
      store.running.push(raw);
      globalThis.HealthStore.save(store);
      await refresh();
    });
  }
  const checkin = document.querySelector("#checkin-form");
  if (checkin) {
    checkin.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = globalThis.HealthStore.applyCheckin(globalThis.HealthStore.load(), formRaw(checkin));
      if (result.errors.length) {
        showErrors("#checkin-errors", result.errors);
        return;
      }
      globalThis.HealthStore.save(result.store);
      await refresh();
    });
  }
  const importer = document.querySelector("#import-form");
  if (importer) {
    importer.addEventListener("submit", async (event) => {
      event.preventDefault();
      const file = document.querySelector("#import-file").files[0];
      const status = document.querySelector("#import-status");
      if (!file) {
        status.textContent = "Choose a file on this device.";
        return;
      }
      const text = await file.text();
      const store = globalThis.HealthStore.load();
      let result;
      if (file.name.endsWith(".xml") || text.includes("<HealthData") || text.includes("HKQuantityTypeIdentifier")) {
        result = { store: globalThis.HealthStore.importAppleHealth(store, text), errors: [] };
      } else if (file.name.endsWith(".json") || text.trim().startsWith("{")) {
        result = globalThis.HealthStore.importBackup(store, text);
      } else {
        result = globalThis.HealthStore.importCsv(store, text);
      }
      if (result.errors && result.errors.length && !globalThis.HealthStore.hasRealData(result.store)) {
        status.textContent = result.errors.join(" ");
        return;
      }
      globalThis.HealthStore.save(result.store);
      status.textContent = "Saved in this browser." + (result.errors && result.errors.length ? " " + result.errors.join(" ") : "");
      await refresh();
    });
  }
  const json = document.querySelector("#export-json");
  if (json) {
    json.addEventListener("click", () => {
      const store = globalThis.HealthStore.load();
      globalThis.HealthStore.download("health-os-backup.local.json", JSON.stringify(store, null, 2), "application/json");
    });
  }
  const csv = document.querySelector("#export-csv");
  if (csv) {
    csv.addEventListener("click", () => {
      const store = globalThis.HealthStore.load();
      globalThis.HealthStore.download("running.local.csv", globalThis.HealthStore.toCsv(globalThis.RunningDashboard.COLUMNS, store.running), "text/csv");
    });
  }
  document.querySelectorAll(".copy-summary").forEach((copy) => {
    copy.addEventListener("click", async () => {
      const text = globalThis.HealthStore.compactSummary(model);
      const status = copy.parentElement.nextElementSibling;
      try {
        await navigator.clipboard.writeText(text);
        if (status) status.textContent = "Copied. Paste it into your assistant. This page did not send it.";
      } catch (error) {
        const box = document.createElement("textarea");
        box.value = text;
        copy.parentElement.after(box);
        box.focus();
        box.select();
        if (status) status.textContent = "Select the summary and copy it. This page did not send it.";
      }
    });
  });
  const coachForm = document.querySelector("#coach-form");
  if (coachForm) {
    coachForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const parsed = globalThis.HealthStore.parseCoachUpdate(document.querySelector("#coach-paste").value);
      if (parsed.error) {
        showErrors("#coach-errors", [parsed.error]);
        return;
      }
      const store = globalThis.HealthStore.load();
      store.coach = parsed.coach;
      globalThis.HealthStore.save(store);
      await refresh();
    });
  }
}

async function boot() {
  const app = document.querySelector("#app");
  try {
    const store = globalThis.HealthStore.load();
    demo = globalThis.HealthStore.demoActive(store);
    const projects = JSON.parse(await loadText("data/projects.json"));
    let input;
    if (demo) {
      const entries = await Promise.all(Object.entries(DEMO_FILES).map(async ([key, url]) => [key, await loadText(url)]));
      input = Object.fromEntries(entries);
      input.coach = globalThis.HealthStore.DEMO_COACH;
      input.today = sampleToday(Object.values(input).filter((value) => typeof value === "string"));
    } else {
      input = globalThis.HealthStore.storeToTexts(store);
      input.coach = store.coach;
      input.today = localToday();
    }
    input.projects = projects;
    input.now = new Date().toISOString();
    model = globalThis.HealthOS.build(input);
    route = currentRoute();
    render();
    if (!listening) {
      listening = true;
      window.addEventListener("hashchange", () => {
        route = currentRoute();
        render();
      });
    }
  } catch (error) {
    app.innerHTML = '<div class="banner" role="alert"><strong>The page did not load.</strong>' + escapeHtml(error.message) + " Open this page through a local server or GitHub Pages.</div>";
  }
}

document.addEventListener("DOMContentLoaded", boot);
