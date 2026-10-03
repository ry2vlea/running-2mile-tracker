/* On-device log for My Health OS.
   Real rows stay in localStorage. This file does not call fetch, send a
   request, or read a network API. */

const HealthStore = (() => {
  const STORAGE_KEY = "healthos.v1";
  const DEMO_KEY = "healthos.demo";
  const PROTECTED = ["manual", "estimate", "apple_watch"];

  const BODY_COLUMNS = ["date", "height_cm", "weight_kg", "bmi", "body_fat_pct", "waist_cm", "chest_cm", "hips_cm", "data_source", "notes"];
  const NUTRITION_COLUMNS = ["date", "row_kind", "name", "kcal", "protein_g", "carbs_g", "fat_g", "hydration_ml", "data_source", "notes"];
  const SLEEP_COLUMNS = ["date", "duration", "bedtime", "wake", "rem", "deep", "core", "awake", "in_bed", "data_source", "notes"];
  const ACTIVITY_COLUMNS = ["date", "steps", "distance_mi", "active_kcal", "basal_kcal", "total_kcal", "data_source", "notes"];
  const RECOVERY_COLUMNS = ["date", "hrv_ms", "resting_hr", "soreness", "fatigue", "readiness", "data_source", "notes"];
  const PLAN_COLUMNS = ["date", "session", "goal", "notes", "data_source"];

  const STREAMS = {
    running: null,
    body: BODY_COLUMNS,
    nutrition: NUTRITION_COLUMNS,
    sleep: SLEEP_COLUMNS,
    activity: ACTIVITY_COLUMNS,
    recovery: RECOVERY_COLUMNS,
    plan: PLAN_COLUMNS,
  };

  const DEMO_COACH = {
    generated_at: "2026-10-03T18:00:00-04:00",
    data_source: "mock",
    key_numbers: [
      "Day score 72",
      "Best 2-mile 16:52",
      "Predicted 16:28",
      "Sleep 6:05",
      "Readiness 58",
    ],
    today_action: "Easy control at La Pista. Not a 2-mile test. Keep it easy in the heat.",
    note: "MOCK briefing for the sample. Not a personal plan.",
  };

  let backend = null;

  function db() {
    if (backend) return backend;
    if (typeof localStorage !== "undefined") return localStorage;
    throw new Error("This browser has no local storage.");
  }

  function useStorage(next) {
    backend = next;
  }

  function emptyStore() {
    return {
      version: 1,
      running: [],
      body: [],
      nutrition: [],
      sleep: [],
      activity: [],
      recovery: [],
      plan: [],
      coach: null,
    };
  }

  function load() {
    try {
      const raw = db().getItem(STORAGE_KEY);
      if (!raw) return emptyStore();
      const parsed = JSON.parse(raw);
      const store = emptyStore();
      Object.keys(store).forEach((key) => {
        if (parsed[key] !== undefined) store[key] = parsed[key];
      });
      store.version = 1;
      return store;
    } catch (error) {
      return emptyStore();
    }
  }

  function save(store) {
    db().setItem(STORAGE_KEY, JSON.stringify(store));
    if (hasRealData(store)) db().setItem(DEMO_KEY, "off");
  }

  function sourceOf(row) {
    return String(row.data_source || row.dataSource || "").toLowerCase();
  }

  function hasRealData(store) {
    const names = ["running", "body", "nutrition", "sleep", "activity", "recovery", "plan"];
    if (names.some((name) => (store[name] || []).some((row) => sourceOf(row) && sourceOf(row) !== "mock"))) return true;
    const coach = store.coach;
    if (!coach) return false;
    const numbers = Array.isArray(coach.key_numbers) ? coach.key_numbers.length : String(coach.key_numbers || "").trim().length;
    return Boolean(String(coach.today_action || "").trim() || numbers || String(coach.note || "").trim());
  }

  function setDemo(on) {
    db().setItem(DEMO_KEY, on ? "on" : "off");
  }

  function demoActive(store) {
    const current = store || load();
    if (hasRealData(current)) return false;
    return db().getItem(DEMO_KEY) !== "off";
  }

  function csvCell(value) {
    const text = value === undefined || value === null ? "" : String(value);
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function runningColumns() {
    return globalThis.RunningDashboard.COLUMNS;
  }

  function toCsv(columns, rows) {
    const lines = (rows || []).map((row) => columns.map((column) => csvCell(row[column])).join(","));
    return columns.join(",") + "\n" + lines.join("\n") + (lines.length ? "\n" : "");
  }

  function storeToTexts(store) {
    return {
      runningText: toCsv(runningColumns(), store.running),
      bodyText: toCsv(BODY_COLUMNS, store.body),
      nutritionText: toCsv(NUTRITION_COLUMNS, store.nutrition),
      sleepText: toCsv(SLEEP_COLUMNS, store.sleep),
      activityText: toCsv(ACTIVITY_COLUMNS, store.activity),
      recoveryText: toCsv(RECOVERY_COLUMNS, store.recovery),
      planText: toCsv(PLAN_COLUMNS, store.plan),
    };
  }

  function parseTable(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const source = String(text || "").replace(/^\uFEFF/, "");
    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (quoted) {
        if (char === '"') {
          if (source[i + 1] === '"') {
            field += '"';
            i += 1;
          } else quoted = false;
        } else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (char !== "\r") field += char;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    let header = null;
    const records = [];
    rows.forEach((cells) => {
      if (!cells.length || (cells.length === 1 && cells[0].trim() === "")) return;
      const first = cells[0].trim();
      if (!header) {
        if (first.startsWith("#")) return;
        header = cells.map((cell) => cell.trim());
        return;
      }
      if (first.startsWith("#")) return;
      const raw = {};
      header.forEach((name, index) => { raw[name] = (cells[index] || "").trim(); });
      records.push(raw);
    });
    return { header: header || [], records };
  }

  function streamForHeader(header) {
    if (header.includes("activity_type")) return "running";
    if (header.includes("row_kind")) return "nutrition";
    if (header.includes("hrv_ms") || header.includes("readiness")) return "recovery";
    if (header.includes("bedtime") || header.includes("duration") && header.includes("rem")) return "sleep";
    if (header.includes("steps")) return "activity";
    if (header.includes("weight_kg")) return "body";
    if (header.includes("session")) return "plan";
    return null;
  }

  function sameRunning(a, b) {
    return a.date === b.date && a.activity_type === b.activity_type && a.workout === b.workout && a.distance_mi === b.distance_mi && a.duration === b.duration;
  }

  function importCsv(store, text) {
    const parsed = parseTable(text);
    const stream = streamForHeader(parsed.header);
    if (!stream) return { store, added: 0, errors: ["The CSV header does not match a known log."] };
    const next = JSON.parse(JSON.stringify(store));
    const errors = [];
    let added = 0;
    parsed.records.forEach((raw) => {
      if (sourceOf(raw) === "mock") {
        errors.push(raw.date + " is mock data and was skipped.");
        return;
      }
      if (stream === "running") {
        const built = globalThis.RunningDashboard.validateRaw(raw);
        if (!built.row) {
          errors.push((raw.date || "row") + ": " + built.errors.map((issue) => issue.message).join("; "));
          return;
        }
        if (!next.running.some((row) => sameRunning(row, raw))) {
          next.running.push(raw);
          added += 1;
        }
        return;
      }
      const columns = STREAMS[stream];
      const row = {};
      columns.forEach((column) => { row[column] = raw[column] || ""; });
      const index = next[stream].findIndex((item) => item.date === row.date && sourceOf(item) === sourceOf(row) && (stream !== "nutrition" || item.row_kind !== "food" || (item.name === row.name && item.kcal === row.kcal)));
      if (index >= 0) next[stream][index] = row;
      else next[stream].push(row);
      added += 1;
    });
    return { store: next, added, errors };
  }

  function importBackup(store, text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { store, errors: ["That file is not JSON."] };
    }
    if (parsed.today_action || parsed.key_numbers) {
      const coach = parseCoachUpdate(text);
      if (coach.error) return { store, errors: [coach.error] };
      const next = JSON.parse(JSON.stringify(store));
      next.coach = coach.coach;
      return { store: next, errors: [] };
    }
    const next = emptyStore();
    ["running", "body", "nutrition", "sleep", "activity", "recovery", "plan"].forEach((name) => {
      if (Array.isArray(parsed[name])) next[name] = parsed[name].filter((row) => sourceOf(row) !== "mock");
    });
    if (parsed.coach && typeof parsed.coach === "object") next.coach = parsed.coach;
    return { store: next, errors: [] };
  }

  function divRoundHalfUp(numer, denom) {
    return Math.floor((2 * numer + denom) / (2 * denom));
  }

  function formatClock(seconds) {
    const left = Math.max(0, Math.round(seconds));
    const hours = Math.floor(left / 3600);
    const rem = left - hours * 3600;
    const minutes = Math.floor(rem / 60);
    const secs = rem - minutes * 60;
    if (hours) return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
    return minutes + ":" + String(secs).padStart(2, "0");
  }

  function roundInt(value) {
    return String(divRoundHalfUp(Math.round(value * 1000), 1000));
  }

  function roundMiles(miles) {
    const cents = divRoundHalfUp(Math.round(miles * 1000), 10);
    return (cents / 100).toFixed(2);
  }

  function roundWeight(kg) {
    const cents = divRoundHalfUp(Math.round(kg * 1000), 10);
    return (cents / 100).toFixed(2);
  }

  function isoWeek(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - weekday);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return String(Math.ceil(((date - yearStart) / 86400000 + 1) / 7));
  }

  function attrs(tag) {
    const out = {};
    const re = /([A-Za-z0-9_]+)="([^"]*)"/g;
    let match = re.exec(tag);
    while (match) {
      out[match[1]] = match[2];
      match = re.exec(tag);
    }
    return out;
  }

  function tags(xml, name) {
    const re = new RegExp("<" + name + "\\b[^>]*/?>", "g");
    return xml.match(re) || [];
  }

  function calendarDay(stamp) {
    return String(stamp || "").trim().slice(0, 10);
  }

  function secondsBetween(start, end) {
    const a = Date.parse(start.replace(" ", "T").replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2"));
    const b = Date.parse(end.replace(" ", "T").replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2"));
    return Math.max(0, Math.round((b - a) / 1000));
  }

  function toMiles(value, unit) {
    const name = String(unit || "mi").toLowerCase();
    if (name === "mi" || name === "mile" || name === "miles") return value;
    if (name === "km" || name === "kilometer" || name === "kilometers") return value / 1.609344;
    return null;
  }

  function toKcal(value, unit) {
    const name = String(unit || "kcal").toLowerCase();
    if (name === "kcal" || name === "cal") return value;
    if (name === "kj") return value / 4.184;
    return null;
  }

  function toKg(value, unit) {
    const name = String(unit || "kg").toLowerCase();
    if (name === "kg") return value;
    if (name === "lb" || name === "lbs") return value * 0.45359237;
    return null;
  }

  function emptyBucket() {
    return { steps: 0, miles: 0, active: 0, basal: 0, rhr: [], hrv: [], mass: [], sleep: {}, inBed: 0 };
  }

  function parseAppleHealth(xml) {
    const days = {};
    function bucket(day) {
      if (!days[day]) days[day] = emptyBucket();
      return days[day];
    }
    const sleepKeys = {
      HKCategoryValueSleepAnalysisAsleep: "asleep",
      HKCategoryValueSleepAnalysisAsleepUnspecified: "asleep",
      HKCategoryValueSleepAnalysisAsleepCore: "core",
      HKCategoryValueSleepAnalysisAsleepDeep: "deep",
      HKCategoryValueSleepAnalysisAsleepREM: "rem",
      HKCategoryValueSleepAnalysisAwake: "awake",
      HKCategoryValueSleepAnalysisInBed: "in_bed",
    };
    tags(xml, "Record").forEach((tag) => {
      const row = attrs(tag);
      const start = row.startDate || "";
      if (!start) return;
      const day = calendarDay(start);
      const kind = row.type || "";
      const value = Number(row.value || "0");
      if (kind === "HKQuantityTypeIdentifierStepCount") bucket(day).steps += value;
      else if (kind === "HKQuantityTypeIdentifierDistanceWalkingRunning") {
        const miles = toMiles(value, row.unit || "mi");
        if (miles !== null) bucket(day).miles += miles;
      } else if (kind === "HKQuantityTypeIdentifierActiveEnergyBurned") {
        const kcal = toKcal(value, row.unit || "kcal");
        if (kcal !== null) bucket(day).active += kcal;
      } else if (kind === "HKQuantityTypeIdentifierBasalEnergyBurned") {
        const kcal = toKcal(value, row.unit || "kcal");
        if (kcal !== null) bucket(day).basal += kcal;
      } else if (kind === "HKQuantityTypeIdentifierRestingHeartRate") bucket(day).rhr.push(value);
      else if (kind === "HKQuantityTypeIdentifierHeartRateVariabilitySDNN") bucket(day).hrv.push(value);
      else if (kind === "HKQuantityTypeIdentifierBodyMass") {
        const kg = toKg(value, row.unit || "kg");
        if (kg !== null) bucket(day).mass.push([start, kg]);
      } else if (kind === "HKCategoryTypeIdentifierSleepAnalysis") {
        const key = sleepKeys[row.value];
        if (!key) return;
        const wake = calendarDay(row.endDate || start);
        const span = secondsBetween(start, row.endDate || start);
        if (key === "in_bed") bucket(wake).inBed += span;
        else bucket(wake).sleep[key] = (bucket(wake).sleep[key] || 0) + span;
      }
    });
    const workouts = [];
    tags(xml, "Workout").forEach((tag) => {
      const row = attrs(tag);
      const activity = row.workoutActivityType || "";
      const start = row.startDate || "";
      if (!start || (activity !== "HKWorkoutActivityTypeRunning" && activity !== "HKWorkoutActivityTypeWalking")) return;
      let duration = 0;
      if (row.duration) {
        const raw = Number(row.duration);
        duration = String(row.durationUnit || "min").startsWith("min") ? Math.round(raw * 60) : Math.round(raw);
      } else duration = secondsBetween(start, row.endDate || start);
      const miles = row.totalDistance ? toMiles(Number(row.totalDistance), row.totalDistanceUnit || "mi") : 0;
      workouts.push({ date: calendarDay(start), kind: activity, miles: miles || 0, duration });
    });
    return { days, workouts };
  }

  function upsertDaily(rows, iso, row) {
    const kept = [];
    let replaced = false;
    rows.forEach((item) => {
      if (item.date === iso && sourceOf(item) === "apple_health_import") {
        if (!replaced) {
          kept.push(row);
          replaced = true;
        }
        return;
      }
      kept.push(item);
    });
    if (!replaced) kept.push(row);
    return kept;
  }

  function importAppleHealth(store, xml) {
    const next = JSON.parse(JSON.stringify(store));
    const parsed = parseAppleHealth(xml);
    Object.keys(parsed.days).sort().forEach((iso) => {
      const bucket = parsed.days[iso];
      if (bucket.steps || bucket.miles || bucket.active || bucket.basal) {
        const active = bucket.active ? divRoundHalfUp(Math.round(bucket.active * 1000), 1000) : 0;
        const basal = bucket.basal ? divRoundHalfUp(Math.round(bucket.basal * 1000), 1000) : 0;
        next.activity = upsertDaily(next.activity, iso, {
          date: iso,
          steps: bucket.steps ? roundInt(bucket.steps) : "",
          distance_mi: bucket.miles ? roundMiles(bucket.miles) : "",
          active_kcal: bucket.active ? String(active) : "",
          basal_kcal: bucket.basal ? String(basal) : "",
          total_kcal: bucket.active || bucket.basal ? String(active + basal) : "",
          data_source: "apple_health_import",
          notes: "Imported from Apple Health.",
        });
      }
      if (bucket.rhr.length || bucket.hrv.length) {
        next.recovery = upsertDaily(next.recovery, iso, {
          date: iso,
          hrv_ms: bucket.hrv.length ? roundInt(bucket.hrv.reduce((sum, value) => sum + value, 0) / bucket.hrv.length) : "",
          resting_hr: bucket.rhr.length ? roundInt(bucket.rhr.reduce((sum, value) => sum + value, 0) / bucket.rhr.length) : "",
          soreness: "",
          fatigue: "",
          readiness: "",
          data_source: "apple_health_import",
          notes: "Imported from Apple Health. Daily mean.",
        });
      }
      if (bucket.mass.length) {
        const kg = bucket.mass.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1)).at(-1)[1];
        next.body = upsertDaily(next.body, iso, {
          date: iso,
          height_cm: "",
          weight_kg: roundWeight(kg),
          bmi: "",
          body_fat_pct: "",
          waist_cm: "",
          chest_cm: "",
          hips_cm: "",
          data_source: "apple_health_import",
          notes: "Imported from Apple Health. Last weight of the day.",
        });
      }
      const stages = bucket.sleep;
      const asleep = (stages.core || 0) + (stages.deep || 0) + (stages.rem || 0) + (stages.asleep || 0);
      if (asleep || stages.awake || bucket.inBed) {
        next.sleep = upsertDaily(next.sleep, iso, {
          date: iso,
          duration: formatClock(Math.round(asleep)),
          bedtime: "",
          wake: "",
          rem: formatClock(Math.round(stages.rem || 0)),
          deep: formatClock(Math.round(stages.deep || 0)),
          core: formatClock(Math.round((stages.core || 0) + (stages.asleep || 0))),
          awake: formatClock(Math.round(stages.awake || 0)),
          in_bed: bucket.inBed ? formatClock(Math.round(bucket.inBed)) : "",
          data_source: "apple_health_import",
          notes: "Imported from Apple Health. Aggregated by wake date.",
        });
      }
    });
    parsed.workouts.forEach((workout) => {
      const running = workout.kind === "HKWorkoutActivityTypeRunning";
      const activityType = running ? "Running at the Beach" : "Walking to a Place";
      const blocked = next.running.some((row) => row.date === workout.date && row.activity_type === activityType && PROTECTED.includes(sourceOf(row)));
      if (blocked) return;
      const distance = workout.miles ? roundMiles(workout.miles) : "0";
      const thousandths = Math.round(Number(distance) * 1000);
      const pace = thousandths > 0 && workout.duration > 0 ? formatClock(divRoundHalfUp(workout.duration * 1000, thousandths)) : "";
      const duration = formatClock(workout.duration);
      const row = {
        date: workout.date,
        week: isoWeek(workout.date),
        activity_type: activityType,
        workout: "Apple Health import",
        distance_mi: distance,
        duration,
        pace_per_mi: pace,
        continuous_running_time: running ? duration : "0:00",
        walk_breaks: "0",
        rpe: "",
        energy: "",
        completed: "yes",
        notes: running
          ? "Imported from Apple Health. Recategorize to Exercise at La Pista if this was the track."
          : "Imported from Apple Health. Transport walk, not exercise mileage.",
        is_benchmark: "no",
        data_source: "apple_health_import",
        avg_hr: "",
        max_hr: "",
        avg_cadence: "",
        active_calories: "",
        stride_length_m: "",
        ground_contact_time_ms: "",
        temp_f: "",
        humidity_pct: "",
        dew_point_f: "",
        incline_pct: "",
      };
      const index = next.running.findIndex((item) => sourceOf(item) === "apple_health_import" && item.date === row.date && item.activity_type === row.activity_type && item.distance_mi === row.distance_mi && item.duration === row.duration);
      if (index >= 0) next.running[index] = row;
      else next.running.push(row);
    });
    return next;
  }

  function parseCoachUpdate(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return { error: "Paste a coach update first." };
    if (trimmed.startsWith("{")) {
      let doc;
      try {
        doc = JSON.parse(trimmed);
      } catch (error) {
        return { error: "That JSON could not be read." };
      }
      let numbers = doc.key_numbers || [];
      if (typeof numbers === "string") numbers = numbers.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!Array.isArray(numbers)) numbers = [String(numbers)];
      const action = String(doc.today_action || doc.do_today || "").trim();
      const note = String(doc.note || "").trim();
      if (!action && !numbers.length && !note) return { error: "JSON needs today_action or key_numbers." };
      return {
        coach: {
          generated_at: doc.generated_at || new Date().toISOString(),
          key_numbers: numbers.map(String),
          today_action: action,
          note,
          data_source: "manual",
        },
      };
    }
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      coach: {
        generated_at: new Date().toISOString(),
        today_action: lines[0] || "",
        key_numbers: lines.slice(1),
        note: "",
        data_source: "manual",
      },
    };
  }

  function inRange(text, low, high, label, errors) {
    const raw = String(text ?? "").trim();
    if (!raw) return "";
    if (!/^-?\d+(?:\.\d+)?$/.test(raw)) {
      errors.push(label + " must be a number");
      return "";
    }
    const value = Number(raw);
    if (value < low || value > high) errors.push(label + " is outside " + low + "–" + high);
    return raw;
  }

  function sleepText(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    if (/^\d{1,2}:\d{2}$/.test(raw)) return raw + ":00";
    return raw;
  }

  function applyCheckin(store, fields) {
    const errors = [];
    const date = String(fields.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("date must be YYYY-MM-DD");
    const weight = inRange(fields.weight, 30, 300, "weight_kg", errors);
    const height = inRange(fields.height, 120, 230, "height_cm", errors);
    const kcal = inRange(fields.kcal, 0, 10000, "kcal", errors);
    const protein = inRange(fields.protein, 0, 500, "protein_g", errors);
    const hydration = inRange(fields.hydration, 0, 10000, "hydration_ml", errors);
    const steps = inRange(fields.steps, 0, 150000, "steps", errors);
    const hrv = inRange(fields.hrv, 5, 200, "hrv_ms", errors);
    const rhr = inRange(fields.rhr, 30, 120, "resting_hr", errors);
    const soreness = inRange(fields.soreness, 1, 10, "soreness", errors);
    const fatigue = inRange(fields.fatigue, 1, 10, "fatigue", errors);
    const readiness = inRange(fields.readiness, 0, 100, "readiness", errors);
    const asleep = sleepText(fields.sleep);
    if (asleep && !/^\d+:\d{2}:\d{2}$/.test(asleep)) errors.push("sleep must be H:MM or H:MM:SS");
    const session = String(fields.session || "").trim();
    const goal = String(fields.goal || "").trim();
    if (goal && !session) errors.push("session is required");
    const any = [weight, height, kcal, protein, hydration, steps, hrv, rhr, soreness, fatigue, readiness, asleep, session].some(Boolean);
    if (!any) errors.push("Enter at least one value.");
    if (errors.length) return { store, errors };
    const next = JSON.parse(JSON.stringify(store));
    function put(name, row, extra) {
      const index = next[name].findIndex((item) => item.date === date && sourceOf(item) === "manual" && extra(item));
      if (index >= 0) next[name][index] = row;
      else next[name].push(row);
    }
    if (weight || height) {
      let bmi = "";
      if (weight && height) bmi = (Math.round((Number(weight) / ((Number(height) / 100) ** 2)) * 10) / 10).toFixed(1);
      put("body", {
        date, height_cm: height, weight_kg: weight, bmi, body_fat_pct: "", waist_cm: "", chest_cm: "", hips_cm: "",
        data_source: "manual", notes: "Logged on this device.",
      }, () => true);
    }
    if (kcal || protein || hydration) {
      put("nutrition", {
        date, row_kind: "daily", name: "Daily total", kcal, protein_g: protein, carbs_g: "", fat_g: "", hydration_ml: hydration,
        data_source: "manual", notes: "Logged on this device.",
      }, (item) => item.row_kind !== "food");
    }
    if (asleep) {
      put("sleep", {
        date, duration: asleep, bedtime: "", wake: "", rem: "", deep: "", core: "", awake: "", in_bed: "",
        data_source: "manual", notes: "Logged on this device.",
      }, () => true);
    }
    if (steps) {
      put("activity", {
        date, steps: String(Math.round(Number(steps))), distance_mi: "", active_kcal: "", basal_kcal: "", total_kcal: "",
        data_source: "manual", notes: "Logged on this device.",
      }, () => true);
    }
    if (hrv || rhr || soreness || fatigue || readiness) {
      put("recovery", {
        date, hrv_ms: hrv, resting_hr: rhr, soreness, fatigue, readiness,
        data_source: "manual", notes: "Logged on this device.",
      }, () => true);
    }
    if (session) {
      put("plan", { date, session, goal, notes: "Logged on this device.", data_source: "manual" }, () => true);
    }
    return { store: next, errors: [] };
  }

  function compactSummary(model) {
    const score = model.scorecard || {};
    const subs = score.subs || {};
    const lines = [
      "My Health OS summary " + (model.today || ""),
      "Day score " + (score.dayScore ?? "—") + (score.partial ? " (partial)" : ""),
      "Movement " + (subs.movement ?? "—") + ", Training " + (subs.training ?? "—") + ", Nutrition " + (subs.nutrition ?? "—"),
      "Hydration " + (subs.hydration ?? "—") + ", Recovery " + (subs.recovery ?? "—") + ", Sleep " + (subs.sleep ?? "—"),
      "Readiness " + (score.readiness ?? "—"),
      "Best 2-mile " + (model.bestBenchmark ? model.bestBenchmark.display + " on " + model.bestBenchmark.date : "—"),
      "Predicted 2-mile " + (model.prediction ? model.prediction.display || "—" : "—") + " (estimate)",
    ];
    const runs = ((model.streams || {}).running || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
    runs.forEach((row) => {
      const miles = (row.distanceTh / 1000).toFixed(2);
      lines.push(row.date + " " + row.activityType + " " + miles + " mi");
    });
    lines.push("Pasted by me from my own device. Nothing in this note was uploaded by the page.");
    return lines.join("\n");
  }

  function download(filename, text, type) {
    if (typeof document === "undefined") return;
    const blob = new Blob([text], { type: type || "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return {
    DEMO_COACH,
    BODY_COLUMNS,
    NUTRITION_COLUMNS,
    SLEEP_COLUMNS,
    ACTIVITY_COLUMNS,
    RECOVERY_COLUMNS,
    PLAN_COLUMNS,
    useStorage,
    emptyStore,
    load,
    save,
    hasRealData,
    setDemo,
    demoActive,
    toCsv,
    storeToTexts,
    importCsv,
    importBackup,
    importAppleHealth,
    parseCoachUpdate,
    applyCheckin,
    compactSummary,
    download,
  };
})();

globalThis.HealthStore = HealthStore;
