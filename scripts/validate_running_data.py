#!/usr/bin/env python3
"""Check data/running_data.csv and print derived running metrics.

Stdlib only. Exit 0 when the file is clean. Exit 1 when a row has a
structural problem, a duplicate, or an impossible value. Impossible
values are reported as anomalies so they are not treated as records.

Usage:
  python3 scripts/validate_running_data.py
  python3 scripts/validate_running_data.py path/to/file.csv
  python3 scripts/validate_running_data.py --self-test
"""

from __future__ import annotations

import csv
import io
import math
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = ROOT / "data" / "running_data.csv"

GOAL_SEC = 900
IMPOSSIBLE_PACE_SEC = 150  # 2:30/mi or faster, any distance (2 mi in 5:00)
MILE_WR_PACE_SEC = 223  # faster than 3:43/mi over >= 1 mile
MIN_COMPARABLE_MI_TH = 1000  # thousandths
MAX_COMPARABLE_MI_TH = 4000
BENCH_MIN_TH = 1950  # 1.95 mi
BENCH_MAX_TH = 2050  # 2.05 mi
MAX_DISTANCE_TH = 50000  # 50 mi
MAX_DURATION_SEC = 8 * 3600
HR_MIN = 30
HR_MAX = 230
CADENCE_MIN = 50
CADENCE_MAX = 250
STRIDE_MIN_MM = 300  # 0.300 m stored as millimeters
STRIDE_MAX_MM = 3000
GCT_MIN = 50
GCT_MAX = 500
CALORIES_MAX = 5000

EXERCISE_TYPES = ("Exercise at La Pista", "Running at the Beach", "Treadmill")
WALKING_TYPES = ("Walking to a Place", "Recovery Walk")
ACTIVITY_TYPES = EXERCISE_TYPES + WALKING_TYPES
DATA_SOURCES = ("apple_watch", "manual", "estimate", "mock", "apple_health_import")
COMPLETED_VALUES = ("yes", "partial", "no")
ENERGY_VALUES = ("low", "moderate", "high")

COLUMNS = (
    "date",
    "week",
    "activity_type",
    "workout",
    "distance_mi",
    "duration",
    "pace_per_mi",
    "continuous_running_time",
    "walk_breaks",
    "rpe",
    "energy",
    "completed",
    "notes",
    "is_benchmark",
    "data_source",
    "avg_hr",
    "max_hr",
    "avg_cadence",
    "active_calories",
    "stride_length_m",
    "ground_contact_time_ms",
    "temp_f",
    "humidity_pct",
    "dew_point_f",
    "incline_pct",
)

HEADER_STRING = "RUNNING — 2-MILE SPEED · ENDURANCE · WEEKLY PROGRESS"


@dataclass
class Row:
    line: int
    date: str
    week: int
    activity_type: str
    workout: str
    distance_th: int
    duration_sec: int
    pace_sec: int | None
    continuous_sec: int
    walk_breaks: int
    rpe: int | None
    energy: str
    completed: str
    notes: str
    is_benchmark: str
    data_source: str
    avg_hr: int | None = None
    anomalies: list[str] = field(default_factory=list)


@dataclass
class Issue:
    line: int
    level: str
    message: str


@dataclass
class Metrics:
    best_two_mile: tuple[int, str] | None
    best_pace: tuple[int, int, str] | None
    exercise_th: int
    walking_th: int
    longest: tuple[int, str] | None
    valid_benchmarks: int
    excluded_benchmarks: list[str]
    trend: str
    trend_detail: str


def div_round_half_up(numer: int, denom: int) -> int:
    if denom <= 0:
        raise ValueError("denominator must be positive")
    return (2 * numer + denom) // (2 * denom)


def parse_miles_thousandths(text: str) -> int | None:
    if not re.fullmatch(r"\d+(?:\.\d{1,3})?", text):
        return None
    whole, _, frac = text.partition(".")
    frac = (frac + "000")[:3]
    return int(whole) * 1000 + int(frac)


def format_miles(thousandths: int) -> str:
    if thousandths % 10 == 0:
        return f"{thousandths / 1000:.2f}"
    return f"{thousandths / 1000:.3f}"


def parse_duration(text: str) -> int | None:
    parts = text.split(":")
    if len(parts) not in (2, 3):
        return None
    if any(not re.fullmatch(r"\d+", part) for part in parts):
        return None
    nums = [int(part) for part in parts]
    if len(nums) == 2:
        minutes, seconds = nums
        if seconds > 59:
            return None
        return minutes * 60 + seconds
    hours, minutes, seconds = nums
    if minutes > 59 or seconds > 59:
        return None
    return hours * 3600 + minutes * 60 + seconds


def format_duration(seconds: int) -> str:
    seconds = int(seconds)
    sign = "-" if seconds < 0 else ""
    seconds = abs(seconds)
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{sign}{hours}:{minutes:02d}:{secs:02d}"
    return f"{sign}{minutes}:{secs:02d}"


def expected_pace(duration_sec: int, distance_th: int) -> int:
    return div_round_half_up(duration_sec * 1000, distance_th)


def parse_optional_int(text: str) -> tuple[int | None, str | None]:
    if text == "":
        return None, None
    if not re.fullmatch(r"\d+", text):
        return None, "must be a whole number"
    return int(text), None


