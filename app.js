/* Static dashboard for data/running_data.csv.
   Thresholds stay in lockstep with scripts/validate_running_data.py. */

const GOAL_SEC = 900;
const IMPOSSIBLE_PACE_SEC = 150;
const MILE_WR_PACE_SEC = 223;
const MIN_COMPARABLE_MI_TH = 1000;
const MAX_COMPARABLE_MI_TH = 4000;
const BENCH_MIN_TH = 1950;
const BENCH_MAX_TH = 2050;
const MAX_DISTANCE_TH = 50000;
const MAX_DURATION_SEC = 28800;
const HR_MIN = 30;
const HR_MAX = 230;
const CADENCE_MIN = 50;
const CADENCE_MAX = 250;
const STRIDE_MIN_MM = 300;
const STRIDE_MAX_MM = 3000;
const GCT_MIN = 50;
const GCT_MAX = 500;
const CALORIES_MAX = 5000;

const EXERCISE_TYPES = ["Exercise at La Pista", "Running at the Beach"];
const WALKING_TYPES = ["Walking to a Place", "Recovery Walk"];
const ACTIVITY_TYPES = EXERCISE_TYPES.concat(WALKING_TYPES);
const DATA_SOURCES = ["apple_watch", "manual", "estimate", "mock"];
const COMPLETED_VALUES = ["yes", "partial", "no"];
const ENERGY_VALUES = ["low", "moderate", "high"];
const COLUMNS = [
  "date", "week", "activity_type", "workout", "distance_mi", "duration",
  "pace_per_mi", "continuous_running_time", "walk_breaks", "rpe", "energy",
  "completed", "notes", "is_benchmark", "data_source", "avg_hr", "max_hr",
  "avg_cadence", "active_calories", "stride_length_m", "ground_contact_time_ms",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function divRoundHalfUp(numer, denom) {
  return Math.floor((2 * numer + denom) / (2 * denom));
}

function parseMilesThousandths(text) {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (!match) return null;
  const whole = Number(match[1]);
  const frac = Number((match[2] || "").padEnd(3, "0"));
  return whole * 1000 + frac;
}

function formatMiles(thousandths) {
  if (thousandths % 10 === 0) return (thousandths / 1000).toFixed(2);
  return (thousandths / 1000).toFixed(3);
}

function parseDuration(text) {
  if (!text) return null;
  const parts = text.split(":");
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
  let left = Math.abs(seconds);
  const hours = Math.floor(left / 3600);
  left -= hours * 3600;
  const minutes = Math.floor(left / 60);
  const secs = left - minutes * 60;
  if (hours) return sign + hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  return sign + minutes + ":" + String(secs).padStart(2, "0");
}

function expectedPace(durationSec, distanceTh) {
  return divRoundHalfUp(durationSec * 1000, distanceTh);
}

function validCalendarDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= lengths[month - 1];
}

function parseDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!validCalendarDate(year, month, day)) return null;
  return new Date(year, month - 1, day);
}

function formatDate(iso) {
  const date = parseDate(iso);
  if (!date) return iso;
  return DAYS[date.getDay()] + ", " + MONTHS[date.getMonth()] + " " + date.getDate();
}

function parseCsvTable(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
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
  return rows;
}

function parseOptionalInt(text) {
  if (text === "") return { value: null, error: null };
  if (!/^\d+$/.test(text)) return { value: null, error: "must be a whole number" };
  return { value: Number(text), error: null };
}

function parseCsv(text) {
  const table = parseCsvTable(text);
  const errors = [];
  const kept = [];
  let header = null;
  let seenHeader = false;
  table.forEach((cells, index) => {
    const line = index + 1;
    if (cells.length === 1 && cells[0].trim() === "") return;
    if (!seenHeader && cells[0].trim().startsWith("#")) return;
    if (cells.every((cell) => cell.trim() === "")) return;
    if (!seenHeader && cells[0].trim().startsWith("#")) return;
    if (!seenHeader) {
      header = cells.map((cell) => cell.trim());
      seenHeader = true;
      const missing = COLUMNS.filter((name) => !header.includes(name));
      if (missing.length) errors.push({ line, message: "missing columns: " + missing.join(", ") });
      return;
    }
    if (cells[0].trim().startsWith("#")) return;
    if (!header || errors.some((issue) => issue.message.startsWith("missing columns"))) return;
    if (cells[0].trim().startsWith("#")) return;
    if (cells.length !== header.length) {
      errors.push({ line, message: "expected " + header.length + " columns, found " + cells.length });
      return;
    }
    const raw = {};
    header.forEach((name, i) => { raw[name] = cells[i].trim(); });
    const built = buildRow(line, raw);
    errors.push(...built.errors);
    if (built.row) kept.push(built.row);
  });
  if (!seenHeader) errors.push({ line: 0, message: "the CSV has no header row" });

  const rows = [];
  const seen = new Map();
  const weeksByDate = new Map();
  kept.forEach((row) => {
    const key = [row.date, row.activityType, row.workout, row.distanceTh, row.durationSec].join("|");
    if (seen.has(key)) {
      errors.push({ line: row.line, message: "duplicate of line " + seen.get(key) });
      return;
    }
    seen.set(key, row.line);
    if (weeksByDate.has(row.date) && weeksByDate.get(row.date) !== row.week) {
      errors.push({ line: row.line, message: row.date + " is already recorded as week " + weeksByDate.get(row.date) });
      return;
    }
    weeksByDate.set(row.date, row.week);
    rows.push(row);
  });
  return { rows, errors };
}

