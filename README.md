# My Health OS

Your runs, heart rate, body, sleep, nutrition, recovery, and coach notes stay on your device. This repo holds the app, the public page, and clearly fake demo data. Nothing personal is committed.

The page stores a real log in this browser (`localStorage`). It does not upload it. There is no account, no analytics, no third-party script, and no call that sends your rows anywhere. Charts are drawn on the page. Demo mode reads the public mock files from this same site. That is the only fetch, and it never includes your log.

Clearing browser data deletes the log. Export a JSON or CSV backup first. Files named `*.local.csv`, `*.local.json`, `export.xml`, `export.zip`, and Apple Health zips are gitignored so a backup is not committed by accident.

While the browser has no real log, demo mode is on and the page shows the fake sample. The first saved row, or a pasted coach note, turns demo mode off. Demo rows and your rows are never on screen together. You can turn the demo off yourself before you enter anything. You cannot turn it back on after a real log exists.

Goal: a 2-mile run in **15:00 or faster** (7:30 per mile), trained in San Juan, Puerto Rico.

## Add a row

Use the **Log** screen on the site. Each activity is its own row, including the walk to the track, the workout, and the walk back. The form checks the line as you type, with the same rules as `scripts/validate_running_data.py`.

A day can hold several rows. Rest days do not need one. Saturday at La Pista is usually three rows: `Walking to a Place` / `TO TRACK`, `Exercise at La Pista`, and `Walking to a Place` / `FROM TRACK`. Those walks are not running mileage.

`Treadmill` is an exercise type. It counts toward exercise miles. It is not a track benchmark and it does not set best pace. Leave incline blank and the page treats it as 0%.

The columns, in order, are the schema of `data/running_data.csv`. The file in the repo is the demo. Do not add a personal row to it.

| Column | Required | Allowed values |
| --- | --- | --- |
| `date` | yes | `YYYY-MM-DD` |
| `week` | yes | Program week as a whole number: `1`, `2`, `3`… |
| `activity_type` | yes | `Walking to a Place`, `Exercise at La Pista`, `Running at the Beach`, `Recovery Walk`, `Treadmill` |
| `workout` | yes | Short name, such as `TO TRACK`, `FROM TRACK`, `Easy aerobic`, `2-mile benchmark` |
| `distance_mi` | yes | Miles, `0` or more, up to 3 decimal places |
| `duration` | yes | `M:SS` or `H:MM:SS`. Total time, including walk breaks inside it. |
| `pace_per_mi` | when distance is greater than 0 | `M:SS`. Must equal duration ÷ distance, rounded to the nearest second. Blank when distance is 0. |
| `continuous_running_time` | yes | Longest uninterrupted running segment. `0:00` on every walk. |
| `walk_breaks` | yes | Whole number, `0` or more |
| `rpe` | when completed is `yes` or `partial` | Whole number `1` through `10` |
| `energy` | when completed is `yes` or `partial` | `low`, `moderate`, `high` |
| `completed` | yes | `yes`, `partial`, `no` |
| `notes` | no | Free text |
| `is_benchmark` | yes | `yes` or `no`. Use `yes` only for a continuous completed 2-mile test on the track or beach. |
| `data_source` | yes | `apple_watch`, `apple_health_import`, `manual`, `estimate`, `mock` |
| `avg_hr` | no | Heart rate, 30–230 |
| `max_hr` | no | Heart rate, 30–230, and not below `avg_hr` |
| `avg_cadence` | no | Steps per minute, 50–250 |
| `active_calories` | no | 0–5000 |
| `stride_length_m` | no | Meters, 0.300–3.000 |
| `ground_contact_time_ms` | no | Milliseconds, 50–500 |
| `temp_f` | no | 20–120. Degrees Fahrenheit. |
| `humidity_pct` | no | 0–100 |
| `dew_point_f` | no | 0–100. Used for the heat estimate when you have it. |
| `incline_pct` | no | 0–15. Treadmill grade. |

