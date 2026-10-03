"""Append an Apple Health export to the health CSVs.

Usage:
    python3 scripts/import_apple_health.py path/to/export.zip
    python3 scripts/import_apple_health.py path/to/export.xml
    python3 scripts/import_apple_health.py --self-test

The export is the zip from the iPhone Health app (or the export.xml inside it).
Rows are written with data_source=apple_health_import. Manual, estimate, and
apple_watch rows are never changed. An existing import row for the same day is
replaced. Mock rows stay in the file; the site hides them once a real row exists.

Walking workouts are stored as "Walking to a Place" so they cannot inflate
exercise miles. Running workouts are stored as "Running at the Beach". If a
session was actually at La Pista, change the activity type in the app.
Do not commit the written CSVs. The public site imports export.xml in the browser.
The program week is the ISO week; edit it if your training week differs.
RPE and energy are left blank because the export does not include them.
"""

from __future__ import annotations

import sys
import tempfile
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import health_data
import validate_running_data as running

KM_PER_MILE = 1.609344
KJ_PER_KCAL = 4.184
LB_PER_KG = 0.45359237


def calendar_day(text: str) -> str:
    return text.strip()[:10]


def parse_stamp(text: str) -> datetime:
    return datetime.strptime(text.strip(), "%Y-%m-%d %H:%M:%S %z")


def seconds_between(start: str, end: str) -> int:
    return int((parse_stamp(end) - parse_stamp(start)).total_seconds())


def to_miles(value: float, unit: str) -> float:
    unit = unit.lower()
    if unit in ("mi", "mile", "miles"):
        return value
    if unit in ("km", "kilometer", "kilometers"):
        return value / KM_PER_MILE
    raise ValueError(f"unsupported distance unit {unit}")


def to_kcal(value: float, unit: str) -> float:
    unit = unit.lower()
    if unit in ("kcal", "cal"):
        return value
    if unit in ("kj",):
        return value / KJ_PER_KCAL
    raise ValueError(f"unsupported energy unit {unit}")


def to_kg(value: float, unit: str) -> float:
    unit = unit.lower()
    if unit in ("kg",):
        return value
    if unit in ("lb", "lbs"):
        return value * LB_PER_KG
    raise ValueError(f"unsupported mass unit {unit}")


def round_miles(miles: float) -> str:
    cents = running.div_round_half_up(int(round(miles * 1000)), 10)
    return f"{cents / 100:.2f}"


def format_hms(seconds: int) -> str:
    seconds = max(0, int(seconds))
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def open_xml(path: Path):
    if path.suffix.lower() == ".zip":
        archive = zipfile.ZipFile(path)
        name = next((item for item in archive.namelist() if item.endswith("export.xml")), None)
        if name is None:
            raise SystemExit(f"no export.xml inside {path}")
        return archive.open(name)
    return path.open("rb")


def empty_bucket():
    return {
        "steps": 0.0,
        "miles": 0.0,
        "active": 0.0,
        "basal": 0.0,
        "rhr": [],
        "hrv": [],
        "mass": [],
        "sleep": defaultdict(float),
        "in_bed": 0.0,
    }


SLEEP_KEYS = {
    "HKCategoryValueSleepAnalysisAsleep": "asleep",
    "HKCategoryValueSleepAnalysisAsleepUnspecified": "asleep",
    "HKCategoryValueSleepAnalysisAsleepCore": "core",
    "HKCategoryValueSleepAnalysisAsleepDeep": "deep",
    "HKCategoryValueSleepAnalysisAsleepREM": "rem",
    "HKCategoryValueSleepAnalysisAwake": "awake",
    "HKCategoryValueSleepAnalysisInBed": "in_bed",
}