function buildRow(line, raw) {
  const errors = [];
  const date = raw.date || "";
  if (!parseDate(date)) errors.push({ line, message: "date must be a real YYYY-MM-DD day" });
  let week = 0;
  if (!/^[1-9]\d*$/.test(raw.week || "")) errors.push({ line, message: "week must be a positive whole number" });
  else week = Number(raw.week);
  const activityType = raw.activity_type || "";
  if (!ACTIVITY_TYPES.includes(activityType)) errors.push({ line, message: "activity_type is not an allowed value" });
  const workout = raw.workout || "";
  if (!workout) errors.push({ line, message: "workout is required" });
  const distanceTh = parseMilesThousandths(raw.distance_mi || "");
  if (distanceTh === null) errors.push({ line, message: "distance_mi must be a number" });
  const durationSec = parseDuration(raw.duration || "");
  if (durationSec === null) errors.push({ line, message: "duration must be M:SS or H:MM:SS" });
  const paceText = raw.pace_per_mi || "";
  const paceSec = paceText ? parseDuration(paceText) : null;
  if (paceText && paceSec === null) errors.push({ line, message: "pace_per_mi must be M:SS or H:MM:SS" });
  const continuousSec = parseDuration(raw.continuous_running_time || "");
  if (continuousSec === null) errors.push({ line, message: "continuous_running_time must be M:SS or H:MM:SS" });
  let walkBreaks = 0;
  if (!/^\d+$/.test(raw.walk_breaks || "")) errors.push({ line, message: "walk_breaks must be a whole number" });
  else walkBreaks = Number(raw.walk_breaks);
  const completed = (raw.completed || "").toLowerCase();
  if (!COMPLETED_VALUES.includes(completed)) errors.push({ line, message: "completed must be yes, partial, or no" });
  let rpe = null;
  if ((raw.rpe || "") === "") {
    if (completed === "yes" || completed === "partial") errors.push({ line, message: "rpe is required" });
  } else if (!/^(?:[1-9]|10)$/.test(raw.rpe)) errors.push({ line, message: "rpe must be 1 to 10" });
  else rpe = Number(raw.rpe);
  const energy = (raw.energy || "").toLowerCase();
  if (energy === "") {
    if (completed === "yes" || completed === "partial") errors.push({ line, message: "energy is required" });
  } else if (!ENERGY_VALUES.includes(energy)) errors.push({ line, message: "energy must be low, moderate, or high" });
  const isBenchmark = (raw.is_benchmark || "").toLowerCase();
  if (isBenchmark !== "yes" && isBenchmark !== "no") errors.push({ line, message: "is_benchmark must be yes or no" });
  const dataSource = (raw.data_source || "").toLowerCase();
  if (!DATA_SOURCES.includes(dataSource)) errors.push({ line, message: "data_source is not an allowed value" });

  const avg = parseOptionalInt(raw.avg_hr || "");
  const max = parseOptionalInt(raw.max_hr || "");
  const cadence = parseOptionalInt(raw.avg_cadence || "");
  const calories = parseOptionalInt(raw.active_calories || "");
  const gct = parseOptionalInt(raw.ground_contact_time_ms || "");
  if (avg.error) errors.push({ line, message: "avg_hr " + avg.error });
  if (max.error) errors.push({ line, message: "max_hr " + max.error });
  if (cadence.error) errors.push({ line, message: "avg_cadence " + cadence.error });
  if (calories.error) errors.push({ line, message: "active_calories " + calories.error });
  const strideText = raw.stride_length_m || "";
  const strideMm = strideText === "" ? null : parseMilesThousandths(strideText);
  if (strideText && strideMm === null) errors.push({ line, message: "stride_length_m must be a number" });

  if (errors.length || distanceTh === null || durationSec === null || continuousSec === null) {
    return { row: null, errors };
  }
  if (distanceTh === 0 && paceSec !== null) errors.push({ line, message: "pace must be blank when distance is 0" });
  if (distanceTh > 0 && paceSec === null) errors.push({ line, message: "pace is required when distance is greater than 0" });
  if (distanceTh > 0 && durationSec === 0) errors.push({ line, message: "duration cannot be 0 when distance is greater than 0" });
  if (distanceTh > 0 && durationSec > 0 && paceSec !== null && paceSec !== expectedPace(durationSec, distanceTh)) {
    errors.push({ line, message: "pace does not match duration ÷ distance" });
  }
  if (continuousSec > durationSec) errors.push({ line, message: "continuous time is longer than duration" });
  if (WALKING_TYPES.includes(activityType) && continuousSec !== 0) errors.push({ line, message: "walking continuous time must be 0:00" });
  if (WALKING_TYPES.includes(activityType) && isBenchmark === "yes") errors.push({ line, message: "a walk cannot be a benchmark" });
  if (errors.length) return { row: null, errors };

  const anomalies = [];
  if (distanceTh > MAX_DISTANCE_TH) anomalies.push("distance is above 50 mi");
  if (durationSec > MAX_DURATION_SEC) anomalies.push("duration is longer than 8 hours");
  if (distanceTh > 0 && paceSec !== null) {
    if (paceSec <= IMPOSSIBLE_PACE_SEC) {
      anomalies.push("impossible pace " + formatDuration(paceSec) + "/mi (" + formatMiles(distanceTh) + " mi in " + formatDuration(durationSec) + ")");
    } else if (distanceTh >= 1000 && paceSec < MILE_WR_PACE_SEC) {
      anomalies.push("impossible pace " + formatDuration(paceSec) + "/mi over " + formatMiles(distanceTh) + " mi");
    }
  }
  if (avg.value !== null && (avg.value < HR_MIN || avg.value > HR_MAX)) anomalies.push("avg_hr is outside " + HR_MIN + "–" + HR_MAX);
  if (max.value !== null && (max.value < HR_MIN || max.value > HR_MAX)) anomalies.push("max_hr is outside " + HR_MIN + "–" + HR_MAX);
  if (avg.value !== null && max.value !== null && max.value < avg.value) anomalies.push("max_hr is lower than avg_hr");
  if (cadence.value !== null && (cadence.value < CADENCE_MIN || cadence.value > CADENCE_MAX)) anomalies.push("avg_cadence is outside the expected range");
  if (strideMm !== null && (strideMm < STRIDE_MIN_MM || strideMm > STRIDE_MAX_MM)) anomalies.push("stride length is outside 0.300–3.000 m");
  if (gct.value !== null && (gct.value < GCT_MIN || gct.value > GCT_MAX)) anomalies.push("ground contact time is outside the expected range");
  if (calories.value !== null && calories.value > CALORIES_MAX) anomalies.push("active calories are above " + CALORIES_MAX);

  return {
    row: {
      line,
      date,
      week,
      activityType,
      workout,
      distanceTh,
      durationSec,
      paceSec,
      continuousSec,
      walkBreaks,
      rpe,
      energy,
      completed,
      notes: raw.notes || "",
      isBenchmark,
      dataSource,
      anomalies,
    },
    errors,
  };
}

