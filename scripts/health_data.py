"""Parse, validate, and score the My Health OS mock files.

Real logs stay in the browser. This module checks the public mock CSVs and
the scoring formulas. It does not call a network and it does not read an API key.

Scoring matches health.js and the formulas in the README. Rounding is half up.
"""

from __future__ import annotations

import csv
import io
import json
import math
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

import validate_running_data as running

DATA_SOURCES = running.DATA_SOURCES
HOURS_7_5 = int(7.5 * 3600)
PROTEIN_GOAL_G = 130
KCAL_LOW = 2000
KCAL_HIGH = 2800
STEPS_GOAL = 8000
WATER_GOAL_ML = 2500
STALE_SECONDS = 2 * 24 * 60 * 60
SUB_ORDER = ("movement", "training", "nutrition", "hydration", "recovery", "sleep")
SOURCE_RANK = {
    "manual": 0,
    "apple_watch": 1,
    "estimate": 2,
    "apple_health_import": 3,
    "mock": 4,
}

BODY_COLUMNS = (
    "date", "height_cm", "weight_kg", "bmi", "body_fat_pct",
    "waist_cm", "chest_cm", "hips_cm", "data_source", "notes",
)
NUTRITION_COLUMNS = (
    "date", "row_kind", "name", "kcal", "protein_g", "carbs_g",
    "fat_g", "hydration_ml", "data_source", "notes",
)
SLEEP_COLUMNS = (
    "date", "duration", "bedtime", "wake", "rem", "deep", "core",
    "awake", "in_bed", "data_source", "notes",
)
ACTIVITY_COLUMNS = (
    "date", "steps", "distance_mi", "active_kcal", "basal_kcal",
    "total_kcal", "data_source", "notes",
)
RECOVERY_COLUMNS = (
    "date", "hrv_ms", "resting_hr", "soreness", "fatigue",
    "readiness", "data_source", "notes",
)
PLAN_COLUMNS = ("date", "session", "goal", "notes", "data_source")

STREAM_FILES = {
    "body": ("body.csv", BODY_COLUMNS),
    "nutrition": ("nutrition.csv", NUTRITION_COLUMNS),
    "sleep": ("sleep.csv", SLEEP_COLUMNS),
    "activity": ("activity.csv", ACTIVITY_COLUMNS),
    "recovery": ("recovery.csv", RECOVERY_COLUMNS),
    "plan": ("training_plan.csv", PLAN_COLUMNS),
}


def round_half_up(value: float) -> int:
    return math.floor(value + 0.5)


def round1(value: float) -> float:
    return math.floor(value * 10 + 0.5) / 10


def parse_duration(text: str) -> int | None:
    return running.parse_duration(text) if text else None


def format_hm(seconds: float) -> str:
    left = max(0, int(round_half_up(seconds)))
    hours, rem = divmod(left, 3600)
    minutes = rem // 60
    return f"{hours}:{minutes:02d}"


def add_days(iso: str, days: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=days)).isoformat()


def day_number(iso: str) -> int:
    return date.fromisoformat(iso).toordinal()


