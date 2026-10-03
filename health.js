/* My Health OS scoring and projects.
   Formulas are documented in the README. Round half up with floor(x + 0.5).
   A coach note is stored on this device. These rules do not read it. */

const HOURS_7_5 = 7.5 * 3600;
const HOURS_9 = 9 * 3600;
const PROTEIN_GOAL_G = 130;
const KCAL_LOW = 2000;
const KCAL_HIGH = 2800;
const STEPS_GOAL = 8000;
const WATER_GOAL_ML = 2500;
const STALE_MS = 2 * 24 * 60 * 60 * 1000;
const SUB_ORDER = ["movement", "training", "nutrition", "hydration", "recovery", "sleep"];
const SUB_LABELS = {
  movement: "Movement",
  training: "Training",
  nutrition: "Nutrition",
  hydration: "Hydration",
  recovery: "Recovery",
  sleep: "Sleep",
};
const SOURCE_RANK = {
  manual: 0,
  apple_watch: 1,
  estimate: 2,
  apple_health_import: 3,
  mock: 4,
};

function roundHalfUp(value) {
  return Math.floor(value + 0.5);
}

function round1(value) {
  return Math.floor(value * 10 + 0.5) / 10;
}

function divRoundHalfUp(numer, denom) {
  return Math.floor((2 * numer + denom) / (2 * denom));
}

function parseDuration(text) {
  if (!text) return null;
  const parts = String(text).split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (parts.some((part) => !/^\d+$/.test(part))) return null;
  const nums = parts.map(Number);
  if (nums.length === 2) {
    const [minutes, seconds] = nums;
    if (seconds > 59) return null;
    return minutes * 60 + seconds;
  }
  const [hours, minutes, seconds] = nums;
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function formatDuration(seconds) {
  const sign = seconds < 0 ? "-" : "";
  let left = Math.abs(Math.round(seconds));
  const hours = Math.floor(left / 3600);
  left -= hours * 3600;
  const minutes = Math.floor(left / 60);
  const secs = left - minutes * 60;
  if (hours) return sign + hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  return sign + minutes + ":" + String(secs).padStart(2, "0");
}

function formatClock(seconds) {
  const left = Math.max(0, Math.round(seconds));
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left - hours * 3600) / 60);
  return hours + ":" + String(minutes).padStart(2, "0");
}

function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayNumber(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
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
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  let header = null;
  const records = [];
  rows.forEach((cells) => {
    if (cells.length === 1 && cells[0].trim() === "") return;
    const first = cells[0].trim();
    if (!header) {
      if (first.startsWith("#")) return;
      header = cells.map((cell) => cell.trim());
      return;
    }
    if (first.startsWith("#")) return;
    const raw = {};
    header.forEach((name, index) => {
      raw[name] = (cells[index] || "").trim();
    });
    records.push(raw);
  });
  return records;
}