function benchmarkProblems(row) {
  if (row.isBenchmark !== "yes") return [];
  const problems = [];
  if (!EXERCISE_TYPES.includes(row.activityType)) problems.push("not an exercise activity");
  if (row.completed !== "yes") problems.push("completed is " + row.completed);
  if (row.walkBreaks !== 0) problems.push("walk breaks");
  if (row.distanceTh < BENCH_MIN_TH || row.distanceTh > BENCH_MAX_TH) problems.push("distance is not about 2.00 mi");
  if (Math.abs(row.continuousSec - row.durationSec) > 2) problems.push("not continuous");
  if (row.anomalies.length) problems.push("flagged value");
  return problems;
}

function gapPhrase(seconds) {
  const delta = seconds - GOAL_SEC;
  if (delta === 0) return "matches 15:00";
  if (delta > 0) return formatDuration(delta) + " slower than 15:00";
  return formatDuration(-delta) + " faster than 15:00";
}

function classifyTrend(rows) {
  const weeks = new Set(rows.map((row) => row.week));
  if (weeks.size < 2 || rows.length < 4) {
    return { trend: "insufficient data", detail: "Need at least four exercise sessions across two weeks." };
  }
  const ordered = rows.slice().sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line);
  const midpoint = ordered[Math.floor(ordered.length / 2)].date;
  const earlier = ordered.filter((row) => row.date < midpoint);
  const recent = ordered.filter((row) => row.date >= midpoint);
  if (earlier.length < 2 || recent.length < 2) {
    return { trend: "insufficient data", detail: "Need at least two exercise sessions on each side of the log." };
  }
  const paceEarlier = weightedPace(earlier);
  const paceRecent = weightedPace(recent);
  const endEarlier = Math.max(...earlier.map((row) => row.continuousSec));
  const endRecent = Math.max(...recent.map((row) => row.continuousSec));
  const rpeEarlier = meanRpe(earlier);
  const rpeRecent = meanRpe(recent);
  const paceImproving = paceEarlier !== null && paceRecent !== null && paceEarlier - paceRecent >= 5;
  const paceWorse = paceEarlier !== null && paceRecent !== null && paceRecent - paceEarlier >= 10;
  const endImproving = endRecent - endEarlier >= 120;
  const endWorse = endEarlier - endRecent >= 120;
  const rpeUp = rpeEarlier !== null && rpeRecent !== null && rpeRecent - rpeEarlier >= 1 && rpeRecent >= 7;
  if (rpeUp && (paceWorse || endWorse || !(paceImproving || endImproving))) {
    return { trend: "high fatigue", detail: "Recent RPE is up and pace or endurance is flat or worse." };
  }
  if (paceImproving && endImproving) {
    return { trend: "normal progression", detail: "Comparable pace is faster and the longest continuous run is longer." };
  }
  if (paceImproving) {
    return { trend: "improving pace", detail: "Comparable pace is faster. Continuous duration has not moved the same way." };
  }
  if (endImproving) {
    return { trend: "improving endurance", detail: "The longest continuous run is longer. Comparable pace has not moved the same way." };
  }
  return { trend: "stalled", detail: "Comparable pace and continuous running are flat or worse." };
}