def mean(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def read_table(text: str) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    header: list[str] | None = None
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        cells = next(csv.reader(io.StringIO(line)))
        if header is None:
            header = [cell.strip() for cell in cells]
            continue
        raw = {name: "" for name in header}
        for index, name in enumerate(header):
            if index < len(cells):
                raw[name] = cells[index].strip()
        records.append(raw)
    return records


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    return read_table(path.read_text(encoding="utf-8-sig"))


def write_csv(path: Path, columns: tuple[str, ...], rows: list[dict[str, str]]) -> None:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(columns), lineterminator="\n", extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({name: row.get(name, "") for name in columns})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(buffer.getvalue(), encoding="utf-8")


def num(text: str) -> float | None:
    if text is None or text == "":
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    if math.isnan(value) or math.isinf(value):
        return None
    return value


def active(rows: list[dict]) -> list[dict]:
    real = [row for row in rows if row.get("data_source") != "mock"]
    return real if real else rows


def prefer(rows: list[dict]) -> dict | None:
    if not rows:
        return None
    return sorted(rows, key=lambda row: SOURCE_RANK.get(row.get("data_source", ""), 9))[0]


def on_date(rows: list[dict], iso: str) -> list[dict]:
    return [row for row in rows if row.get("date") == iso]


def in_window(rows: list[dict], start: str, end: str) -> list[dict]:
    return [row for row in rows if start <= row.get("date", "") <= end]


def is_exercise(row: dict) -> bool:
    return row.get("activity_type") in running.EXERCISE_TYPES


def is_rest_session(session: str) -> bool:
    return re.search(r"rest|recovery|walk", session or "", re.I) is not None


def load_running(path: Path) -> tuple[list[dict], list[str]]:
    if not path.is_file():
        return [], ["running file missing"]
    rows, issues = running.validate_text(path.read_text(encoding="utf-8-sig"), path.as_posix())
    adapted = []
    for row in rows:
        adapted.append({
            "date": row.date,
            "activity_type": row.activity_type,
            "completed": row.completed,
            "distance_th": row.distance_th,
            "duration_sec": row.duration_sec,
            "pace_sec": row.pace_sec,
            "continuous_sec": row.continuous_sec,
            "avg_hr": row.avg_hr,
            "anomalies": list(row.anomalies),
            "is_benchmark": row.is_benchmark,
            "data_source": row.data_source,
            "walk_breaks": row.walk_breaks,
            "workout": row.workout,
            "notes": row.notes,
            "week": row.week,
        })
    errors = [issue.message for issue in issues if issue.level == "error"]
    return adapted, errors


def adapt_body(raw: dict) -> dict:
    return {
        "date": raw.get("date", ""),
        "data_source": raw.get("data_source", "").lower(),
        "height_cm": num(raw.get("height_cm", "")),
        "weight_kg": num(raw.get("weight_kg", "")),
        "bmi": num(raw.get("bmi", "")),
        "body_fat": num(raw.get("body_fat_pct", "")),
        "notes": raw.get("notes", ""),
    }


def adapt_nutrition(raw: dict) -> dict:
    return {
        "date": raw.get("date", ""),
        "data_source": raw.get("data_source", "").lower(),
        "row_kind": raw.get("row_kind", "").lower(),
        "name": raw.get("name", ""),
        "kcal": num(raw.get("kcal", "")),
        "protein": num(raw.get("protein_g", "")),
        "carbs": num(raw.get("carbs_g", "")),
        "fat": num(raw.get("fat_g", "")),
        "hydration": num(raw.get("hydration_ml", "")),
    }


def adapt_sleep(raw: dict) -> dict:
    return {
        "date": raw.get("date", ""),
        "data_source": raw.get("data_source", "").lower(),
        "duration_sec": parse_duration(raw.get("duration", "")),
        "bedtime": raw.get("bedtime", ""),
        "wake": raw.get("wake", ""),
    }


def adapt_activity(raw: dict) -> dict:
    return {
        "date": raw.get("date", ""),
        "data_source": raw.get("data_source", "").lower(),
        "steps": num(raw.get("steps", "")),
        "distance_mi": num(raw.get("distance_mi", "")),
        "active_kcal": num(raw.get("active_kcal", "")),
        "basal_kcal": num(raw.get("basal_kcal", "")),
        "total_kcal": num(raw.get("total_kcal", "")),
    }


def adapt_recovery(raw: dict) -> dict:
    return {
        "date": raw.get("date", ""),
        "data_source": raw.get("data_source", "").lower(),
        "hrv": num(raw.get("hrv_ms", "")),
        "rhr": num(raw.get("resting_hr", "")),
        "soreness": num(raw.get("soreness", "")),
        "fatigue": num(raw.get("fatigue", "")),
        "readiness": num(raw.get("readiness", "")),
    }


def adapt_plan(raw: dict) -> dict:
    return {
        "date": raw.get("date", ""),
        "data_source": raw.get("data_source", "").lower(),
        "session": raw.get("session", ""),
        "goal": raw.get("goal", ""),
        "notes": raw.get("notes", ""),
    }


def nutrition_totals(rows: list[dict], iso: str) -> dict | None:
    day = on_date(rows, iso)
    daily = [row for row in day if row.get("row_kind") == "daily"]
    if daily:
        return prefer(daily)
    food = [row for row in day if row.get("row_kind") == "food"]
    if not food:
        return None

    def total(key: str) -> float | None:
        values = [row[key] for row in food if row.get(key) is not None]
        return sum(values) if values else None

    return {
        "date": iso,
        "data_source": food[0]["data_source"],
        "row_kind": "food",
        "kcal": total("kcal"),
        "protein": total("protein"),
        "hydration": total("hydration"),
    }


def counted_exercise(rows: list[dict], iso: str) -> list[dict]:
    return [
        row for row in rows
        if row.get("date") == iso
        and is_exercise(row)
        and not row.get("anomalies")
        and row.get("completed") in ("yes", "partial")
    ]


def movement_score(activity: dict | None) -> int | None:
    if not activity or activity.get("steps") is None:
        return None
    return min(100, round_half_up(activity["steps"] / STEPS_GOAL * 100))


def kcal_points(kcal: float) -> float:
    if KCAL_LOW <= kcal <= KCAL_HIGH:
        return 100
    past = (KCAL_LOW - kcal) if kcal < KCAL_LOW else (kcal - KCAL_HIGH)
    return max(0, 100 - 2 * (past / 50))


def nutrition_score(totals: dict | None) -> int | None:
    if not totals:
        return None
    parts: list[float] = []
    if totals.get("protein") is not None:
        parts.append(min(100, totals["protein"] / PROTEIN_GOAL_G * 100))
    if totals.get("kcal") is not None:
        parts.append(kcal_points(totals["kcal"]))
    if not parts:
        return None
    if len(parts) == 1:
        return round_half_up(parts[0])
    return round_half_up(0.6 * parts[0] + 0.4 * parts[1])


def hydration_score(totals: dict | None) -> int | None:
    if not totals or totals.get("hydration") is None:
        return None
    return min(100, round_half_up(totals["hydration"] / WATER_GOAL_ML * 100))


def recovery_score(rows: list[dict], iso: str) -> int | None:
    row = prefer(on_date(rows, iso))
    if not row:
        return None
    if row.get("readiness") is not None:
        return int(row["readiness"])
    if row.get("soreness") is None and row.get("fatigue") is None and row.get("hrv") is None:
        return None
    score = 100.0
    if row.get("soreness") is not None:
        score -= 8 * max(0, row["soreness"] - 1)
    if row.get("fatigue") is not None:
        score -= 8 * max(0, row["fatigue"] - 1)
    start, end = add_days(iso, -14), add_days(iso, -1)
    base = [item["hrv"] for item in in_window(rows, start, end) if item.get("hrv") is not None]
    if row.get("hrv") is not None and len(base) >= 7 and row["hrv"] < 0.9 * mean(base):
        score -= 15
    return max(0, min(100, round_half_up(score)))


def sleep_score(row: dict | None) -> int | None:
    if not row or row.get("duration_sec") is None:
        return None
    hours = row["duration_sec"] / 3600
    if 7.5 <= hours <= 9:
        return 100
    if hours < 7.5:
        return round_half_up(hours / 7.5 * 100)
    return max(70, round_half_up(100 - (hours - 9) * 15))


def training_score(iso: str, plan_rows: list[dict], run_rows: list[dict]) -> int | None:
    plan = prefer(on_date(plan_rows, iso))
    exercise = counted_exercise(run_rows, iso)
    miles = sum(row["distance_th"] for row in exercise)
    completed_yes = any(row["completed"] == "yes" for row in exercise)
    partial = any(row["completed"] == "partial" for row in exercise)
    if not plan:
        return 80 if miles >= 1000 else None
    if is_rest_session(plan.get("session", "")):
        return 100
    if completed_yes:
        return 100
    if partial:
        return 70
    return 30


def score_day(iso: str, streams: dict) -> dict:
    activity = prefer(on_date(streams["activity"], iso))
    totals = nutrition_totals(streams["nutrition"], iso)
    sleep = prefer(on_date(streams["sleep"], iso))
    subs = {
        "movement": movement_score(activity),
        "training": training_score(iso, streams["plan"], streams["running"]),
        "nutrition": nutrition_score(totals),
        "hydration": hydration_score(totals),
        "recovery": recovery_score(streams["recovery"], iso),
        "sleep": sleep_score(sleep),
    }
    present = [name for name in SUB_ORDER if subs[name] is not None]
    day_score = round_half_up(sum(subs[name] for name in present) / len(present)) if present else None

    def pick(mode: str) -> str | None:
        chosen = None
        for name in SUB_ORDER:
            if subs[name] is None:
                continue
            if chosen is None:
                chosen = name
                continue
            if mode == "max" and subs[name] > subs[chosen]:
                chosen = name
            if mode == "min" and subs[name] < subs[chosen]:
                chosen = name
        return chosen

    return {
        "date": iso,
        "subs": subs,
        "day_score": day_score,
        "partial": len(present) < 4,
        "win": pick("max"),
        "watch": pick("min"),
        "totals": totals,
        "activity": activity,
        "sleep": sleep,
        "readiness": (prefer(on_date(streams["recovery"], iso)) or {}).get("readiness"),
    }


def comparable_runs(rows: list[dict]) -> list[dict]:
    return [
        row for row in rows
        if is_exercise(row)
        and row.get("completed") == "yes"
        and running.MIN_COMPARABLE_MI_TH <= row.get("distance_th", 0) <= running.MAX_COMPARABLE_MI_TH
        and not row.get("anomalies")
        and row.get("pace_sec") is not None
    ]


def weighted_pace(rows: list[dict]) -> int | None:
    distance = sum(row["distance_th"] for row in rows)
    if distance <= 0:
        return None
    acc = sum(row["pace_sec"] * row["distance_th"] for row in rows)
    return running.div_round_half_up(acc, distance)


def median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def valid_benchmarks(rows: list[dict]) -> list[dict]:
    kept = []
    for row in rows:
        if row.get("activity_type") == "Treadmill":
            continue
        if row.get("is_benchmark") != "yes" or row.get("anomalies"):
            continue
        if not is_exercise(row) or row.get("completed") != "yes" or row.get("walk_breaks") != 0:
            continue
        if not running.BENCH_MIN_TH <= row["distance_th"] <= running.BENCH_MAX_TH:
            continue
        if abs(row["continuous_sec"] - row["duration_sec"]) > 2:
            continue
        kept.append(row)
    return sorted(kept, key=lambda row: row["date"])


def predict_two_mile(rows: list[dict], today: str) -> dict:
    points = valid_benchmarks(rows)
    if len(points) < 2:
        return {"status": "insufficient", "display": None, "seconds": None}
    xs = [day_number(row["date"]) for row in points]
    ys = [row["duration_sec"] for row in points]
    mean_x = mean(xs)
    mean_y = mean(ys)
    variance = sum((x - mean_x) ** 2 for x in xs)
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / variance
    seconds = round_half_up(mean_y + slope * (day_number(today) - mean_x))
    return {"status": "estimate", "display": running.format_duration(seconds), "seconds": seconds}


def exercise_miles(rows: list[dict], start: str, end: str) -> int:
    return sum(
        row["distance_th"] for row in in_window(rows, start, end)
        if is_exercise(row) and not row.get("anomalies") and row.get("completed") in ("yes", "partial")
    )


def plan_hit_rate(plan_rows: list[dict], run_rows: list[dict], start: str, end: str) -> dict:
    hits = 0
    planned = 0
    for plan in in_window(plan_rows, start, end):
        planned += 1
        if is_rest_session(plan.get("session", "")) or counted_exercise(run_rows, plan["date"]):
            hits += 1
    return {"hits": hits, "planned": planned, "rate": None if not planned else hits / planned * 100}


def target_status(target: dict, streams: dict, today: str) -> dict:
    end = add_days(today, -1) if target.get("metric") == "plan_hit_rate" else today
    start = add_days(end, -(int(target["window_days"]) - 1))
    metric = target.get("metric")
    if metric == "sleep_avg":
        values = [row["duration_sec"] for row in in_window(streams["sleep"], start, end) if row.get("duration_sec") is not None]
        avg = mean(values)
        return {"met": avg is not None and avg >= HOURS_7_5, "display": "—" if avg is None else format_hm(avg), "n": len(values)}
    if metric == "protein_avg":
        dates = sorted({row["date"] for row in in_window(streams["nutrition"], start, end)})
        values = []
        for iso in dates:
            totals = nutrition_totals(streams["nutrition"], iso)
            if totals and totals.get("protein") is not None:
                values.append(totals["protein"])
        avg = mean(values)
        return {"met": avg is not None and avg >= float(target["value"]), "display": "—" if avg is None else f"{round1(avg):.1f}", "n": len(values)}
    if metric == "exercise_miles":
        miles = exercise_miles(streams["running"], start, end) / 1000
        return {"met": target["min"] <= miles <= target["max"], "display": f"{miles:.2f}", "n": 1 if miles else 0}
    if metric == "readiness_avg":
        values = [row["readiness"] for row in in_window(streams["recovery"], start, end) if row.get("readiness") is not None]
        avg = mean(values)
        return {"met": avg is not None and avg >= float(target["value"]), "display": "—" if avg is None else f"{round1(avg):.1f}", "n": len(values)}
    if metric == "plan_hit_rate":
        result = plan_hit_rate(streams["plan"], streams["running"], start, end)
        rate = result["rate"]
        display = "—" if rate is None else f"{round_half_up(rate)}% ({result['hits']}/{result['planned']})"
        return {"met": rate is not None and rate >= float(target["value"]), "display": display, "n": result["planned"]}
    return {"met": False, "display": "—", "n": 0}


def project_progress(project: dict, benchmarks: list[dict]) -> dict:
    start = parse_duration(project.get("start", ""))
    goal = parse_duration(project.get("goal_time", ""))
    if not benchmarks or start is None or goal is None or start == goal:
        return {"percent": None, "current": None}
    best = min(benchmarks, key=lambda row: (row["duration_sec"], row["date"]))
    raw = (start - best["duration_sec"]) / (start - goal)
    percent = max(0, min(100, round_half_up(raw * 100)))
    return {"percent": percent, "current": running.format_duration(best["duration_sec"])}


def build_projects(document: dict, streams: dict, today: str) -> list[dict]:
    benchmarks = valid_benchmarks(streams["running"])
    built = []
    for project in document.get("projects", []):
        if project.get("placeholder"):
            built.append({**project, "status": "placeholder", "percent": None, "targets": []})
            continue
        progress = project_progress(project, benchmarks)
        targets = []
        for target in project.get("targets", []):
            targets.append({**target, **target_status(target, streams, today)})
        built.append({**project, **progress, "targets": targets, "status": "active"})
    return built


def load_bundle(root: Path, today: str) -> dict:
    running_rows, running_errors = load_running(root / "data" / "running_data.csv")
    body = [adapt_body(row) for row in read_csv(root / "data" / "body.csv")]
    nutrition = [adapt_nutrition(row) for row in read_csv(root / "data" / "nutrition.csv")]
    sleep = [adapt_sleep(row) for row in read_csv(root / "data" / "sleep.csv")]
    activity = [adapt_activity(row) for row in read_csv(root / "data" / "activity.csv")]
    recovery = [adapt_recovery(row) for row in read_csv(root / "data" / "recovery.csv")]
    plan = [adapt_plan(row) for row in read_csv(root / "data" / "training_plan.csv")]
    projects_path = root / "data" / "projects.json"
    projects = json.loads(projects_path.read_text(encoding="utf-8")) if projects_path.is_file() else {"projects": []}
    streams = {
        "running": active(running_rows),
        "body": active(body),
        "nutrition": active(nutrition),
        "sleep": active(sleep),
        "activity": active(activity),
        "recovery": active(recovery),
        "plan": active(plan),
    }
    return {
        "today": today,
        "streams": streams,
        "projects": build_projects(projects, streams, today),
        "scorecard": score_day(today, streams),
        "prediction": predict_two_mile(streams["running"], today),
        "running_errors": running_errors,
        "projects_doc": projects,
    }


def coach_is_stale(generated_at: str, now: datetime) -> bool:
    stamp = datetime.fromisoformat(generated_at)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return (now - stamp).total_seconds() > STALE_SECONDS


def _number_errors(raw: dict, fields: dict[str, tuple[float, float]], label: str) -> list[str]:
    errors = []
    for name, (low, high) in fields.items():
        text = raw.get(name, "")
        if text == "":
            continue
        value = num(text)
        if value is None or not low <= value <= high:
            errors.append(f"{label} {name} is outside {low}–{high}")
    return errors


def validate_stream_rows(name: str, rows: list[dict[str, str]]) -> list[str]:
    errors: list[str] = []
    seen: set[tuple] = set()
    for index, raw in enumerate(rows, start=2):
        label = f"{name} line {index}"
        iso = raw.get("date", "")
        try:
            date.fromisoformat(iso)
        except ValueError:
            errors.append(f"{label} date must be YYYY-MM-DD")
            continue
        source = raw.get("data_source", "").lower()
        if source not in DATA_SOURCES:
            errors.append(f"{label} data_source is not an allowed value")
        if name == "body":
            errors.extend(_number_errors(raw, {
                "height_cm": (120, 230),
                "weight_kg": (30, 300),
                "bmi": (12, 60),
                "body_fat_pct": (3, 60),
                "waist_cm": (40, 200),
                "chest_cm": (40, 200),
                "hips_cm": (40, 200),
            }, label))
            height, weight, bmi = num(raw.get("height_cm", "")), num(raw.get("weight_kg", "")), num(raw.get("bmi", ""))
            if height and weight and bmi is not None:
                expected = weight / ((height / 100) ** 2)
                if abs(bmi - expected) > 0.2:
                    errors.append(f"{label} bmi does not match height and weight")
            if not any(raw.get(field) for field in ("weight_kg", "body_fat_pct", "waist_cm")):
                errors.append(f"{label} needs a measurement")
            key = (iso, source)
        elif name == "nutrition":
            kind = raw.get("row_kind", "").lower()
            if kind not in ("daily", "food"):
                errors.append(f"{label} row_kind must be daily or food")
            errors.extend(_number_errors(raw, {
                "kcal": (0, 10000),
                "protein_g": (0, 500),
                "carbs_g": (0, 1500),
                "fat_g": (0, 500),
                "hydration_ml": (0, 10000),
            }, label))
            if kind == "food":
                key = (iso, raw.get("name", ""), raw.get("kcal", ""), source)
            else:
                key = (kind, iso, source)
        elif name == "sleep":
            duration = parse_duration(raw.get("duration", ""))
            if duration is None or not 0 <= duration <= 16 * 3600:
                errors.append(f"{label} duration must be a sleep length up to 16 hours")
            stages = [parse_duration(raw.get(field, "")) for field in ("rem", "deep", "core")]
            if duration is not None and all(stage is not None for stage in stages):
                if abs(sum(stages) - duration) > 120:
                    errors.append(f"{label} sleep stages do not add up to duration")
            for clock in ("bedtime", "wake"):
                text = raw.get(clock, "")
                if text and not re.fullmatch(r"\d{2}:\d{2}", text):
                    errors.append(f"{label} {clock} must be HH:MM")
            key = (iso, source)
        elif name == "activity":
            errors.extend(_number_errors(raw, {
                "steps": (0, 150000),
                "distance_mi": (0, 50),
                "active_kcal": (0, 10000),
                "basal_kcal": (0, 10000),
                "total_kcal": (0, 20000),
            }, label))
            active_kcal, basal, total = num(raw.get("active_kcal", "")), num(raw.get("basal_kcal", "")), num(raw.get("total_kcal", ""))
            if None not in (active_kcal, basal, total) and abs(total - (active_kcal + basal)) > 1:
                errors.append(f"{label} total_kcal must equal active plus basal")
            key = (iso, source)
        elif name == "recovery":
            errors.extend(_number_errors(raw, {
                "hrv_ms": (5, 200),
                "resting_hr": (30, 120),
                "soreness": (1, 10),
                "fatigue": (1, 10),
                "readiness": (0, 100),
            }, label))
            key = (iso, source)
        else:
            if not raw.get("session"):
                errors.append(f"{label} session is required")
            key = (iso, source)
        if key in seen:
            errors.append(f"{label} duplicates another row ({key[0]})")
        seen.add(key)
    return errors


def validate_repo(root: Path) -> tuple[str, int]:
    lines = ["Health data check"]
    errors: list[str] = []
    for name, (filename, columns) in STREAM_FILES.items():
        path = root / "data" / filename
        if not path.is_file():
            errors.append(f"missing data/{filename}")
            continue
        text = path.read_text(encoding="utf-8-sig")
        header = next((line for line in text.splitlines() if line.strip() and not line.strip().startswith("#")), "")
        found = [cell.strip() for cell in next(csv.reader(io.StringIO(header)))]
        missing = [column for column in columns if column not in found]
        if missing:
            errors.append(f"data/{filename} missing columns: {', '.join(missing)}")
        errors.extend(validate_stream_rows(name, read_table(text)))
    projects_path = root / "data" / "projects.json"
    if not projects_path.is_file():
        errors.append("missing data/projects.json")
    else:
        try:
            document = json.loads(projects_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"projects.json is not valid JSON ({exc})")
        else:
            if not document.get("projects"):
                errors.append("projects.json needs a projects list")
    lines.append(f"Errors: {len(errors)}")
    lines.extend(f"ERROR {message}" for message in errors)
    return "\n".join(lines) + "\n", 1 if errors else 0


def coach_context(root: Path, today: str) -> dict:
    bundle = load_bundle(root, today)
    streams = bundle["streams"]

    def recent(rows: list[dict], keys: tuple[str, ...]) -> list[dict]:
        start = add_days(today, -13)
        picked = [row for row in rows if row.get("date", "") >= start]
        compact = []
        for row in picked:
            compact.append({key: row.get(key) for key in keys if row.get(key) not in (None, "")})
        return compact

    score = bundle["scorecard"]
    return {
        "note": "Compact context for an outside coach. The site does not call an API.",
        "today": today,
        "scorecard": {
            "day_score": score["day_score"],
            "partial": score["partial"],
            "subs": score["subs"],
            "win": score["win"],
            "watch": score["watch"],
        },
        "prediction": bundle["prediction"],
        "projects": [
            {
                "id": project["id"],
                "name": project["name"],
                "status": project["status"],
                "percent": project.get("percent"),
                "current": project.get("current"),
                "targets": [
                    {"id": target["id"], "met": target["met"], "display": target["display"]}
                    for target in project.get("targets", [])
                ],
            }
            for project in bundle["projects"]
        ],
        "recent": {
            "body": recent(streams["body"], ("date", "weight_kg", "bmi", "body_fat")),
            "nutrition": recent(
                [row for row in streams["nutrition"] if row.get("row_kind") == "daily"],
                ("date", "kcal", "protein", "hydration"),
            ),
            "sleep": recent(streams["sleep"], ("date", "duration_sec", "bedtime", "wake")),
            "activity": recent(streams["activity"], ("date", "steps", "distance_mi", "total_kcal")),
            "recovery": recent(streams["recovery"], ("date", "hrv", "rhr", "readiness")),
            "plan": recent(streams["plan"], ("date", "session", "goal")),
        },
    }


def context_markdown(context: dict) -> str:
    score = context["scorecard"]
    lines = [
        "# Coach context",
        "",
        context["note"],
        "",
        f"Today: {context['today']}",
        f"Day score: {score['day_score']} (win {score['win']}, watch {score['watch']})",
        "Subscores: " + ", ".join(f"{name} {score['subs'][name]}" for name in SUB_ORDER),
        f"Predicted 2-mile: {context['prediction'].get('display')} ({context['prediction'].get('status')})",
        "",
        "## Projects",
        "",
    ]
    for project in context["projects"]:
        if project["status"] == "placeholder":
            lines.append(f"- {project['name']}: placeholder")
            continue
        bits = ", ".join(f"{target['id']} {target['display']} ({'met' if target['met'] else 'not yet'})" for target in project["targets"])
        lines.append(f"- {project['name']}: {project.get('current')} ({project.get('percent')}%). {bits}")
    lines.extend(["", "## Recent rows", ""])
    for name, rows in context["recent"].items():
        lines.append(f"### {name}")
        for row in rows:
            lines.append("- " + ", ".join(f"{key}={value}" for key, value in row.items()))
        lines.append("")
    return "\n".join(lines)


def latest_date(root: Path) -> str:
    dates = []
    for filename, _columns in STREAM_FILES.values():
        for row in read_csv(root / "data" / filename):
            if row.get("date"):
                dates.append(row["date"])
    return max(dates) if dates else date.today().isoformat()


def self_test() -> None:
    def check(condition: bool, message: str) -> None:
        if not condition:
            raise AssertionError(message)

    report, code = validate_repo(ROOT)
    check(code == 0, report)
    today = "2026-10-03"
    bundle = load_bundle(ROOT, today)
    score = bundle["scorecard"]
    check(score["day_score"] == 72, score)
    check(score["subs"] == {
        "movement": 80,
        "training": 30,
        "nutrition": 100,
        "hydration": 80,
        "recovery": 58,
        "sleep": 81,
    }, score["subs"])
    check(score["win"] == "nutrition" and score["watch"] == "training", score)
    check(score["partial"] is False, score)
    check(score["totals"]["kcal"] == 2280, score["totals"])
    check(score["totals"]["protein"] == 142, score["totals"])
    check(bundle["prediction"]["display"] == "16:28", bundle["prediction"])
    sub = next(project for project in bundle["projects"] if project["id"] == "sub-15")
    check(sub["percent"] == 30 and sub["current"] == "16:52", sub)
    targets = {target["id"]: target for target in sub["targets"]}
    check(targets["sleep"]["met"] is False and targets["sleep"]["display"] == "6:42", targets["sleep"])
    check(targets["protein"]["met"] is True and targets["protein"]["display"] == "141.7", targets["protein"])
    check(targets["miles"]["met"] is True and targets["miles"]["display"] == "8.70", targets["miles"])
    check(targets["recovery"]["met"] is False and targets["recovery"]["display"] == "68.6", targets["recovery"])
    check(targets["consistency"]["met"] is True and targets["consistency"]["display"] == "100% (10/10)", targets["consistency"])
    check(all(project["status"] == "placeholder" for project in bundle["projects"] if project["id"] != "sub-15"), bundle["projects"])

    food_only = nutrition_totals([
        {"date": "2026-10-03", "data_source": "mock", "row_kind": "daily", "kcal": 2280, "protein": 142, "hydration": 2000},
        {"date": "2026-10-03", "data_source": "mock", "row_kind": "food", "name": "oats", "kcal": 420, "protein": 18, "hydration": None},
    ], "2026-10-03")
    check(food_only["kcal"] == 2280 and food_only["protein"] == 142, food_only)

    generated = "2026-10-03T18:00:00-04:00"
    same = datetime.fromisoformat("2026-10-05T18:00:00-04:00")
    later = datetime.fromisoformat("2026-10-05T18:00:01-04:00")
    check(coach_is_stale(generated, same) is False, "exactly 48h is not stale")
    check(coach_is_stale(generated, later) is True, "past 48h is stale")

    context = coach_context(ROOT, today)
    check(context["scorecard"]["day_score"] == 72, context["scorecard"])
    markdown = context_markdown(context)
    check("Coach context" in markdown and "Projects" in markdown, markdown)


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        self_test()
        print("health self-test passed")
        return 0
    report, code = validate_repo(ROOT)
    sys.stdout.write(report)
    return code


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except AssertionError as exc:
        print(f"health self-test failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