def parse_export(path: Path) -> tuple[dict, list[dict]]:
    days = defaultdict(empty_bucket)
    workouts = []
    with open_xml(path) as handle:
        for _event, element in ElementTree.iterparse(handle):
            if element.tag == "Record":
                kind = element.attrib.get("type", "")
                start = element.attrib.get("startDate", "")
                end = element.attrib.get("endDate", start)
                if not start:
                    element.clear()
                    continue
                day = calendar_day(start)
                if kind == "HKQuantityTypeIdentifierStepCount":
                    days[day]["steps"] += float(element.attrib.get("value", "0"))
                elif kind == "HKQuantityTypeIdentifierDistanceWalkingRunning":
                    days[day]["miles"] += to_miles(float(element.attrib.get("value", "0")), element.attrib.get("unit", "mi"))
                elif kind == "HKQuantityTypeIdentifierActiveEnergyBurned":
                    days[day]["active"] += to_kcal(float(element.attrib.get("value", "0")), element.attrib.get("unit", "kcal"))
                elif kind == "HKQuantityTypeIdentifierBasalEnergyBurned":
                    days[day]["basal"] += to_kcal(float(element.attrib.get("value", "0")), element.attrib.get("unit", "kcal"))
                elif kind == "HKQuantityTypeIdentifierRestingHeartRate":
                    days[day]["rhr"].append(float(element.attrib.get("value", "0")))
                elif kind == "HKQuantityTypeIdentifierHeartRateVariabilitySDNN":
                    days[day]["hrv"].append(float(element.attrib.get("value", "0")))
                elif kind == "HKQuantityTypeIdentifierBodyMass":
                    days[day]["mass"].append((start, to_kg(float(element.attrib.get("value", "0")), element.attrib.get("unit", "kg"))))
                elif kind == "HKCategoryTypeIdentifierSleepAnalysis":
                    wake = calendar_day(end)
                    key = SLEEP_KEYS.get(element.attrib.get("value", ""))
                    if key:
                        span = max(0, seconds_between(start, end))
                        if key == "in_bed":
                            days[wake]["in_bed"] += span
                        else:
                            days[wake]["sleep"][key] += span
            elif element.tag == "Workout":
                activity = element.attrib.get("workoutActivityType", "")
                start = element.attrib.get("startDate", "")
                end = element.attrib.get("endDate", start)
                if activity in ("HKWorkoutActivityTypeRunning", "HKWorkoutActivityTypeWalking") and start:
                    unit = element.attrib.get("totalDistanceUnit") or "mi"
                    distance = element.attrib.get("totalDistance")
                    if element.attrib.get("duration"):
                        duration_unit = element.attrib.get("durationUnit", "min")
                        raw = float(element.attrib["duration"])
                        duration = int(round(raw * 60 if duration_unit.startswith("min") else raw))
                    else:
                        duration = seconds_between(start, end)
                    miles = to_miles(float(distance), unit) if distance else 0
                    workouts.append({
                        "date": calendar_day(start),
                        "kind": activity,
                        "miles": miles,
                        "duration": duration,
                    })
            element.clear()
    return days, workouts


def round_int(value: float) -> str:
    return str(running.div_round_half_up(int(round(value * 1000)), 1000))


def upsert(rows: list[dict], columns: tuple[str, ...], key: tuple, new_row: dict, protected: set[str]) -> list[dict]:
    """Replace an apple_health_import row with the same key. Never edit protected sources."""
    kept = []
    replaced = False
    for row in rows:
        source = row.get("data_source", "").lower()
        row_key = tuple(row.get(part, "") for part in key[0])
        if source == "apple_health_import" and row_key == key[1]:
            if not replaced:
                kept.append({column: new_row.get(column, "") for column in columns})
                replaced = True
            continue
        kept.append(row)
    if not replaced:
        kept.append({column: new_row.get(column, "") for column in columns})
    return kept