def parse_optional_stride_mm(text: str) -> tuple[int | None, str | None]:
    if text == "":
        return None, None
    thousandths_of_meter = parse_miles_thousandths(text)
    if thousandths_of_meter is None:
        return None, "must be a number in meters"
    return thousandths_of_meter, None


def logical_records(text: str) -> tuple[list[tuple[int, str]], list[Issue]]:
    """Split a CSV into physical lines. Quoted newlines are rejected."""
    issues: list[Issue] = []
    records: list[tuple[int, str]] = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        if line.count('"') % 2 == 1:
            issues.append(Issue(line_no, "error", "quoted line breaks are not supported"))
            continue
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        records.append((line_no, line))
    return records, issues


def validate_text(text: str, source_name: str = "data/running_data.csv") -> tuple[list[Row], list[Issue]]:
    records, issues = logical_records(text)
    if not records:
        issues.append(Issue(0, "error", "the CSV has no header row"))
        return [], issues

    header_line_no, header_line = records[0]
    try:
        header = next(csv.reader(io.StringIO(header_line)))
    except csv.Error as exc:
        issues.append(Issue(header_line_no, "error", f"header could not be read ({exc})"))
        return [], issues

    header = [cell.strip() for cell in header]
    missing = [name for name in COLUMNS if name not in header]
    if missing:
        issues.append(Issue(header_line_no, "error", "missing columns: " + ", ".join(missing)))
        return [], issues
    if len(header) != len(set(header)):
        issues.append(Issue(header_line_no, "error", "duplicate column names"))
        return [], issues

    rows: list[Row] = []
    seen: dict[tuple[str, str, str, str, str], int] = {}
    weeks_by_date: dict[str, int] = {}

    for line_no, line in records[1:]:
        try:
            cells = next(csv.reader(io.StringIO(line)))
        except csv.Error as exc:
            issues.append(Issue(line_no, "error", f"could not read row ({exc})"))
            continue
        if len(cells) > len(header):
            issues.append(
                Issue(line_no, "error", f"expected {len(header)} columns, found {len(cells)}")
            )
            continue
        if len(cells) < len(header):
            cells = cells + [""] * (len(header) - len(cells))
        raw = {header[i]: cells[i].strip() for i in range(len(header))}
        row, row_issues = build_row(line_no, raw)
        issues.extend(row_issues)
        if row is None:
            continue

        key = (row.date, row.activity_type, row.workout, str(row.distance_th), str(row.duration_sec))
        if key in seen:
            issues.append(
                Issue(
                    line_no,
                    "error",
                    f"duplicate of line {seen[key]} (same date, activity, workout, distance, and duration)",
                )
            )
            continue
        seen[key] = line_no

        prior_week = weeks_by_date.get(row.date)
        if prior_week is not None and prior_week != row.week:
            issues.append(
                Issue(line_no, "error", f"{row.date} is already recorded as week {prior_week}")
            )
            continue
        weeks_by_date[row.date] = row.week
        rows.append(row)

    return rows, issues