The form always saves `data_source=manual`. An `apple_health_import` row may leave `rpe` and `energy` blank. Every other source still needs both when `completed` is `yes` or `partial`.

This is a format example, not a logged workout:

```csv
2026-10-06,5,Running at the Beach,Easy aerobic,3.00,27:00,9:00,27:00,0,4,moderate,yes,Easy day,no,manual,,,,,,
```

Pace is total duration divided by distance, rounded to the nearest second. For that example, 27:00 ÷ 3.00 mi = 9:00.

Heat and treadmill math never overwrite that pace. The page shows an estimate under it.

- Treadmill, 0% incline: outdoor pace is 4% slower (`pace × 1.04`). At 1% incline the factor is 1, the rule of thumb that a 1% grade is about level outdoor running. The label is `outdoor est.`
- Heat: use `dew_point_f` when it is filled. Otherwise, if temp and humidity are both filled, dew point comes from the Magnus formula. At a dew point of 50°F or higher, add 0.5% per °F above 50, capped at 15%. The label is `heat est.`
- The factors multiply, then the result is rounded half up once.

## Import and export

On **Log**:

- Import a CSV whose header matches one stream, a JSON backup, or Apple Health `export.xml`. Unzip the Health export on the phone or computer and choose `export.xml`. Parsing happens in the browser.
- Download a JSON backup of the local log, or the running rows as CSV.

Imported running workouts become `Running at the Beach`. Change the type if the session was at La Pista. Imported walks become `Walking to a Place`, so they cannot inflate exercise miles. A manual, estimate, or Apple Watch row is never overwritten. The calendar date is the first 10 characters of Apple's timestamp. The script `scripts/import_apple_health.py` is the same rules for a local check. Do not commit its output.

## What the page shows

The site title is **My Health OS**. The training screen keeps the program heading **RUNNING — 2-MILE SPEED · ENDURANCE · WEEKLY PROGRESS**.

Screens: Today, Log, Body, Nutrition, Sleep, Activity, Training, Recovery, Trends, Goals, and Coach.

- **Best 2-mile** — valid benchmarks only. A treadmill row is left off.
- **Goal** — 15:00.
- **Best pace** — fastest pace on a completed exercise of 1.00–4.00 miles, excluding `Treadmill`.
- **Exercise miles** — `Exercise at La Pista`, `Running at the Beach`, and `Treadmill`.
- **Walking miles** — `Walking to a Place` and `Recovery Walk`, kept separate.
- **Longest run** — the longest continuous running segment.
- **2-mile chart** — valid benchmarks only, with a 15:00 line.
- **Recent activities** — raw pace, with the heat or treadmill estimate underneath when one applies.

A valid 2-mile benchmark is an exercise row other than `Treadmill`, with `is_benchmark=yes`, `completed=yes`, distance from 1.95 to 2.05 miles, no walk breaks, and continuous time within 2 seconds of the total duration.

`completed=partial` counts the distance that was done. `completed=no` counts as nothing.

## Checks

CI checks the app and the fake demo files. It does not see your browser log.

```bash
python3 scripts/validate_running_data.py
python3 scripts/validate_running_data.py --self-test
python3 scripts/health_data.py --self-test
python3 scripts/import_apple_health.py --self-test
python3 scripts/build_coach_context.py --self-test
node tests/dashboard_rules.test.mjs
node tests/health_os.test.mjs
node tests/store.test.mjs
```

The running check rejects missing fields, unknown activity types, a pace that does not match duration ÷ distance, duplicates, two week numbers on one date, a walk with running time, a walk marked as a benchmark, and weather or incline outside the ranges above. Impossible values fail the check and are excluded from records: 2:30 per mile or faster, faster than 3:43 per mile over 1 mile or more, more than 50 miles, or longer than 8 hours.

On a clean demo file the real-row trend is `insufficient data`, because every demo row is `mock`. The labeled preview can still say `normal progression`.

## Dashboard