def apply_export(data_dir: Path, export_path: Path) -> None:
    days, workouts = parse_export(export_path)
    activity_path = data_dir / "activity.csv"
    recovery_path = data_dir / "recovery.csv"
    body_path = data_dir / "body.csv"
    sleep_path = data_dir / "sleep.csv"
    running_path = data_dir / "running_data.csv"

    activity_rows = health_data.read_csv(activity_path)
    recovery_rows = health_data.read_csv(recovery_path)
    body_rows = health_data.read_csv(body_path)
    sleep_rows = health_data.read_csv(sleep_path)
    running_rows = health_data.read_csv(running_path) if running_path.is_file() else []

    for iso, bucket in sorted(days.items()):
        if bucket["steps"] or bucket["miles"] or bucket["active"] or bucket["basal"]:
            active_kcal = running.div_round_half_up(int(round(bucket["active"] * 1000)), 1000) if bucket["active"] else 0
            basal_kcal = running.div_round_half_up(int(round(bucket["basal"] * 1000)), 1000) if bucket["basal"] else 0
            activity_rows = upsert(
                activity_rows,
                health_data.ACTIVITY_COLUMNS,
                (("date",), (iso,)),
                {
                    "date": iso,
                    "steps": round_int(bucket["steps"]) if bucket["steps"] else "",
                    "distance_mi": round_miles(bucket["miles"]) if bucket["miles"] else "",
                    "active_kcal": str(active_kcal) if bucket["active"] else "",
                    "basal_kcal": str(basal_kcal) if bucket["basal"] else "",
                    "total_kcal": str(active_kcal + basal_kcal) if (bucket["active"] or bucket["basal"]) else "",
                    "data_source": "apple_health_import",
                    "notes": "Imported from Apple Health.",
                },
                {"manual", "estimate", "apple_watch"},
            )
        if bucket["rhr"] or bucket["hrv"]:
            recovery_rows = upsert(
                recovery_rows,
                health_data.RECOVERY_COLUMNS,
                (("date",), (iso,)),
                {
                    "date": iso,
                    "hrv_ms": round_int(sum(bucket["hrv"]) / len(bucket["hrv"])) if bucket["hrv"] else "",
                    "resting_hr": round_int(sum(bucket["rhr"]) / len(bucket["rhr"])) if bucket["rhr"] else "",
                    "soreness": "",
                    "fatigue": "",
                    "readiness": "",
                    "data_source": "apple_health_import",
                    "notes": "Imported from Apple Health. Daily mean.",
                },
                {"manual", "estimate", "apple_watch"},
            )
        if bucket["mass"]:
            _stamp, kg = sorted(bucket["mass"])[-1]
            shown = running.div_round_half_up(int(round(kg * 1000)), 10) / 100
            body_rows = upsert(
                body_rows,
                health_data.BODY_COLUMNS,
                (("date",), (iso,)),
                {
                    "date": iso,
                    "height_cm": "",
                    "weight_kg": f"{shown:.2f}",
                    "bmi": "",
                    "body_fat_pct": "",
                    "waist_cm": "",
                    "chest_cm": "",
                    "hips_cm": "",
                    "data_source": "apple_health_import",
                    "notes": "Imported from Apple Health. Last weight of the day.",
                },
                {"manual", "estimate", "apple_watch"},
            )
        stages = bucket["sleep"]
        asleep = stages.get("core", 0) + stages.get("deep", 0) + stages.get("rem", 0) + stages.get("asleep", 0)
        if asleep or stages.get("awake") or bucket["in_bed"]:
            sleep_rows = upsert(
                sleep_rows,
                health_data.SLEEP_COLUMNS,
                (("date",), (iso,)),
                {
                    "date": iso,
                    "duration": format_hms(int(round(asleep))),
                    "bedtime": "",
                    "wake": "",
                    "rem": format_hms(int(round(stages.get("rem", 0)))),
                    "deep": format_hms(int(round(stages.get("deep", 0)))),
                    "core": format_hms(int(round(stages.get("core", 0) + stages.get("asleep", 0)))),
                    "awake": format_hms(int(round(stages.get("awake", 0)))),
                    "in_bed": format_hms(int(round(bucket["in_bed"]))) if bucket["in_bed"] else "",
                    "data_source": "apple_health_import",
                    "notes": "Imported from Apple Health. Aggregated by wake date.",
                },
                {"manual", "estimate", "apple_watch"},
            )

    for workout in workouts:
        if workout["kind"] == "HKWorkoutActivityTypeRunning":
            activity_type = "Running at the Beach"
            continuous = running.format_duration(workout["duration"])
            note = "Imported from Apple Health. Recategorize to Exercise at La Pista if this was the track."
        else:
            activity_type = "Walking to a Place"
            continuous = "0:00"
            note = "Imported from Apple Health. Transport walk, not exercise mileage."
        same_day = [
            row for row in running_rows
            if row.get("date") == workout["date"] and row.get("activity_type") == activity_type
        ]
        if any(row.get("data_source", "").lower() in ("manual", "estimate", "apple_watch") for row in same_day):
            continue
        distance = round_miles(workout["miles"]) if workout["miles"] else "0"
        thousandths = running.parse_miles_thousandths(distance) or 0
        pace = ""
        if thousandths > 0 and workout["duration"] > 0:
            pace = running.format_duration(running.expected_pace(workout["duration"], thousandths))
        iso_week = str(datetime.fromisoformat(workout["date"]).isocalendar().week)
        new_row = {
            "date": workout["date"],
            "week": iso_week,
            "activity_type": activity_type,
            "workout": "Apple Health import",
            "distance_mi": distance,
            "duration": running.format_duration(workout["duration"]),
            "pace_per_mi": pace,
            "continuous_running_time": continuous if activity_type != "Walking to a Place" else "0:00",
            "walk_breaks": "0",
            "rpe": "",
            "energy": "",
            "completed": "yes",
            "notes": note,
            "is_benchmark": "no",
            "data_source": "apple_health_import",
            "avg_hr": "",
            "max_hr": "",
            "avg_cadence": "",
            "active_calories": "",
            "stride_length_m": "",
            "ground_contact_time_ms": "",
        }
        match = None
        for row in running_rows:
            if (
                row.get("data_source") == "apple_health_import"
                and row.get("date") == workout["date"]
                and row.get("activity_type") == activity_type
                and row.get("distance_mi") == distance
                and row.get("duration") == new_row["duration"]
            ):
                match = row
                break
        if match:
            match.update(new_row)
        else:
            running_rows.append(new_row)

    if activity_rows:
        health_data.write_csv(activity_path, health_data.ACTIVITY_COLUMNS, activity_rows)
    if recovery_rows:
        health_data.write_csv(recovery_path, health_data.RECOVERY_COLUMNS, recovery_rows)
    if body_rows:
        health_data.write_csv(body_path, health_data.BODY_COLUMNS, body_rows)
    if sleep_rows:
        health_data.write_csv(sleep_path, health_data.SLEEP_COLUMNS, sleep_rows)
    if running_rows:
        health_data.write_csv(running_path, running.COLUMNS, running_rows)