function weightedPace(rows) {
  const picked = rows.filter((row) => row.completed === "yes" && row.distanceTh >= MIN_COMPARABLE_MI_TH && row.distanceTh <= MAX_COMPARABLE_MI_TH);
  const distance = picked.reduce((sum, row) => sum + row.distanceTh, 0);
  if (distance <= 0) return null;
  const duration = picked.reduce((sum, row) => sum + row.durationSec, 0);
  return divRoundHalfUp(duration * 1000, distance);
}

function meanRpe(rows) {
  const values = rows.map((row) => row.rpe).filter((value) => value !== null);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function exerciseRows(rows) {
  return rows.filter((row) => EXERCISE_TYPES.includes(row.activityType) && (row.completed === "yes" || row.completed === "partial") && row.distanceTh > 0);
}

function computeMetrics(rows) {
  const usable = rows.filter((row) => row.anomalies.length === 0);
  const counted = usable.filter((row) => row.completed === "yes" || row.completed === "partial");
  const exerciseTh = counted.filter((row) => EXERCISE_TYPES.includes(row.activityType)).reduce((sum, row) => sum + row.distanceTh, 0);
  const walkingTh = counted.filter((row) => WALKING_TYPES.includes(row.activityType)).reduce((sum, row) => sum + row.distanceTh, 0);
  const benchmarks = [];
  const excluded = [];
  usable.forEach((row) => {
    if (row.isBenchmark !== "yes") return;
    const problems = benchmarkProblems(row);
    if (problems.length) excluded.push({ row, problems });
    else benchmarks.push(row);
  });
  const bestTwo = benchmarks.slice().sort((a, b) => a.durationSec - b.durationSec || a.date.localeCompare(b.date))[0] || null;
  const comparable = usable.filter((row) => (
    EXERCISE_TYPES.includes(row.activityType)
    && row.completed === "yes"
    && row.distanceTh >= MIN_COMPARABLE_MI_TH
    && row.distanceTh <= MAX_COMPARABLE_MI_TH
    && row.paceSec !== null
  ));
  const bestPace = comparable.slice().sort((a, b) => a.paceSec - b.paceSec || a.date.localeCompare(b.date))[0] || null;
  const continuous = usable.filter((row) => EXERCISE_TYPES.includes(row.activityType) && (row.completed === "yes" || row.completed === "partial") && row.continuousSec > 0);
  const longest = continuous.slice().sort((a, b) => b.continuousSec - a.continuousSec || a.date.localeCompare(b.date))[0] || null;
  const trend = classifyTrend(exerciseRows(usable));
  const weeks = weeklySeries(usable);
  return {
    bestTwoMile: bestTwo ? { display: formatDuration(bestTwo.durationSec), seconds: bestTwo.durationSec, date: bestTwo.date, gap: gapPhrase(bestTwo.durationSec) } : null,
    bestPace: bestPace ? { display: formatDuration(bestPace.paceSec), seconds: bestPace.paceSec, distance: formatMiles(bestPace.distanceTh), date: bestPace.date } : null,
    exerciseMiles: formatMiles(exerciseTh),
    walkingMiles: formatMiles(walkingTh),
    exerciseTh,
    walkingTh,
    longest: longest ? { display: formatDuration(longest.continuousSec), seconds: longest.continuousSec, date: longest.date } : null,
    benchmarks: benchmarks.slice().sort((a, b) => a.date.localeCompare(b.date)),
    excluded,
    trend: trend.trend,
    trendDetail: trend.detail,
    weeks,
  };
}

function weeklySeries(usable) {
  const counted = usable.filter((row) => row.completed === "yes" || row.completed === "partial");
  const weeks = [...new Set(counted.map((row) => row.week))].sort((a, b) => a - b);
  return weeks.map((week) => {
    const inWeek = counted.filter((row) => row.week === week);
    const exercise = inWeek.filter((row) => EXERCISE_TYPES.includes(row.activityType));
    const walking = inWeek.filter((row) => WALKING_TYPES.includes(row.activityType));
    return {
      week,
      exerciseTh: exercise.reduce((sum, row) => sum + row.distanceTh, 0),
      walkingTh: walking.reduce((sum, row) => sum + row.distanceTh, 0),
      continuousSec: exercise.reduce((max, row) => Math.max(max, row.continuousSec), 0),
      walkBreaks: exercise.reduce((sum, row) => sum + row.walkBreaks, 0),
    };
  });
}

function typeRank(row) {
  if (EXERCISE_TYPES.includes(row.activityType)) return 0;
  if (row.activityType === "Recovery Walk") return 1;
  return 2;
}

function recentRows(rows) {
  return rows.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const rank = typeRank(a) - typeRank(b);
    if (rank) return rank;
    return b.distanceTh - a.distanceTh;
  }).slice(0, 15);
}