function num(text) {
  if (text === undefined || text === null || text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function activeRows(rows) {
  const real = rows.filter((row) => row.dataSource !== "mock");
  if (real.length) return { rows: real, mockOnly: false, hiddenMock: rows.length - real.length };
  return { rows, mockOnly: rows.length > 0, hiddenMock: 0 };
}

function prefer(rows) {
  if (!rows.length) return null;
  return rows.slice().sort((a, b) => (SOURCE_RANK[a.dataSource] ?? 9) - (SOURCE_RANK[b.dataSource] ?? 9))[0];
}

function onDate(rows, date) {
  return rows.filter((row) => row.date === date);
}

function windowRows(rows, start, end) {
  return rows.filter((row) => row.date >= start && row.date <= end);
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseBody(text) {
  return parseTable(text).map((raw) => ({
    date: raw.date,
    dataSource: (raw.data_source || "").toLowerCase(),
    heightCm: num(raw.height_cm),
    weightKg: num(raw.weight_kg),
    bmi: num(raw.bmi),
    bodyFat: num(raw.body_fat_pct),
    waist: num(raw.waist_cm),
    chest: num(raw.chest_cm),
    hips: num(raw.hips_cm),
    notes: raw.notes || "",
  }));
}

function parseNutrition(text) {
  return parseTable(text).map((raw) => ({
    date: raw.date,
    dataSource: (raw.data_source || "").toLowerCase(),
    rowKind: (raw.row_kind || "").toLowerCase(),
    name: raw.name || "",
    kcal: num(raw.kcal),
    protein: num(raw.protein_g),
    carbs: num(raw.carbs_g),
    fat: num(raw.fat_g),
    hydration: num(raw.hydration_ml),
    notes: raw.notes || "",
  }));
}

function parseSleep(text) {
  return parseTable(text).map((raw) => ({
    date: raw.date,
    dataSource: (raw.data_source || "").toLowerCase(),
    durationSec: parseDuration(raw.duration),
    bedtime: raw.bedtime || "",
    wake: raw.wake || "",
    remSec: parseDuration(raw.rem),
    deepSec: parseDuration(raw.deep),
    coreSec: parseDuration(raw.core),
    awakeSec: parseDuration(raw.awake),
    inBedSec: parseDuration(raw.in_bed),
    notes: raw.notes || "",
  }));
}

function parseActivity(text) {
  return parseTable(text).map((raw) => ({
    date: raw.date,
    dataSource: (raw.data_source || "").toLowerCase(),
    steps: num(raw.steps),
    distanceMi: num(raw.distance_mi),
    activeKcal: num(raw.active_kcal),
    basalKcal: num(raw.basal_kcal),
    totalKcal: num(raw.total_kcal),
    notes: raw.notes || "",
  }));
}

function parseRecovery(text) {
  return parseTable(text).map((raw) => ({
    date: raw.date,
    dataSource: (raw.data_source || "").toLowerCase(),
    hrv: num(raw.hrv_ms),
    rhr: num(raw.resting_hr),
    soreness: num(raw.soreness),
    fatigue: num(raw.fatigue),
    readiness: num(raw.readiness),
    notes: raw.notes || "",
  }));
}

function parsePlan(text) {
  return parseTable(text).map((raw) => ({
    date: raw.date,
    dataSource: (raw.data_source || "").toLowerCase(),
    session: raw.session || "",
    goal: raw.goal || "",
    notes: raw.notes || "",
  }));
}

function isExercise(row) {
  return row.activityType === "Exercise at La Pista" || row.activityType === "Running at the Beach" || row.activityType === "Treadmill";
}

function countedExercise(rows, date) {
  return rows.filter((row) => (
    row.date === date
    && isExercise(row)
    && !row.anomalies.length
    && (row.completed === "yes" || row.completed === "partial")
  ));
}

function isRestSession(session) {
  return /rest|recovery|walk/i.test(session || "");
}

function nutritionTotals(rows, date) {
  const day = onDate(rows, date);
  const daily = day.filter((row) => row.rowKind === "daily");
  if (daily.length) return prefer(daily);
  const food = day.filter((row) => row.rowKind === "food");
  if (!food.length) return null;
  const sum = (key) => {
    const values = food.map((row) => row[key]).filter((value) => value !== null);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  return {
    date,
    dataSource: food[0].dataSource,
    rowKind: "food",
    kcal: sum("kcal"),
    protein: sum("protein"),
    carbs: sum("carbs"),
    fat: sum("fat"),
    hydration: sum("hydration"),
  };
}

function movementScore(activityRow) {
  if (!activityRow || activityRow.steps === null) return null;
  return Math.min(100, roundHalfUp(activityRow.steps / STEPS_GOAL * 100));
}

function kcalPoints(kcal) {
  if (kcal >= KCAL_LOW && kcal <= KCAL_HIGH) return 100;
  const past = kcal < KCAL_LOW ? KCAL_LOW - kcal : kcal - KCAL_HIGH;
  return Math.max(0, 100 - 2 * (past / 50));
}

function nutritionScore(totals) {
  if (!totals) return null;
  const parts = [];
  if (totals.protein !== null) parts.push(Math.min(100, totals.protein / PROTEIN_GOAL_G * 100));
  if (totals.kcal !== null) parts.push(kcalPoints(totals.kcal));
  if (!parts.length) return null;
  if (parts.length === 1) return roundHalfUp(parts[0]);
  return roundHalfUp(0.6 * parts[0] + 0.4 * parts[1]);
}

function hydrationScore(totals) {
  if (!totals || totals.hydration === null) return null;
  return Math.min(100, roundHalfUp(totals.hydration / WATER_GOAL_ML * 100));
}

function hrvBaseline(rows, date) {
  const start = addDays(date, -14);
  const end = addDays(date, -1);
  const values = windowRows(rows, start, end).map((row) => row.hrv).filter((value) => value !== null);
  if (values.length < 7) return null;
  return mean(values);
}

function recoveryScore(rows, date) {
  const row = prefer(onDate(rows, date));
  if (!row) return null;
  if (row.readiness !== null) return row.readiness;
  if (row.soreness === null && row.fatigue === null && row.hrv === null) return null;
  let score = 100;
  if (row.soreness !== null) score -= 8 * Math.max(0, row.soreness - 1);
  if (row.fatigue !== null) score -= 8 * Math.max(0, row.fatigue - 1);
  const base = hrvBaseline(rows, date);
  if (row.hrv !== null && base !== null && row.hrv < 0.9 * base) score -= 15;
  return Math.max(0, Math.min(100, roundHalfUp(score)));
}

function sleepScore(row) {
  if (!row || row.durationSec === null) return null;
  const hours = row.durationSec / 3600;
  if (hours >= 7.5 && hours <= 9) return 100;
  if (hours < 7.5) return roundHalfUp(hours / 7.5 * 100);
  return Math.max(70, roundHalfUp(100 - (hours - 9) * 15));
}

function trainingScore(date, planRows, runRows) {
  const plan = prefer(onDate(planRows, date));
  const exercise = countedExercise(runRows, date);
  const miles = exercise.reduce((sum, row) => sum + row.distanceTh, 0);
  const completedYes = exercise.some((row) => row.completed === "yes");
  const partial = exercise.some((row) => row.completed === "partial");
  if (!plan) return miles >= 1000 ? 80 : null;
  if (isRestSession(plan.session)) return 100;
  if (completedYes) return 100;
  if (partial) return 70;
  return 30;
}

function scoreDay(date, streams) {
  const activity = prefer(onDate(streams.activity, date));
  const totals = nutritionTotals(streams.nutrition, date);
  const sleep = prefer(onDate(streams.sleep, date));
  const subs = {
    movement: movementScore(activity),
    training: trainingScore(date, streams.plan, streams.running),
    nutrition: nutritionScore(totals),
    hydration: hydrationScore(totals),
    recovery: recoveryScore(streams.recovery, date),
    sleep: sleepScore(sleep),
  };
  const present = SUB_ORDER.filter((id) => subs[id] !== null);
  const dayScore = present.length
    ? roundHalfUp(present.reduce((sum, id) => sum + subs[id], 0) / present.length)
    : null;
  const pick = (mode) => {
    let chosen = null;
    SUB_ORDER.forEach((id) => {
      if (subs[id] === null) return;
      if (chosen === null) {
        chosen = id;
        return;
      }
      if (mode === "max" && subs[id] > subs[chosen]) chosen = id;
      if (mode === "min" && subs[id] < subs[chosen]) chosen = id;
    });
    return chosen;
  };
  const recoveryRow = prefer(onDate(streams.recovery, date));
  const readiness = recoveryRow && recoveryRow.readiness !== null ? recoveryRow.readiness : subs.recovery;
  const readinessMethod = recoveryRow && recoveryRow.readiness !== null
    ? "Logged readiness from the recovery row."
    : (subs.recovery !== null ? "Estimated from soreness, fatigue, and HRV versus the prior 14 days." : "No recovery row for this date.");
  return {
    date,
    subs,
    labels: SUB_LABELS,
    dayScore,
    partial: present.length < 4,
    present: present.length,
    win: pick("max"),
    watch: pick("min"),
    readiness,
    readinessMethod,
    totals,
    activity,
    sleep,
    recovery: recoveryRow,
  };
}

function comparableRuns(rows) {
  return rows.filter((row) => (
    isExercise(row)
    && row.completed === "yes"
    && row.distanceTh >= 1000
    && row.distanceTh <= 4000
    && !row.anomalies.length
    && row.paceSec !== null
  ));
}

function weightedPace(rows) {
  const distance = rows.reduce((sum, row) => sum + row.distanceTh, 0);
  if (!distance) return null;
  const acc = rows.reduce((sum, row) => sum + row.paceSec * row.distanceTh, 0);
  return divRoundHalfUp(acc, distance);
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function validBenchmarks(rows) {
  return rows.filter((row) => {
    if (row.activityType === "Treadmill") return false;
    if (row.isBenchmark !== "yes" || row.anomalies.length) return false;
    if (!isExercise(row) || row.completed !== "yes" || row.walkBreaks !== 0) return false;
    if (row.distanceTh < 1950 || row.distanceTh > 2050) return false;
    if (Math.abs(row.continuousSec - row.durationSec) > 2) return false;
    return true;
  }).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
}

function predictTwoMile(rows, today) {
  const points = validBenchmarks(rows);
  if (points.length < 2) {
    return {
      status: "insufficient",
      display: null,
      seconds: null,
      method: "Need at least two valid 2-mile benchmarks. Insufficient data for an estimate.",
    };
  }
  const xs = points.map((row) => dayNumber(row.date));
  const ys = points.map((row) => row.durationSec);
  const n = xs.length;
  const meanX = mean(xs);
  const meanY = mean(ys);
  const variance = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  const slope = xs.reduce((sum, x, index) => sum + (x - meanX) * (ys[index] - meanY), 0) / variance;
  const seconds = roundHalfUp(meanY + slope * (dayNumber(today) - meanX));
  const described = points.map((row) => formatDuration(row.durationSec) + " on " + row.date).join(" and ");
  return {
    status: "estimate",
    display: formatDuration(seconds),
    seconds,
    method: "Straight line through the valid 2-mile benchmarks (" + described + "). This is an estimate, not a race prediction.",
  };
}

function exerciseMiles(rows, start, end) {
  return windowRows(rows, start, end)
    .filter((row) => isExercise(row) && !row.anomalies.length && (row.completed === "yes" || row.completed === "partial"))
    .reduce((sum, row) => sum + row.distanceTh, 0);
}

function planHitRate(planRows, runRows, start, end) {
  let hits = 0;
  let planned = 0;
  windowRows(planRows, start, end).forEach((plan) => {
    planned += 1;
    if (isRestSession(plan.session)) {
      hits += 1;
      return;
    }
    if (countedExercise(runRows, plan.date).length) hits += 1;
  });
  return { hits, planned, rate: planned ? hits / planned * 100 : null };
}

function targetStatus(target, streams, today) {
  const end = target.metric === "plan_hit_rate" ? addDays(today, -1) : today;
  const start = addDays(end, -(target.window_days - 1));
  if (target.metric === "sleep_avg") {
    const values = windowRows(streams.sleep, start, end).map((row) => row.durationSec).filter((value) => value !== null);
    const avg = mean(values);
    const goal = parseDuration(String(target.value).length <= 5 && !String(target.value).includes(":") ? target.value : (String(target.value).split(":").length === 2 ? target.value + ":00" : target.value));
    const goalSec = String(target.value) === "7:30" ? HOURS_7_5 : goal;
    const met = avg !== null && avg >= goalSec;
    return { met, n: values.length, display: avg === null ? "—" : formatClock(avg), start, end };
  }
  if (target.metric === "protein_avg") {
    const values = [];
    windowRows(streams.nutrition, start, end).forEach((row) => {
      if (values.some((item) => item.date === row.date)) return;
    });
    const dates = Array.from(new Set(windowRows(streams.nutrition, start, end).map((row) => row.date)));
    dates.forEach((date) => {
      const totals = nutritionTotals(streams.nutrition, date);
      if (totals && totals.protein !== null) values.push(totals.protein);
    });
    const avg = mean(values);
    return { met: avg !== null && avg >= Number(target.value), n: values.length, display: avg === null ? "—" : round1(avg).toFixed(1) + " g", start, end };
  }
  if (target.metric === "exercise_miles") {
    const thousandths = exerciseMiles(streams.running, start, end);
    const miles = thousandths / 1000;
    const met = miles >= target.min && miles <= target.max;
    return { met, n: thousandths > 0 ? 1 : 0, display: miles.toFixed(2) + " mi", start, end };
  }
  if (target.metric === "readiness_avg") {
    const values = windowRows(streams.recovery, start, end).map((row) => row.readiness).filter((value) => value !== null);
    const avg = mean(values);
    return { met: avg !== null && avg >= Number(target.value), n: values.length, display: avg === null ? "—" : round1(avg).toFixed(1), start, end };
  }
  if (target.metric === "plan_hit_rate") {
    const result = planHitRate(streams.plan, streams.running, start, end);
    return {
      met: result.rate !== null && result.rate >= Number(target.value),
      n: result.planned,
      display: result.rate === null ? "—" : roundHalfUp(result.rate) + "% (" + result.hits + "/" + result.planned + ")",
      start,
      end,
    };
  }
  return { met: false, n: 0, display: "—", start, end };
}

function projectProgress(project, benchmarks) {
  const start = parseDuration(project.start);
  const goal = parseDuration(project.goal_time);
  if (!benchmarks.length || start === null || goal === null || start === goal) {
    return { percent: null, current: null, currentDate: null };
  }
  const best = benchmarks.slice().sort((a, b) => a.durationSec - b.durationSec || (a.date < b.date ? -1 : 1))[0];
  const raw = (start - best.durationSec) / (start - goal);
  const percent = Math.max(0, Math.min(100, roundHalfUp(raw * 100)));
  return { percent, current: formatDuration(best.durationSec), currentDate: best.date };
}

function buildProjects(projects, streams, today) {
  const list = (projects && projects.projects) || [];
  const benchmarks = validBenchmarks(streams.running);
  return list.map((project) => {
    if (project.placeholder) {
      return { ...project, progress: null, current: null, targets: [], status: "placeholder" };
    }
    const progress = projectProgress(project, benchmarks);
    const targets = (project.targets || []).map((target) => ({ ...target, ...targetStatus(target, streams, today) }));
    return { ...project, ...progress, targets, status: "active" };
  });
}

function trendBlock(streams, today) {
  const lastStart = addDays(today, -6);
  const priorEnd = addDays(today, -7);
  const priorStart = addDays(today, -13);
  const items = [
    {
      id: "weight",
      label: "Weight",
      unit: "kg",
      values(start, end) {
        return windowRows(streams.body, start, end).map((row) => row.weightKg).filter((value) => value !== null);
      },
      format: (value) => round1(value).toFixed(1),
    },
    {
      id: "sleep",
      label: "Sleep",
      unit: "h",
      values(start, end) {
        return windowRows(streams.sleep, start, end).map((row) => row.durationSec).filter((value) => value !== null);
      },
      format: (value) => formatClock(value),
    },
    {
      id: "miles",
      label: "Exercise miles",
      unit: "mi",
      sum: true,
      values(start, end) {
        const thousandths = exerciseMiles(streams.running, start, end);
        const days = new Set(windowRows(streams.running, start, end).filter((row) => isExercise(row)).map((row) => row.date));
        return { n: days.size, total: thousandths / 1000 };
      },
      format: (value) => value.toFixed(2),
    },
    {
      id: "readiness",
      label: "Readiness",
      unit: "",
      values(start, end) {
        return windowRows(streams.recovery, start, end).map((row) => row.readiness).filter((value) => value !== null);
      },
      format: (value) => round1(value).toFixed(1),
    },
    {
      id: "protein",
      label: "Protein",
      unit: "g",
      values(start, end) {
        const dates = Array.from(new Set(windowRows(streams.nutrition, start, end).map((row) => row.date)));
        return dates.map((date) => nutritionTotals(streams.nutrition, date)).filter((row) => row && row.protein !== null).map((row) => row.protein);
      },
      format: (value) => round1(value).toFixed(1),
    },
    {
      id: "steps",
      label: "Steps",
      unit: "",
      values(start, end) {
        return windowRows(streams.activity, start, end).map((row) => row.steps).filter((value) => value !== null);
      },
      format: (value) => String(roundHalfUp(value)),
    },
  ];
  return items.map((item) => {
    if (item.sum) {
      const last = item.values(lastStart, today);
      const prior = item.values(priorStart, priorEnd);
      if (last.n < 3 || prior.n < 3) {
        return { id: item.id, label: item.label, status: "insufficient", text: item.label + ": insufficient data (last n=" + last.n + ", prior n=" + prior.n + ", need 3)." };
      }
      const delta = last.total - prior.total;
      return {
        id: item.id,
        label: item.label,
        status: "ok",
        last: item.format(last.total),
        prior: item.format(prior.total),
        text: item.label + " " + item.format(last.total) + " mi over the last 7 days versus " + item.format(prior.total) + " mi the 7 days before (" + (delta >= 0 ? "+" : "") + delta.toFixed(2) + " mi).",
      };
    }
    const lastValues = item.values(lastStart, today);
    const priorValues = item.values(priorStart, priorEnd);
    if (lastValues.length < 3 || priorValues.length < 3) {
      return { id: item.id, label: item.label, status: "insufficient", text: item.label + ": insufficient data (last n=" + lastValues.length + ", prior n=" + priorValues.length + ", need 3)." };
    }
    const lastMean = mean(lastValues);
    const priorMean = mean(priorValues);
    return {
      id: item.id,
      label: item.label,
      status: "ok",
      last: item.format(lastMean),
      prior: item.format(priorMean),
      text: item.label + " averaged " + item.format(lastMean) + (item.unit ? " " + item.unit : "") + " over the last 7 days, versus " + item.format(priorMean) + " the 7 days before.",
    };
  });
}

function coachState(coach, nowIso) {
  if (!coach || !coach.generated_at) {
    return { missing: true, stale: false, mock: false, generatedAt: null, ageMs: null };
  }
  const generated = new Date(coach.generated_at);
  const now = nowIso ? new Date(nowIso) : new Date();
  const ageMs = now.getTime() - generated.getTime();
  const unreadable = Number.isNaN(generated.getTime()) || Number.isNaN(now.getTime());
  return {
    missing: false,
    stale: unreadable || ageMs > STALE_MS,
    mock: coach.data_source === "mock",
    generatedAt: coach.generated_at,
    ageMs: unreadable ? null : ageMs,
    coach,
  };
}

function formatTimestamp(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || "");
  if (!match) return iso || "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hour = Number(match[4]);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return months[Number(match[2]) - 1] + " " + Number(match[3]) + ", " + match[1] + ", " + h12 + ":" + match[5] + " " + ampm;
}

function weightTrend(rows, today) {
  const current = prefer(onDate(rows, today));
  const priorDate = addDays(today, -30);
  const prior = prefer(onDate(rows, priorDate)) || rows.filter((row) => row.date <= priorDate && row.weightKg !== null).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!current || current.weightKg === null) return { weight: null, delta: null, text: "No weight logged." };
  if (!prior || prior.weightKg === null) return { weight: current.weightKg, delta: null, text: current.weightKg.toFixed(1) + " kg" };
  const delta = round1(current.weightKg - prior.weightKg);
  const sign = delta > 0 ? "+" : "";
  return {
    weight: current.weightKg,
    delta,
    text: sign + delta.toFixed(1) + " kg over 30 days",
  };
}

function sleepDebt(rows, today) {
  const values = windowRows(rows, addDays(today, -6), today).map((row) => row.durationSec).filter((value) => value !== null);
  const debt = values.reduce((sum, value) => sum + Math.max(0, HOURS_7_5 - value), 0);
  return { seconds: debt, display: formatDuration(debt), n: values.length };
}

function build(input) {
  const today = input.today;
  const runningParsed = globalThis.RunningDashboard.parseCsv(input.runningText || "");
  const runningView = globalThis.RunningDashboard.buildView(runningParsed);
  const runningAll = runningParsed.rows || [];
  const runningActive = activeRows(runningAll);
  const body = activeRows(parseBody(input.bodyText));
  const nutrition = activeRows(parseNutrition(input.nutritionText));
  const sleep = activeRows(parseSleep(input.sleepText));
  const activity = activeRows(parseActivity(input.activityText));
  const recovery = activeRows(parseRecovery(input.recoveryText));
  const plan = activeRows(parsePlan(input.planText));
  const streams = {
    running: runningActive.rows,
    body: body.rows,
    nutrition: nutrition.rows,
    sleep: sleep.rows,
    activity: activity.rows,
    recovery: recovery.rows,
    plan: plan.rows,
  };
  const scorecard = scoreDay(today, streams);
  const projects = buildProjects(input.projects, streams, today);
  const prediction = predictTwoMile(streams.running, today);
  const planToday = prefer(onDate(streams.plan, today));
  const benchmarks = validBenchmarks(streams.running);
  const best = benchmarks.slice().sort((a, b) => a.durationSec - b.durationSec)[0] || null;
  const trend = weightTrend(streams.body, today);
  const burned = scorecard.activity && scorecard.activity.totalKcal !== null ? scorecard.activity.totalKcal : null;
  const intake = scorecard.totals && scorecard.totals.kcal !== null ? scorecard.totals.kcal : null;
  const coach = coachState(input.coach, input.now);
  const mockStreams = [];
  if (runningActive.mockOnly) mockStreams.push("training");
  if (body.mockOnly) mockStreams.push("body");
  if (nutrition.mockOnly) mockStreams.push("nutrition");
  if (sleep.mockOnly) mockStreams.push("sleep");
  if (activity.mockOnly) mockStreams.push("activity");
  if (recovery.mockOnly) mockStreams.push("recovery");
  return {
    today,
    mockStreams,
    runningView,
    streams,
    streamMeta: { running: runningActive, body, nutrition, sleep, activity, recovery, plan },
    scorecard,
    projects,
    prediction,
    planToday,
    bestBenchmark: best ? { display: formatDuration(best.durationSec), date: best.date, seconds: best.durationSec } : null,
    cards: {
      body: { weight: trend.weight, trend: trend.text },
      sleep: {
        duration: scorecard.sleep && scorecard.sleep.durationSec !== null ? formatDuration(scorecard.sleep.durationSec) : "—",
        score: scorecard.subs.sleep,
      },
      nutrition: {
        kcal: intake,
        protein: scorecard.totals ? scorecard.totals.protein : null,
      },
      activity: {
        steps: scorecard.activity ? scorecard.activity.steps : null,
        miles: scorecard.activity && scorecard.activity.distanceMi !== null ? scorecard.activity.distanceMi : null,
      },
      energy: {
        burned,
        balance: intake !== null && burned !== null ? intake - burned : null,
      },
      heart: {
        rhr: scorecard.recovery ? scorecard.recovery.rhr : null,
        hrv: scorecard.recovery ? scorecard.recovery.hrv : null,
      },
    },
    trends: trendBlock(streams, today),
    sleepDebt: sleepDebt(streams.sleep, today),
    coach: {
      ...coach,
      label: formatTimestamp(coach.generatedAt),
    },
    subLabels: SUB_LABELS,
  };
}

globalThis.HealthOS = {
  build,
  coachState,
  formatTimestamp,
  scoreDay,
  nutritionTotals,
  STALE_MS,
};