SAMPLE_XML = """<?xml version="1.0" encoding="UTF-8"?>
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
  <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAwake" startDate="2026-10-01 05:30:00 -0400" endDate="2026-10-01 05:40:00 -0400"/>
  <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisInBed" startDate="2026-09-30 22:50:00 -0400" endDate="2026-10-01 05:40:00 -0400"/>
  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" totalDistance="5" totalDistanceUnit="km" startDate="2026-10-01 07:00:00 -0400" endDate="2026-10-01 07:30:00 -0400"/>
  <Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="20" durationUnit="min" totalDistance="1" totalDistanceUnit="mi" startDate="2026-10-01 18:00:00 -0400" endDate="2026-10-01 18:20:00 -0400"/>
  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="20" durationUnit="min" totalDistance="2" totalDistanceUnit="mi" startDate="2026-10-02 07:00:00 -0400" endDate="2026-10-02 07:20:00 -0400"/>
</HealthData>
"""


def self_test() -> None:
    def check(condition: bool, message: str) -> None:
        if not condition:
            raise AssertionError(message)

    with tempfile.TemporaryDirectory() as tmp:
        data = Path(tmp)
        health_data.write_csv(data / "activity.csv", health_data.ACTIVITY_COLUMNS, [
            {"date": "2026-10-01", "steps": "1111", "distance_mi": "1.00", "active_kcal": "100", "basal_kcal": "100", "total_kcal": "200", "data_source": "manual", "notes": "keep me"},
            {"date": "2026-10-01", "steps": "1", "distance_mi": "0.10", "active_kcal": "1", "basal_kcal": "1", "total_kcal": "2", "data_source": "apple_health_import", "notes": "old import"},
        ])
        health_data.write_csv(data / "running_data.csv", running.COLUMNS, [
            {
                "date": "2026-10-02", "week": "5", "activity_type": "Running at the Beach", "workout": "Easy",
                "distance_mi": "2.00", "duration": "18:00", "pace_per_mi": "9:00", "continuous_running_time": "18:00",
                "walk_breaks": "0", "rpe": "4", "energy": "moderate", "completed": "yes", "notes": "keep",
                "is_benchmark": "no", "data_source": "manual",
            }
        ])
        for filename, columns in (
            ("recovery.csv", health_data.RECOVERY_COLUMNS),
            ("body.csv", health_data.BODY_COLUMNS),
            ("sleep.csv", health_data.SLEEP_COLUMNS),
        ):
            health_data.write_csv(data / filename, columns, [])
        xml_path = data / "export.xml"
        xml_path.write_text(SAMPLE_XML, encoding="utf-8")
        apply_export(data, xml_path)
        apply_export(data, xml_path)

        activity = health_data.read_csv(data / "activity.csv")
        manual = [row for row in activity if row["data_source"] == "manual"]
        imported = [row for row in activity if row["data_source"] == "apple_health_import" and row["date"] == "2026-10-01"]
        check(len(manual) == 1 and manual[0]["steps"] == "1111" and manual[0]["notes"] == "keep me", manual)
        check(len(imported) == 1 and imported[0]["steps"] == "1500", imported)
        check(imported[0]["active_kcal"] == "300" and imported[0]["basal_kcal"] == "100", imported[0])

        body = health_data.read_csv(data / "body.csv")
        check(body and body[0]["weight_kg"] == "81.65", body)

        recovery = health_data.read_csv(data / "recovery.csv")
        check(recovery and recovery[0]["resting_hr"] == "59" and recovery[0]["hrv_ms"] == "45", recovery)

        sleep = health_data.read_csv(data / "sleep.csv")
        check(sleep and sleep[0]["date"] == "2026-10-01" and sleep[0]["duration"] == "6:30:00", sleep)
        check(sleep[0]["core"] == "4:00:00" and sleep[0]["deep"] == "1:00:00" and sleep[0]["rem"] == "1:30:00", sleep[0])

        runs = health_data.read_csv(data / "running_data.csv")
        manual_run = [row for row in runs if row["data_source"] == "manual"]
        check(len(manual_run) == 1 and manual_run[0]["notes"] == "keep", manual_run)
        imported_runs = [row for row in runs if row["data_source"] == "apple_health_import"]
        check(len(imported_runs) == 2, imported_runs)
        beach = next(row for row in imported_runs if row["activity_type"] == "Running at the Beach")
        check(beach["date"] == "2026-10-01" and beach["distance_mi"] == "3.11", beach)
        check(beach["pace_per_mi"] == "9:39", beach)
        parsed, issues = running.validate_text(
            "date,week,activity_type,workout,distance_mi,duration,pace_per_mi,continuous_running_time,walk_breaks,rpe,energy,completed,notes,is_benchmark,data_source,avg_hr,max_hr,avg_cadence,active_calories,stride_length_m,ground_contact_time_ms,temp_f,humidity_pct,dew_point_f,incline_pct\n"
            + ",".join([
                beach["date"], beach["week"], beach["activity_type"], beach["workout"], beach["distance_mi"],
                beach["duration"], beach["pace_per_mi"], beach["continuous_running_time"], beach["walk_breaks"],
                "", "", "yes", '"Imported from Apple Health. Recategorize to Exercise at La Pista if this was the track."',
                "no", "apple_health_import", "", "", "", "", "", "",
            ])
        )
        check(issues == [], issues)
        check(len(parsed) == 1, parsed)
        walk = next(row for row in imported_runs if row["activity_type"] == "Walking to a Place")
        check(walk["continuous_running_time"] == "0:00", walk)
        check(not any(row["date"] == "2026-10-02" and row["data_source"] == "apple_health_import" for row in runs), runs)


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        self_test()
        print("import self-test passed")
        return 0
    sources = [arg for arg in argv[1:] if not arg.startswith("-")]
    if len(sources) != 1:
        print(__doc__)
        return 2
    apply_export(ROOT / "data", Path(sources[0]))
    print(f"Imported {sources[0]} into data/. Do not commit those rows. The site import keeps them in the browser.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except AssertionError as exc:
        print(f"import self-test failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