From the repo root:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. Opening `index.html` as a file will not load the demo CSVs.

The public page is:

https://ry2vlea.github.io/running-2mile-tracker/

GitHub Pages publishes with Actions (`.github/workflows/pages.yml`) on every push to `main`. The workflow copies the page, the scripts, and `data/`. It does not deploy a server.

## Scoring

Day Score is the unrounded mean of the subscores that exist, then rounded half up (`floor(x + 0.5)`). Fewer than four subscores still produce a score, and the card says it is partial. The win is the highest subscore. The watch item is the lowest. Ties break in this order: Movement, Training, Nutrition, Hydration, Recovery, Sleep. The first one in that list wins the tie.

- **Movement.** `min(100, round(steps / 8000 × 100))`. No steps, and the subscore is omitted.
- **Training.** A plan whose session matches rest, recovery, or walk scores 100. A planned run scores 100 when an exercise row that day is completed, 70 when the only exercise row is partial, and 30 when nothing was logged. With no plan, a day with at least 1 exercise mile scores 80. Anything else is omitted.
- **Nutrition.** Protein points are `min(100, protein / 130 × 100)`. Calories inside 2000–2800 score 100. Outside that band, lose 2 points per 50 kcal past the nearer edge, down to 0. The subscore is `round(0.6 × protein points + 0.4 × calorie points)`. If only one of the two was logged, that one is the score. A daily row is the total. Food rows are not added to it.
- **Hydration.** `min(100, round(ml / 2500 × 100))`.
- **Recovery.** A logged readiness from 0 to 100 is the score. If readiness is blank, start at 100, subtract 8 for each soreness point above 1, subtract 8 for each fatigue point above 1, and subtract 15 when HRV is under 90% of the prior 14 days. Clamp to 0–100. If none of those were logged, omit the subscore.
- **Sleep.** 7.5 to 9 hours scores 100. Under 7.5 hours scores `round(hours / 7.5 × 100)`. Over 9 hours scores `max(70, round(100 − (hours − 9) × 15))`.

The readiness bar on Today is the logged readiness when that cell is filled. Otherwise it uses the recovery subscore. Sleep debt is the 7-day sum of `max(0, 7.5 hours − time asleep)`. It is computed, not stored.

On the included sample, 2026-10-03 scores Movement 80, Training 30, Nutrition 100, Hydration 80, Recovery 58, Sleep 81. The day score is 72. Nutrition is the win. Training is the watch item.

The page does not infer cause across streams. Trends compares the last 7 days with the 7 days before that inside one stream. A window with fewer than 3 points says insufficient data.

The 2-mile prediction is a straight line through the valid benchmarks. It is labeled as an estimate. It is not a race prediction. Two benchmarks are required.

## Projects

`data/projects.json` is a goal template, not a private measurement. SUB-15 starts at 17:40 and aims at 15:00. Progress uses the best valid 2-mile in the log you are viewing.

- Sleep average at least 7:30 over 7 days
- Protein average at least 130 g over 7 days
- Exercise miles between 8 and 12 over 7 days
- Readiness average at least 70 over 7 days
- Plan hit rate at least 85% over 14 days, ending yesterday

A rest, recovery, or walk session counts as a hit without a run. A run session counts when that day has a completed or partial exercise row. BODY, SLEEP RESET, and 30-DAY CONSISTENCY are placeholders.

## AI coach

The coach card is filled on this device. **Copy my summary** copies a short text of recent numbers so you can paste it into your own assistant. **Paste coach update** accepts JSON (`generated_at`, `key_numbers`, `today_action`, optional `note`) or plain text (first line is today's action, the rest are key numbers) and saves it in the browser. Saving a note turns demo mode off.

The card says AI-generated and shows the timestamp. A note older than 2 days gets a stale badge. Exactly 48 hours is still fresh. The page does not call an assistant and does not store an API key.

`scripts/build_coach_context.py` prints a summary of the public demo files for the checks above. It is not a place to commit a personal analysis.