def build_row(line_no: int, raw: dict[str, str]) -> tuple[Row | None, list[Issue]]:
    issues: list[Issue] = []

    def error(message: str) -> None:
        issues.append(Issue(line_no, "error", message))

    date = raw.get("date", "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        error("date must be YYYY-MM-DD")
        date_ok = False
    else:
        year, month, day = (int(part) for part in date.split("-"))
        date_ok = valid_calendar_date(year, month, day)
        if not date_ok:
            error("date is not a real calendar day")

    week_text = raw.get("week", "")
    week = 0
    if not re.fullmatch(r"[1-9]\d*", week_text):
        error("week must be a positive whole number")
    else:
        week = int(week_text)

    activity = raw.get("activity_type", "")
    if activity not in ACTIVITY_TYPES:
        error(
            "activity_type must be one of: " + ", ".join(ACTIVITY_TYPES)
        )

    workout = raw.get("workout", "")
    if not workout:
        error("workout is required")

    distance_text = raw.get("distance_mi", "")
    distance_th = parse_miles_thousandths(distance_text)
    if distance_th is None:
        error("distance_mi must be a number from 0 to 3 decimal places")
        distance_th = -1

    duration = parse_duration(raw.get("duration", ""))
    if duration is None:
        error("duration must be M:SS or H:MM:SS")
        duration = -1

    pace_text = raw.get("pace_per_mi", "")
    pace = parse_duration(pace_text) if pace_text else None
    if pace_text and pace is None:
        error("pace_per_mi must be M:SS or H:MM:SS")

    continuous = parse_duration(raw.get("continuous_running_time", ""))
    if continuous is None:
        error("continuous_running_time must be M:SS or H:MM:SS")
        continuous = -1

    breaks_text = raw.get("walk_breaks", "")
    if not re.fullmatch(r"\d+", breaks_text):
        error("walk_breaks must be a whole number")
        breaks = -1
    else:
        breaks = int(breaks_text)

    completed = raw.get("completed", "").lower()
    if completed not in COMPLETED_VALUES:
        error("completed must be yes, partial, or no")

    rpe_text = raw.get("rpe", "")
    rpe: int | None = None
    imported = raw.get("data_source", "").lower() == "apple_health_import"
    if rpe_text == "":
        if completed in ("yes", "partial") and not imported:
            error("rpe is required when completed is yes or partial")
    elif not re.fullmatch(r"[1-9]|10", rpe_text):
        error("rpe must be a whole number from 1 to 10")
    else:
        rpe = int(rpe_text)

    energy = raw.get("energy", "").lower()
    if energy == "":
        if completed in ("yes", "partial") and not imported:
            error("energy is required when completed is yes or partial")
    elif energy not in ENERGY_VALUES:
        error("energy must be low, moderate, or high")

    benchmark = raw.get("is_benchmark", "").lower()
    if benchmark not in ("yes", "no"):
        error("is_benchmark must be yes or no")

    source = raw.get("data_source", "").lower()
    if source not in DATA_SOURCES:
        error("data_source must be " + ", ".join(DATA_SOURCES))

    notes = raw.get("notes", "")

    avg_hr, hr_err = parse_optional_int(raw.get("avg_hr", ""))
    if hr_err:
        error("avg_hr " + hr_err)
    max_hr, max_err = parse_optional_int(raw.get("max_hr", ""))
    if max_err:
        error("max_hr " + max_err)
    cadence, cad_err = parse_optional_int(raw.get("avg_cadence", ""))
    if cad_err:
        error("avg_cadence " + cad_err)
    calories, cal_err = parse_optional_int(raw.get("active_calories", ""))
    if cal_err:
        error("active_calories " + cal_err)
    stride_mm, stride_err = parse_optional_stride_mm(raw.get("stride_length_m", ""))
    if stride_err:
        error("stride_length_m " + stride_err)
    gct, gct_err = parse_optional_int(raw.get("ground_contact_time_ms", ""))
    if gct_err:
        error("ground_contact_time_ms " + gct_err)

    structural = [issue for issue in issues if issue.level == "error"]
    if structural or distance_th < 0 or duration < 0 or continuous < 0 or breaks < 0:
        return None, issues

    if distance_th == 0 and pace is not None:
        error("pace_per_mi must be blank when distance is 0")
    if distance_th > 0 and pace is None:
        error("pace_per_mi is required when distance is greater than 0")
    if distance_th > 0 and duration == 0:
        error("duration cannot be 0:00 when distance is greater than 0")
    if distance_th > 0 and duration > 0 and pace is not None:
        want = expected_pace(duration, distance_th)
        if pace != want:
            error(
                f"pace_per_mi is {format_duration(pace)} but duration ÷ distance is {format_duration(want)}"
            )
    if continuous > duration:
        error("continuous_running_time cannot be longer than duration")
    if activity in WALKING_TYPES and continuous != 0:
        error("walking activities must use continuous_running_time of 0:00")
    if activity in WALKING_TYPES and benchmark == "yes":
        error("a walk cannot be marked as a 2-mile benchmark")

    def optional_number(text: str, label: str, low: float, high: float) -> None:
        if text == "":
            return
        try:
            value = float(text)
        except ValueError:
            error(f"{label} must be a number")
            return
        if not low <= value <= high:
            error(f"{label} is outside {low}–{high}")

    optional_number(raw.get("temp_f", ""), "temp_f", 20, 120)
    optional_number(raw.get("humidity_pct", ""), "humidity_pct", 0, 100)
    optional_number(raw.get("dew_point_f", ""), "dew_point_f", 0, 100)
    optional_number(raw.get("incline_pct", ""), "incline_pct", 0, 15)

    if any(issue.level == "error" for issue in issues):
        return None, issues

    anomalies: list[str] = []
    if distance_th > MAX_DISTANCE_TH:
        anomalies.append(f"distance {format_miles(distance_th)} mi is above 50 mi")
    if duration > MAX_DURATION_SEC:
        anomalies.append("duration is longer than 8 hours")
    if distance_th > 0 and pace is not None:
        if pace <= IMPOSSIBLE_PACE_SEC:
            anomalies.append(
                f"impossible pace {format_duration(pace)}/mi "
                f"({format_miles(distance_th)} mi in {format_duration(duration)})"
            )
        elif distance_th >= 1000 and pace < MILE_WR_PACE_SEC:
            anomalies.append(
                f"impossible pace {format_duration(pace)}/mi over {format_miles(distance_th)} mi "
                "(faster than 3:43/mi)"
            )
    if avg_hr is not None and not HR_MIN <= avg_hr <= HR_MAX:
        anomalies.append(f"avg_hr {avg_hr} is outside {HR_MIN}–{HR_MAX}")
    if max_hr is not None and not HR_MIN <= max_hr <= HR_MAX:
        anomalies.append(f"max_hr {max_hr} is outside {HR_MIN}–{HR_MAX}")
    if avg_hr is not None and max_hr is not None and max_hr < avg_hr:
        anomalies.append("max_hr is lower than avg_hr")
    if cadence is not None and not CADENCE_MIN <= cadence <= CADENCE_MAX:
        anomalies.append(f"avg_cadence {cadence} is outside {CADENCE_MIN}–{CADENCE_MAX}")
    if stride_mm is not None and not STRIDE_MIN_MM <= stride_mm <= STRIDE_MAX_MM:
        anomalies.append("stride_length_m is outside 0.300–3.000 m")
    if gct is not None and not GCT_MIN <= gct <= GCT_MAX:
        anomalies.append(f"ground_contact_time_ms {gct} is outside {GCT_MIN}–{GCT_MAX}")
    if calories is not None and calories > CALORIES_MAX:
        anomalies.append(f"active_calories {calories} is above {CALORIES_MAX}")

    row = Row(
        line=line_no,
        date=date,
        week=week,
        activity_type=activity,
        workout=workout,
        distance_th=distance_th,
        duration_sec=duration,
        pace_sec=pace,
        continuous_sec=continuous,
        walk_breaks=breaks,
        rpe=rpe,
        energy=energy,
        completed=completed,
        notes=notes,
        is_benchmark=benchmark,
        data_source=source,
        avg_hr=avg_hr,
        anomalies=anomalies,
    )
    return row, issues


def valid_calendar_date(year: int, month: int, day: int) -> bool:
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return False
    month_lengths = [31, 29 if leap(year) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return day <= month_lengths[month - 1]


def leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def estimated_dew_point_f(temp_f: float, humidity_pct: float) -> float:
    temp_c = (temp_f - 32) * 5 / 9
    alpha = math.log(humidity_pct / 100) + (17.625 * temp_c) / (243.04 + temp_c)
    dew_c = (243.04 * alpha) / (17.625 - alpha)
    return dew_c * 9 / 5 + 32


def round_half_up_number(value: float) -> int:
    return math.floor(value + 0.5)


def compared_pace(
    activity: str,
    pace_sec: int | None,
    incline: float | None = None,
    dew: float | None = None,
    temp: float | None = None,
    humidity: float | None = None,
) -> int | None:
    """Outdoor-equivalent pace. Never replaces the stored pace."""
    if pace_sec is None or activity in WALKING_TYPES:
        return None
    factor = 1.0
    labels: list[str] = []
    if activity == "Treadmill":
        grade = 0.0 if incline is None else incline
        factor *= 1 + 0.04 * (1 - grade)
        labels.append("outdoor est.")
    if dew is None and temp is not None and humidity is not None:
        dew = estimated_dew_point_f(temp, humidity)
    if dew is not None and dew >= 50:
        factor *= 1 + min(0.15, (dew - 50) * 0.005)
        labels.append("heat est.")
    if not labels:
        return None
    return round_half_up_number(pace_sec * factor)


def benchmark_problems(row: Row) -> list[str]:
    if row.is_benchmark != "yes":
        return []
    problems: list[str] = []
    if row.activity_type not in EXERCISE_TYPES:
        problems.append("not an exercise activity")
    if row.completed != "yes":
        problems.append(f"completed is {row.completed}")
    if row.walk_breaks != 0:
        problems.append("walk breaks")
    if not BENCH_MIN_TH <= row.distance_th <= BENCH_MAX_TH:
        problems.append("distance is not about 2.00 mi")
    if abs(row.continuous_sec - row.duration_sec) > 2:
        problems.append("not continuous")
    if row.anomalies:
        problems.append("flagged value")
    if row.activity_type == "Treadmill":
        problems.append("treadmill is an estimate, not a track benchmark")
    return problems


def clean_rows(rows: list[Row]) -> list[Row]:
    return [row for row in rows if not row.anomalies]


def exercise_rows(rows: list[Row]) -> list[Row]:
    return [
        row
        for row in rows
        if row.activity_type in EXERCISE_TYPES and row.completed in ("yes", "partial") and row.distance_th > 0
    ]


def compute_metrics(rows: list[Row]) -> Metrics:
    usable = clean_rows(rows)
    counted = [row for row in usable if row.completed in ("yes", "partial")]
    exercise_th = sum(row.distance_th for row in counted if row.activity_type in EXERCISE_TYPES)
    walking_th = sum(row.distance_th for row in counted if row.activity_type in WALKING_TYPES)

    benchmarks = []
    excluded: list[str] = []
    for row in usable:
        if row.is_benchmark != "yes":
            continue
        problems = benchmark_problems(row)
        if problems:
            excluded.append(
                f"{row.date} {row.workout}: " + ", ".join(problems)
            )
        else:
            benchmarks.append(row)
    best_two = min(benchmarks, key=lambda row: (row.duration_sec, row.date)) if benchmarks else None

    comparable = [
        row
        for row in usable
        if row.activity_type in EXERCISE_TYPES
        and row.activity_type != "Treadmill"
        and row.completed == "yes"
        and MIN_COMPARABLE_MI_TH <= row.distance_th <= MAX_COMPARABLE_MI_TH
        and row.pace_sec is not None
    ]
    best_pace_row = min(comparable, key=lambda row: (row.pace_sec or 0, row.date)) if comparable else None

    continuous_candidates = [
        row
        for row in usable
        if row.activity_type in EXERCISE_TYPES and row.completed in ("yes", "partial") and row.continuous_sec > 0
    ]
    longest = max(continuous_candidates, key=lambda row: (row.continuous_sec, row.date)) if continuous_candidates else None

    trend, detail = classify_trend(exercise_rows(usable))
    return Metrics(
        best_two_mile=(best_two.duration_sec, best_two.date) if best_two else None,
        best_pace=(best_pace_row.pace_sec, best_pace_row.distance_th, best_pace_row.date) if best_pace_row and best_pace_row.pace_sec is not None else None,
        exercise_th=exercise_th,
        walking_th=walking_th,
        longest=(longest.continuous_sec, longest.date) if longest else None,
        valid_benchmarks=len(benchmarks),
        excluded_benchmarks=excluded,
        trend=trend,
        trend_detail=detail,
    )


def classify_trend(rows: list[Row]) -> tuple[str, str]:
    if len({row.week for row in rows}) < 2 or len(rows) < 4:
        return "insufficient data", "Need at least four exercise sessions across two weeks."
    ordered = sorted(rows, key=lambda row: (row.date, row.line))
    midpoint = ordered[len(ordered) // 2].date
    earlier = [row for row in ordered if row.date < midpoint]
    recent = [row for row in ordered if row.date >= midpoint]
    if len(earlier) < 2 or len(recent) < 2:
        return "insufficient data", "Need at least two exercise sessions on each side of the log."

    pace_earlier = weighted_pace(earlier)
    pace_recent = weighted_pace(recent)
    end_earlier = max(row.continuous_sec for row in earlier)
    end_recent = max(row.continuous_sec for row in recent)
    rpe_earlier = mean_rpe(earlier)
    rpe_recent = mean_rpe(recent)

    pace_improving = pace_earlier is not None and pace_recent is not None and pace_earlier - pace_recent >= 5
    pace_worse = pace_earlier is not None and pace_recent is not None and pace_recent - pace_earlier >= 10
    end_improving = end_recent - end_earlier >= 120
    end_worse = end_earlier - end_recent >= 120
    rpe_up = (
        rpe_earlier is not None
        and rpe_recent is not None
        and rpe_recent - rpe_earlier >= 1
        and rpe_recent >= 7
    )
    if rpe_up and (pace_worse or end_worse or not (pace_improving or end_improving)):
        return "high fatigue", "Recent RPE is up and pace or endurance is flat or worse."
    if pace_improving and end_improving:
        return "normal progression", "Comparable pace is faster and the longest continuous run is longer."
    if pace_improving:
        return "improving pace", "Comparable pace is faster. Continuous duration has not moved the same way."
    if end_improving:
        return "improving endurance", "The longest continuous run is longer. Comparable pace has not moved the same way."
    return "stalled", "Comparable pace and continuous running are flat or worse."


def weighted_pace(rows: list[Row]) -> int | None:
    picked = [
        row
        for row in rows
        if row.completed == "yes" and MIN_COMPARABLE_MI_TH <= row.distance_th <= MAX_COMPARABLE_MI_TH
    ]
    distance = sum(row.distance_th for row in picked)
    if distance <= 0:
        return None
    duration = sum(row.duration_sec for row in picked)
    return div_round_half_up(duration * 1000, distance)


def mean_rpe(rows: list[Row]) -> float | None:
    values = [row.rpe for row in rows if row.rpe is not None]
    if not values:
        return None
    return sum(values) / len(values)


def gap_phrase(seconds: int) -> str:
    delta = seconds - GOAL_SEC
    if delta == 0:
        return "matches 15:00"
    if delta > 0:
        return f"{format_duration(delta)} slower than 15:00"
    return f"{format_duration(-delta)} faster than 15:00"


def format_metrics_block(title: str, metrics: Metrics) -> list[str]:
    lines = [title]
    if metrics.best_two_mile:
        seconds, date = metrics.best_two_mile
        lines.append(
            f"Best 2-mile: {format_duration(seconds)} ({gap_phrase(seconds)}) on {date}"
        )
    else:
        lines.append("Best 2-mile: —")
    lines.append("Goal: 15:00")
    if metrics.best_pace:
        pace, distance, date = metrics.best_pace
        lines.append(
            f"Best pace: {format_duration(pace)}/mi at {format_miles(distance)} mi on {date}"
        )
    else:
        lines.append("Best pace: —")
    lines.append(f"Exercise miles: {format_miles(metrics.exercise_th)}")
    lines.append(f"Walking miles: {format_miles(metrics.walking_th)}")
    if metrics.longest:
        seconds, date = metrics.longest
        lines.append(f"Longest continuous run: {format_duration(seconds)} on {date}")
    else:
        lines.append("Longest continuous run: —")
    lines.append(f"Valid 2-mile benchmarks: {metrics.valid_benchmarks}")
    lines.append(f"Left off the 2-mile chart: {len(metrics.excluded_benchmarks)}")
    for item in metrics.excluded_benchmarks:
        lines.append(f"  {item}")
    lines.append(f"Trend: {metrics.trend}")
    lines.append(metrics.trend_detail)
    return lines


def authoritative_rows(rows: list[Row]) -> list[Row]:
    real = [row for row in rows if row.data_source != "mock"]
    return real


def format_report(path: Path, rows: list[Row], issues: list[Issue]) -> str:
    errors = [issue for issue in issues if issue.level == "error"]
    anomalies = [(row.line, message) for row in rows for message in row.anomalies]
    real = authoritative_rows(rows)
    mock = [row for row in rows if row.data_source == "mock"]
    lines = [
        "Running data check",
        f"File: {path.as_posix()}",
        f"Rows: {len(rows)} (real {len(real)}, mock {len(mock)})",
        f"Errors: {len(errors)}",
        f"Anomalies: {len(anomalies)}",
        "",
    ]
    for issue in errors:
        where = f"line {issue.line}: " if issue.line else ""
        lines.append(f"ERROR {where}{issue.message}")
    for line_no, message in anomalies:
        lines.append(f"ANOMALY line {line_no}: {message} — flagged, not accepted as a record")
    if errors or anomalies:
        lines.append("")

    lines.extend(format_metrics_block("Derived metrics (real rows only)", compute_metrics(real)))
    lines.append("")
    if real:
        if mock:
            lines.append(f"Mock rows ignored: {len(mock)}")
    else:
        lines.append("No real activities yet, so the trend is not estimated from the sample.")
        lines.append("")
        preview = compute_metrics(mock)
        block = format_metrics_block(
            "Mock preview (not used for KPIs, charts, or the trend above)",
            preview,
        )
        # The preview block starts with "Trend:"; rename that one line so the
        # authoritative trend stays the only line that begins with "Trend:".
        renamed = []
        for line in block:
            if line.startswith("Trend: "):
                renamed.append("Preview trend: " + line[len("Trend: "):])
            else:
                renamed.append(line)
        lines.extend(renamed)
    return "\n".join(lines) + "\n"


def analyze_path(path: Path) -> tuple[str, int]:
    if not path.is_file():
        report = f"Running data check\nFile: {path.as_posix()}\nERROR file not found\n"
        return report, 1
    text = path.read_text(encoding="utf-8-sig")
    rows, issues = validate_text(text, path.as_posix())
    report = format_report(path, rows, issues)
    failed = any(issue.level == "error" for issue in issues) or any(row.anomalies for row in rows)
    return report, 1 if failed else 0


def self_test() -> None:
    def check(condition: bool, message: str) -> None:
        if not condition:
            raise AssertionError(message)

    report, code = analyze_path(DEFAULT_DATA)
    check(code == 0, report)
    check("Trend: insufficient data" in report, report)
    check("Preview trend: normal progression" in report, report)
    check("Best 2-mile: —" in report, report)
    check("Exercise miles: 0.00" in report, report)
    check("Walking miles: 0.00" in report, report)
    check("Best 2-mile: 16:52 (1:52 slower than 15:00) on 2026-09-26" in report, report)
    check("Best pace: 8:10/mi at 1.50 mi on 2026-09-23" in report, report)
    check("Exercise miles: 44.40" in report, report)
    check("Walking miles: 14.00" in report, report)
    check("Longest continuous run: 36:00 on 2026-09-25" in report, report)
    check("Valid 2-mile benchmarks: 2" in report, report)
    check("Left off the 2-mile chart: 1" in report, report)
    check("2026-09-19" in report and "walk breaks" in report, report)
    check("Rows: 29 (real 0, mock 29)" in report, report)

    rows, issues = validate_text(DEFAULT_DATA.read_text(encoding="utf-8"))
    check(issues == [], issues)
    check(all(row.data_source == "mock" for row in rows), "sample file must be mock only")
    exercise = sum(row.distance_th for row in rows if row.activity_type in EXERCISE_TYPES and row.completed in ("yes", "partial"))
    walking = sum(row.distance_th for row in rows if row.activity_type in WALKING_TYPES)
    check(exercise == 44400, exercise)
    check(walking == 14000, walking)
    transport = sum(row.distance_th for row in rows if row.activity_type == "Walking to a Place")
    check(transport == 6000, transport)

    def csv_for(data_rows: list[str]) -> str:
        return "\n".join(("# comment", ",".join(COLUMNS), *data_rows)) + "\n"

    def sample(
        date: str = "2026-10-01",
        week: str = "5",
        activity: str = "Running at the Beach",
        workout: str = "Easy aerobic",
        distance: str = "2.00",
        duration: str = "18:00",
        pace: str = "9:00",
        continuous: str = "18:00",
        breaks: str = "0",
        rpe: str = "4",
        energy: str = "moderate",
        completed: str = "yes",
        notes: str = "example",
        benchmark: str = "no",
        source: str = "manual",
        avg_hr: str = "",
        max_hr: str = "",
        cadence: str = "",
        calories: str = "",
        stride: str = "",
        gct: str = "",
    ) -> str:
        return ",".join(
            [
                date, week, activity, workout, distance, duration, pace, continuous,
                breaks, rpe, energy, completed, notes, benchmark, source,
                avg_hr, max_hr, cadence, calories, stride, gct,
            ]
        )

    good, good_issues = validate_text(csv_for([sample()]))
    check(good_issues == [], good_issues)
    check(len(good) == 1, good)

    def expect_error(row: str, snippet: str) -> None:
        parsed, parsed_issues = validate_text(csv_for([row]))
        messages = " ".join(issue.message for issue in parsed_issues)
        check(any(issue.level == "error" for issue in parsed_issues), messages or parsed)
        check(snippet in messages, messages)

    expect_error(sample(activity="Jog"), "activity_type")
    expect_error(sample(pace="9:05"), "pace_per_mi")
    expect_error(sample(date="2026-02-31"), "calendar")
    expect_error(sample(rpe="11"), "rpe")
    expect_error(sample(completed="maybe"), "completed")
    expect_error(
        sample(activity="Walking to a Place", workout="TO TRACK", pace="20:00", duration="40:00", continuous="0:00", distance="2.00", benchmark="yes", rpe="2", energy="low"),
        "walk cannot be marked",
    )
    expect_error(
        sample(activity="Recovery Walk", workout="Recovery", pace="20:00", duration="40:00", continuous="10:00", distance="2.00", rpe="2", energy="low"),
        "0:00",
    )

    dup = sample()
    dup_rows, dup_issues = validate_text(csv_for([dup, dup]))
    check(any("duplicate" in issue.message for issue in dup_issues), dup_issues)
    check(len(dup_rows) == 1, dup_rows)

    impossible = sample(distance="2.00", duration="5:00", pace="2:30", continuous="5:00", benchmark="yes", rpe="9", energy="high")
    flagged, flagged_issues = validate_text(csv_for([impossible]))
    check(flagged_issues == [], flagged_issues)
    check(flagged and flagged[0].anomalies, flagged)
    check(any("impossible pace" in message for message in flagged[0].anomalies), flagged[0].anomalies)
    flagged_metrics = compute_metrics(flagged)
    check(flagged_metrics.best_two_mile is None, flagged_metrics)
    check(flagged_metrics.exercise_th == 0, flagged_metrics)

    fast_mile = sample(distance="1.00", duration="3:40", pace="3:40", continuous="3:40")
    fast_rows, fast_issues = validate_text(csv_for([fast_mile]))
    check(fast_issues == [], fast_issues)
    check(fast_rows[0].anomalies, fast_rows[0].anomalies)

    real = sample(date="2026-10-02", duration="15:30", pace="7:45", continuous="15:30", benchmark="yes", source="manual")
    mixed, mixed_issues = validate_text(csv_for([
        sample(source="mock", notes="MOCK sample"),
        real,
    ]))
    check(mixed_issues == [], mixed_issues)
    mixed_metrics = compute_metrics(authoritative_rows(mixed))
    check(mixed_metrics.best_two_mile == (15 * 60 + 30, "2026-10-02"), mixed_metrics)
    check(mixed_metrics.exercise_th == 2000, mixed_metrics)
    check(compute_metrics(mixed).exercise_th == 4000, "unfiltered mix would double-count")

    short = sample(date="2026-10-03", workout="Strides", distance="0.20", duration="1:12", pace="6:00", continuous="1:12", rpe="6", energy="high")
    steady = sample(date="2026-10-03", workout="Steady", distance="1.50", duration="12:15", pace="8:10", continuous="12:15", rpe="7", energy="high", week="5")
    # same date already used; week must match
    pace_rows, pace_issues = validate_text(csv_for([short, steady]))
    check(pace_issues == [], pace_issues)
    pace_metrics = compute_metrics(pace_rows)
    check(pace_metrics.best_pace is not None and pace_metrics.best_pace[0] == 8 * 60 + 10, pace_metrics)
    check(pace_metrics.best_pace[1] == 1500, pace_metrics)

    broken = sample(
        date="2026-10-04",
        workout="Broken 2-mile",
        distance="2.00",
        duration="18:30",
        pace="9:15",
        continuous="12:00",
        breaks="2",
        completed="partial",
        benchmark="yes",
        rpe="7",
    )
    valid_bench = sample(
        date="2026-10-05",
        week="6",
        workout="2-mile benchmark",
        distance="2.00",
        duration="16:52",
        pace="8:26",
        continuous="16:52",
        benchmark="yes",
        rpe="8",
        energy="high",
    )
    bench_rows, bench_issues = validate_text(csv_for([broken, valid_bench]))
    check(bench_issues == [], bench_issues)
    bench_metrics = compute_metrics(bench_rows)
    check(bench_metrics.valid_benchmarks == 1, bench_metrics)
    check(bench_metrics.best_two_mile == (16 * 60 + 52, "2026-10-05"), bench_metrics)
    check(len(bench_metrics.excluded_benchmarks) == 1, bench_metrics)
    check(bench_metrics.exercise_th == 4000, bench_metrics)

    def trend_of(items: list[str]) -> str:
        parsed, parsed_issues = validate_text(csv_for(items))
        check(parsed_issues == [], parsed_issues)
        return compute_metrics(parsed).trend

    def effort(date: str, week: str, pace_sec: int, continuous_sec: int, rpe: str, distance: str = "2.00") -> str:
        distance_th = parse_miles_thousandths(distance)
        assert distance_th is not None
        duration_sec = div_round_half_up(pace_sec * distance_th, 1000)
        return sample(
            date=date,
            week=week,
            distance=distance,
            duration=format_duration(duration_sec),
            pace=format_duration(pace_sec),
            continuous=format_duration(continuous_sec),
            rpe=rpe,
        )

    check(trend_of([effort("2026-10-01", "1", 600, 20 * 60, "4")]) == "insufficient data", "one row")
    check(
        trend_of([
            effort("2026-10-01", "1", 600, 20 * 60, "5"),
            effort("2026-10-02", "1", 600, 20 * 60, "5"),
            effort("2026-10-08", "2", 540, 18 * 60, "5"),
            effort("2026-10-09", "2", 540, 18 * 60, "5"),
        ]) == "improving pace",
        "pace",
    )
    check(
        trend_of([
            effort("2026-10-01", "1", 600, 20 * 60, "5"),
            effort("2026-10-02", "1", 600, 20 * 60, "5"),
            effort("2026-10-08", "2", 600, 25 * 60, "5", "2.50"),
            effort("2026-10-09", "2", 600, 25 * 60, "5", "2.50"),
        ]) == "improving endurance",
        "endurance",
    )
    check(
        trend_of([
            effort("2026-10-01", "1", 600, 20 * 60, "5"),
            effort("2026-10-02", "1", 600, 20 * 60, "5"),
            effort("2026-10-08", "2", 540, 22 * 60 + 30, "5", "2.50"),
            effort("2026-10-09", "2", 540, 22 * 60 + 30, "5", "2.50"),
        ]) == "normal progression",
        "both",
    )
    check(
        trend_of([
            effort("2026-10-01", "1", 600, 20 * 60, "5"),
            effort("2026-10-02", "1", 600, 20 * 60, "5"),
            effort("2026-10-08", "2", 600, 20 * 60, "5"),
            effort("2026-10-09", "2", 600, 20 * 60, "5"),
        ]) == "stalled",
        "flat",
    )
    check(
        trend_of([
            effort("2026-10-01", "1", 540, 27 * 60, "4", "3.00"),
            effort("2026-10-02", "1", 540, 27 * 60, "4", "3.00"),
            effort("2026-10-08", "2", 620, 20 * 60 + 40, "8"),
            effort("2026-10-09", "2", 620, 20 * 60 + 40, "8"),
        ]) == "high fatigue",
        "fatigue",
    )

    check(compared_pace("Treadmill", 600, incline=0) == 624, "treadmill 0%")
    check(compared_pace("Treadmill", 600, incline=1) == 600, "treadmill 1%")
    check(compared_pace("Running at the Beach", 500, dew=70) == 550, "dew 70")
    check(compared_pace("Running at the Beach", 500) is None, "no weather")
    hot, hot_issues = validate_text(csv_for([sample() + ",130"]))
    check(hot == [] and any("outside" in issue.message for issue in hot_issues), hot_issues)

    html = (ROOT / "index.html").read_text(encoding="utf-8")
    ui_path = ROOT / "ui.js"
    ui = ui_path.read_text(encoding="utf-8") if ui_path.is_file() else ""
    check(HEADER_STRING in html or HEADER_STRING in ui, "dashboard header missing")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    for phrase in (
        "data/running_data.csv",
        "## Add a row",
        *ACTIVITY_TYPES,
        *DATA_SOURCES,
        "15:00",
    ):
        check(phrase in readme, f"README missing {phrase}")

    js = (ROOT / "app.js").read_text(encoding="utf-8")
    for name, value in (
        ("GOAL_SEC", GOAL_SEC),
        ("IMPOSSIBLE_PACE_SEC", IMPOSSIBLE_PACE_SEC),
        ("MILE_WR_PACE_SEC", MILE_WR_PACE_SEC),
        ("MIN_COMPARABLE_MI_TH", MIN_COMPARABLE_MI_TH),
        ("MAX_COMPARABLE_MI_TH", MAX_COMPARABLE_MI_TH),
        ("BENCH_MIN_TH", BENCH_MIN_TH),
        ("BENCH_MAX_TH", BENCH_MAX_TH),
        ("MAX_DISTANCE_TH", MAX_DISTANCE_TH),
        ("MAX_DURATION_SEC", MAX_DURATION_SEC),
    ):
        match = re.search(rf"const {name} = (\d+);", js)
        check(match is not None and int(match.group(1)) == value, f"{name} drifted in app.js")
    for label, values in (("EXERCISE_TYPES", EXERCISE_TYPES), ("WALKING_TYPES", WALKING_TYPES)):
        match = re.search(rf"const {label} = (\[.*?\]);", js)
        check(match is not None, label)
        check(match.group(1) == "[" + ", ".join(f'"{item}"' for item in values) + "]", match.group(1) if match else label)


def main(argv: list[str]) -> int:
    if "--help" in argv or "-h" in argv:
        print(__doc__)
        return 0
    if "--self-test" in argv:
        self_test()
        print("self-test passed")
        return 0
    path = DEFAULT_DATA
    for arg in argv[1:]:
        if not arg.startswith("-"):
            path = Path(arg)
    report, code = analyze_path(path)
    sys.stdout.write(report)
    custom = any(not arg.startswith("-") for arg in argv[1:])
    if not custom:
        from health_data import validate_repo

        extra, extra_code = validate_repo(ROOT)
        sys.stdout.write("\n" + extra)
        if extra_code:
            code = extra_code
    return code


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except AssertionError as exc:
        print(f"self-test failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