function buildView(parsed) {
  const rows = parsed.rows || [];
  const real = rows.filter((row) => row.dataSource !== "mock");
  const mock = rows.filter((row) => row.dataSource === "mock");
  const showingMock = real.length === 0 && mock.length > 0;
  const active = showingMock ? mock : real;
  const display = computeMetrics(active);
  const realMetrics = computeMetrics(real);
  const mockMetrics = computeMetrics(mock);
  return {
    showingMock,
    hiddenMockCount: showingMock ? 0 : mock.length,
    parseErrors: parsed.errors || [],
    anomalies: active.filter((row) => row.anomalies.length),
    metrics: display,
    trend: real.length ? realMetrics.trend : "insufficient data",
    trendDetail: real.length
      ? realMetrics.trendDetail
      : (showingMock
        ? "The numbers on this page are a labeled sample. The trend is not estimated from mock rows."
        : "No real activities yet."),
    previewTrend: mock.length ? mockMetrics.trend : null,
    recent: recentRows(active),
    empty: active.length === 0,
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function render(view) {
  const status = document.querySelector("#status");
  const parts = [];
  if (view.showingMock) {
    parts.push(
      '<div class="banner" data-banner="mock" role="status"><strong>Mock data</strong>This sample is not a real training log. Every KPI and chart switches to real rows, and drops these, as soon as one is added.</div>'
    );
  } else if (view.hiddenMockCount) {
    parts.push('<div class="banner quiet" role="status">' + view.hiddenMockCount + ' mock rows are in the file and hidden from this page.</div>');
  }
  if (view.parseErrors.length) {
    parts.push('<div class="banner" role="alert"><strong>Some rows need a fix</strong>They are left out of the numbers until the validator is clean.</div>');
  }
  status.innerHTML = parts.join("");

  renderKpis(view);
  renderTwoMile(view);
  renderEndurance(view);
  renderWeekly(view);
  renderRecent(view);
  renderFlagged(view);
  document.body.dataset.showing = view.showingMock ? "mock" : "real";
}

function renderKpis(view) {
  const metrics = view.metrics;
  const cards = [
    kpi("Best 2-mile", "best-2mile", metrics.bestTwoMile ? metrics.bestTwoMile.display : "—", metrics.bestTwoMile ? metrics.bestTwoMile.gap : "No valid 2-mile benchmark yet.", metrics.bestTwoMile ? formatDate(metrics.bestTwoMile.date) : ""),
    kpi("Goal", "goal", "15:00", "7:30 per mile", "Lower is better", "kpi-goal"),
    kpi("Best pace", "best-pace", metrics.bestPace ? metrics.bestPace.display : "—", metrics.bestPace ? "per mile at " + metrics.bestPace.distance + " mi" : "Runs from 1.00 to 4.00 mi", metrics.bestPace ? formatDate(metrics.bestPace.date) : ""),
    kpi("Exercise miles", "exercise-miles", metrics.exerciseMiles, "Track and beach only", "Transport walks excluded"),
    kpi("Walking miles", "walking-miles", metrics.walkingMiles, "Transport and recovery", "Kept separate from running"),
    kpi("Longest run", "longest-run", metrics.longest ? metrics.longest.display : "—", "Longest continuous segment", metrics.longest ? formatDate(metrics.longest.date) : ""),
  ];
  document.querySelector("#kpis").innerHTML = cards.join("");
  const note = document.querySelector("#trend-note");
  const text = '<p class="trend-note" id="trend-note">Trend: ' + escapeHtml(view.trend) + ". " + escapeHtml(view.trendDetail) + "</p>";
  if (note) note.outerHTML = text;
  else document.querySelector("#kpis").insertAdjacentHTML("afterend", text);
}

function kpi(label, key, value, detail, extra, className) {
  return '<article class="kpi ' + (className || "") + '" data-kpi="' + key + '"><p class="kpi-label">' + label + '</p><p class="kpi-value">' + escapeHtml(value) + '</p><p class="kpi-detail">' + escapeHtml(detail) + '</p>' + (extra ? '<p class="kpi-extra">' + escapeHtml(extra) + "</p>" : "") + "</article>";
}

function renderTwoMile(view) {
  const points = view.metrics.benchmarks;
  const excluded = view.metrics.excluded;
  const host = document.querySelector("#chart-two-mile");
  const note = excluded.length
    ? excluded.length + " marked benchmark" + (excluded.length === 1 ? "" : "s") + " left off the chart (walk breaks, partial work, or not a continuous 2 miles)."
    : "Only a continuous, completed run of about 2.00 miles is plotted.";
  host.innerHTML = '<h2>2-mile time</h2><p class="lede">' + note + " Lower on the chart is faster.</p>"
    + (points.length ? '<div class="chart-scroll"><canvas id="two-mile-canvas" role="img" aria-label="2-mile benchmark times. The dashed line is 15:00. Lower is faster."></canvas></div>' : '<p class="empty">No valid 2-mile benchmark yet.</p>')
    + '<p class="legend"><span><i class="swatch goal"></i>15:00 goal</span><span><i class="swatch line"></i>Benchmark time</span></p>'
    + chartTable(points.map((row) => [row.date, formatDuration(row.durationSec)]), ["Date", "Time"]);
}

function renderEndurance(view) {
  const weeks = view.metrics.weeks;
  const host = document.querySelector("#chart-endurance");
  const items = weeks.map((week) => (
    "<li><strong>W" + week.week + "</strong><span>" + formatDuration(week.continuousSec) + " continuous · " + week.walkBreaks + " walk breaks · " + formatMiles(week.exerciseTh) + " structured mi</span></li>"
  )).join("");
  host.innerHTML = '<h2>Endurance</h2><p class="lede">Longest continuous run each week, with that week’s walk breaks and structured miles. A rising line is a longer continuous run.</p>'
    + (weeks.length ? '<div class="chart-scroll"><canvas id="endurance-canvas" role="img" aria-label="Longest continuous run and structured miles by week."></canvas></div>' : '<p class="empty">No exercise rows yet.</p>')
    + '<p class="legend"><span><i class="swatch line"></i>Longest continuous</span><span><i class="swatch" style="background:#0f6e56"></i>Structured miles</span></p>'
    + '<ul class="week-list">' + items + "</ul>";
}

function renderWeekly(view) {
  const weeks = view.metrics.weeks;
  const host = document.querySelector("#chart-weekly");
  const weekItems = weeks.map((week) => (
    "<li><strong>W" + week.week + "</strong><span>" + formatMiles(week.exerciseTh) + " exercise mi · " + formatMiles(week.walkingTh) + " walking mi</span></li>"
  )).join("");
  host.innerHTML = '<h2>Weekly miles</h2><p class="lede">Exercise miles against walking miles. Walking is transport plus Sunday recovery, and it is not added to the running total.</p>'
    + (weeks.length ? '<div class="chart-scroll"><canvas id="weekly-canvas" role="img" aria-label="Weekly exercise miles compared with walking miles."></canvas></div>' : '<p class="empty">No miles yet.</p>')
    + '<p class="legend"><span><i class="swatch" style="background:#0f6e56"></i>Exercise</span><span><i class="swatch" style="background:#8d7b66"></i>Walking</span></p>'
    + '<ul class="week-list">' + weekItems + "</ul>"
    + chartTable(weeks.map((week) => ["W" + week.week, formatMiles(week.exerciseTh), formatMiles(week.walkingTh)]), ["Week", "Exercise mi", "Walking mi"]);
}

function chartTable(rows, headers) {
  if (!rows.length) return "";
  const head = headers.map((header) => "<th>" + header + "</th>").join("");
  const body = rows.map((row) => "<tr>" + row.map((cell) => "<td>" + escapeHtml(cell) + "</td>").join("") + "</tr>").join("");
  return '<table class="sr-only"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table>";
}

function renderRecent(view) {
  const bestDate = view.metrics.bestTwoMile ? view.metrics.bestTwoMile.date : "";
  const bestSeconds = view.metrics.bestTwoMile ? view.metrics.bestTwoMile.seconds : null;
  const body = view.recent.map((row) => {
    const badges = [];
    if (row.anomalies.length) badges.push('<span class="badge flag">Flagged</span>');
    else if (row.isBenchmark === "yes" && benchmarkProblems(row).length) badges.push('<span class="badge warn">Not on chart</span>');
    else if (row.isBenchmark === "yes" && row.durationSec === bestSeconds && row.date === bestDate) badges.push('<span class="badge">Best 2-mile</span>');
    else if (row.isBenchmark === "yes") badges.push('<span class="badge">Benchmark</span>');
    const source = row.dataSource === "estimate" ? '<span class="type-sub">Estimate</span>' : "";
    return "<tr><td>" + escapeHtml(formatDate(row.date)) + "</td><td>" + row.week + "</td><td>" + formatMiles(row.distanceTh) + "</td><td>" + formatDuration(row.durationSec) + "</td><td>" + (row.paceSec === null ? "—" : formatDuration(row.paceSec)) + "</td><td>" + escapeHtml(row.activityType) + '<span class="type-sub">' + escapeHtml(row.workout) + "</span>" + source + badges.join("") + "</td><td class=\"note\">" + escapeHtml(row.notes) + "</td></tr>";
  }).join("");
  const host = document.querySelector("#recent");
  if (!view.recent.length) {
    host.innerHTML = "<h2>Recent activities</h2><p class=\"empty\">No activities in the file yet. Add a row to data/running_data.csv.</p>";
    return;
  }
  host.innerHTML = '<div class="table-wrap"><table><caption>Recent activities</caption><thead><tr><th scope="col">Date</th><th scope="col">Week</th><th scope="col">Distance</th><th scope="col">Time</th><th scope="col">Pace/mi</th><th scope="col">Type</th><th scope="col">Notes</th></tr></thead><tbody>' + body + "</tbody></table></div><p class=\"lede\">Showing " + view.recent.length + " activities. On the same day, exercise sits above transport walks.</p>";
}

function renderFlagged(view) {
  const host = document.querySelector("#flagged");
  const items = [];
  view.parseErrors.forEach((issue) => items.push("Line " + issue.line + ": " + issue.message));
  view.anomalies.forEach((row) => items.push(formatDate(row.date) + " " + row.workout + ": " + row.anomalies.join("; ") + " — flagged, not counted."));
  if (!items.length) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = '<div class="card flagged"><h2>Flagged for verification</h2><p class="lede">These values are not accepted as records.</p><ul>' + items.map((item) => "<li>" + escapeHtml(item) + "</li>").join("") + "</ul></div>";
}

function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth || 320;
  const height = canvas.clientHeight || 240;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = "12px Avenir Next, Segoe UI, sans-serif";
  return { ctx, width, height };
}

function prepareCanvas(canvas, units) {
  const parent = canvas.parentElement.clientWidth || 320;
  const width = Math.max(parent, units * 84);
  canvas.style.width = width + "px";
  canvas.style.height = window.matchMedia("(min-width: 720px)").matches ? "280px" : "240px";
  return fitCanvas(canvas);
}

function drawTwoMile() {
  const canvas = document.querySelector("#two-mile-canvas");
  if (!canvas || !currentView) return;
  const points = currentView.metrics.benchmarks;
  if (!points.length) return;
  const { ctx, width, height } = prepareCanvas(canvas, Math.max(points.length, 2));
  ctx.clearRect(0, 0, width, height);
  const pad = { l: 52, r: 12, t: 22, b: 36 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const times = points.map((row) => row.durationSec);
  const minY = Math.min(GOAL_SEC, ...times) - 45;
  const maxY = Math.max(GOAL_SEC, ...times) + 45;
  const yAt = (sec) => pad.t + ((maxY - sec) / (maxY - minY)) * plotH;
  const step = maxY - minY > 240 ? 60 : 30;
  const xAt = (index) => points.length === 1 ? pad.l + plotW / 2 : pad.l + (plotW * index) / (points.length - 1);

  ctx.strokeStyle = "#e5dccb";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#5c564c";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let sec = Math.ceil(minY / step) * step; sec <= maxY; sec += step) {
    const y = yAt(sec);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(width - pad.r, y);
    ctx.stroke();
    ctx.fillText(formatDuration(sec), pad.l - 8, y);
  }

  const goalY = yAt(GOAL_SEC);
  ctx.save();
  ctx.strokeStyle = "#b42318";
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.l, goalY);
  ctx.lineTo(width - pad.r, goalY);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#b42318";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("15:00", width - pad.r, Math.max(14, goalY - 4));

  ctx.strokeStyle = "#1c1915";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  points.forEach((row, index) => {
    const x = xAt(index);
    const y = yAt(row.durationSec);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  points.forEach((row, index) => {
    const x = xAt(index);
    const y = yAt(row.durationSec);
    ctx.fillStyle = row.durationSec <= GOAL_SEC ? "#0f6e56" : "#b42318";
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1c1915";
    ctx.fillText(formatDuration(row.durationSec), x, y - 10);
    ctx.fillStyle = "#5c564c";
    ctx.fillText(MONTHS[parseDate(row.date).getMonth()] + " " + parseDate(row.date).getDate(), x, height - 12);
  });
}

function drawEndurance() {
  const canvas = document.querySelector("#endurance-canvas");
  if (!canvas || !currentView) return;
  const weeks = currentView.metrics.weeks;
  if (!weeks.length) return;
  const { ctx, width, height } = prepareCanvas(canvas, weeks.length);
  ctx.clearRect(0, 0, width, height);
  const pad = { l: 40, r: 36, t: 18, b: 48 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const maxMin = Math.max(10, ...weeks.map((week) => week.continuousSec / 60)) * 1.25;
  const maxMi = Math.max(1, ...weeks.map((week) => week.exerciseTh / 1000)) * 1.35;
  const group = plotW / weeks.length;
  const yMin = (minutes) => pad.t + plotH - (minutes / maxMin) * plotH;

  ctx.strokeStyle = "#e5dccb";
  ctx.fillStyle = "#5c564c";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = "11px Avenir Next, Segoe UI, sans-serif";
  for (let minute = 0; minute <= maxMin; minute += 10) {
    const y = yMin(minute);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(width - pad.r, y);
    ctx.stroke();
    ctx.fillText(String(minute), pad.l - 6, y);
  }

  weeks.forEach((week, index) => {
    const cx = pad.l + group * index + group / 2;
    const miles = week.exerciseTh / 1000;
    const barH = (miles / maxMi) * plotH;
    ctx.fillStyle = "#cfe7dc";
    ctx.fillRect(cx - 14, pad.t + plotH - barH, 28, barH);
  });

  ctx.beginPath();
  ctx.strokeStyle = "#1c1915";
  ctx.lineWidth = 2;
  weeks.forEach((week, index) => {
    const cx = pad.l + group * index + group / 2;
    const y = yMin(week.continuousSec / 60);
    if (index === 0) ctx.moveTo(cx, y);
    else ctx.lineTo(cx, y);
  });
  ctx.stroke();
  weeks.forEach((week, index) => {
    const cx = pad.l + group * index + group / 2;
    const y = yMin(week.continuousSec / 60);
    ctx.fillStyle = "#1c1915";
    ctx.beginPath();
    ctx.arc(cx, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5c564c";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("W" + week.week, cx, height - 26);
    ctx.fillText(week.walkBreaks + " brk", cx, height - 12);
  });
}

function drawWeekly() {
  const canvas = document.querySelector("#weekly-canvas");
  if (!canvas || !currentView) return;
  const weeks = currentView.metrics.weeks;
  if (!weeks.length) return;
  const { ctx, width, height } = prepareCanvas(canvas, weeks.length);
  ctx.clearRect(0, 0, width, height);
  const pad = { l: 36, r: 12, t: 16, b: 32 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const maxMi = Math.max(1, ...weeks.map((week) => Math.max(week.exerciseTh, week.walkingTh) / 1000)) * 1.25;
  const group = plotW / weeks.length;
  ctx.strokeStyle = "#e5dccb";
  ctx.fillStyle = "#5c564c";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const step = maxMi > 12 ? 4 : 2;
  for (let mile = 0; mile <= maxMi; mile += step) {
    const y = pad.t + plotH - (mile / maxMi) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(width - pad.r, y);
    ctx.stroke();
    ctx.fillText(String(mile), pad.l - 6, y);
  }
  weeks.forEach((week, index) => {
    const cx = pad.l + group * index + group / 2;
    const barW = Math.min(18, group / 4);
    const exH = (week.exerciseTh / 1000 / maxMi) * plotH;
    const walkH = (week.walkingTh / 1000 / maxMi) * plotH;
    ctx.fillStyle = "#0f6e56";
    ctx.fillRect(cx - barW - 2, pad.t + plotH - exH, barW, exH);
    ctx.fillStyle = "#8d7b66";
    ctx.fillRect(cx + 2, pad.t + plotH - walkH, barW, walkH);
    ctx.fillStyle = "#5c564c";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = "12px Avenir Next, Segoe UI, sans-serif";
    ctx.fillText("W" + week.week, cx, height - 10);
  });
}

function drawCharts() {
  drawTwoMile();
  drawEndurance();
  drawWeekly();
}

let currentView = null;

async function init() {
  const status = document.querySelector("#status");
  try {
    const response = await fetch("data/running_data.csv", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load data/running_data.csv (" + response.status + ")");
    const parsed = parseCsv(await response.text());
    currentView = buildView(parsed);
    render(currentView);
    drawCharts();
  } catch (error) {
    status.innerHTML = '<div class="banner" role="alert"><strong>The log did not load.</strong>' + escapeHtml(error.message) + " Open this page through a local server or GitHub Pages, not as a bare file.</div>";
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    if (currentView) drawCharts();
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

globalThis.RunningDashboard = {
  parseCsv,
  buildView,
  computeMetrics,
  GOAL_SEC,
  EXERCISE_TYPES,
  WALKING_TYPES,
};
