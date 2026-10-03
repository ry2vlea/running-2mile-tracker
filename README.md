# Running — 2-mile tracker

Goal: a 2-mile run in **15:00 or faster** (7:30 per mile), trained in San Juan, Puerto Rico.

The log is a CSV you can edit by hand. The dashboard is a static page that reads that file. There is no server and no build step.

While the file contains only `data_source=mock` rows, the page draws those rows and labels them as mock data. The first real row (`apple_watch`, `manual`, or `estimate`) takes over. Mock rows stay in the file and drop out of every KPI and chart.

## Add a row

1. Open `data/running_data.csv`.
2. Add **one new line at the bottom**. Leave older rows as they are. A day with several activities gets several rows.
3. Keep the header and the column order. Leave Apple Watch cells blank when you do not have them.
4. If a note contains a comma, wrap that cell in double quotes.
5. Check the line:

```bash
python3 scripts/validate_running_data.py
```

6. Commit the CSV. GitHub Actions runs the same check on every push.

Rest days do not need a row. Saturday at La Pista is usually three rows: a transport walk there, the track session, and a transport walk back. Those walks are not running mileage.

Dates must stay `YYYY-MM-DD`. If a spreadsheet rewrites them as `9/5/2026`, change them back before committing.

This is a format example, not a logged workout:

```csv
2026-10-06,5,Running at the Beach,Easy aerobic,3.00,27:00,9:00,27:00,0,4,moderate,yes,Easy day,no,manual,,,,,,
```

Pace is total duration divided by distance, rounded to the nearest second. For that example, 27:00 ÷ 3.00 mi = 9:00. If your pace is off, the script prints the value to use.

## What the page shows

Header: **RUNNING — 2-MILE SPEED · ENDURANCE · WEEKLY PROGRESS**.

- **Best 2-mile** — valid benchmarks only.
- **Goal** — 15:00.
- **Best pace** — fastest pace on a completed exercise of 1.00–4.00 miles. Shorter pieces, including strides, are ignored.
- **Exercise miles** — `Exercise at La Pista` and `Running at the Beach` only.
- **Walking miles** — `Walking to a Place` and `Recovery Walk`, kept separate.
- **Longest run** — the longest continuous running segment, not the total time on the clock.
- **2-mile chart** — valid benchmarks only, with a 15:00 line. Lower on the chart is faster.
- **Endurance chart** — longest continuous run each week, walk breaks, and structured miles.
- **Weekly miles** — exercise against walking.
- **Recent activities** — date, week, distance, time, pace/mi, type, notes. On the same day, exercise is listed before transport walks.

A valid 2-mile benchmark is an exercise row with `is_benchmark=yes`, `completed=yes`, distance from 1.95 to 2.05 miles, no walk breaks, and continuous time within 2 seconds of the total duration. Anything else can stay in the file and still count as training mileage, but it is left off that chart.

Walk breaks inside a track session stay on that exercise row. They are not also logged as walking miles.

`completed=partial` counts the distance that was done. `completed=no` counts as nothing. `data_source=estimate` counts, and the table marks it as an estimate.

## Schema

File: `data/running_data.csv`. Lines starting with `#` are comments. One row per activity.

| Column | Required | Allowed values |
| --- | --- | --- |
| `date` | yes | `YYYY-MM-DD` |
| `week` | yes | Program week as a whole number: `1`, `2`, `3`… Use the same week on every row from that training week. |
| `activity_type` | yes | `Walking to a Place`, `Exercise at La Pista`, `Running at the Beach`, `Recovery Walk` |
| `workout` | yes | Short name, such as `TO TRACK`, `FROM TRACK`, `Easy aerobic`, `2-mile benchmark` |
| `distance_mi` | yes | Miles, `0` or more, up to 3 decimal places |
| `duration` | yes | `M:SS` or `H:MM:SS`. Total time for the activity, including walk breaks inside it. |
| `pace_per_mi` | when distance is greater than 0 | `M:SS`. Must equal duration ÷ distance, rounded to the nearest second. Blank when distance is 0. |
| `continuous_running_time` | yes | Longest uninterrupted running segment. `0:00` on every walk. |
| `walk_breaks` | yes | Whole number, `0` or more |
| `rpe` | when completed is `yes` or `partial` | Whole number `1` through `10` |
| `energy` | when completed is `yes` or `partial` | `low`, `moderate`, `high` |
| `completed` | yes | `yes`, `partial`, `no` |
| `notes` | no | Free text. Quote the cell if it contains a comma. |
| `is_benchmark` | yes | `yes` or `no`. Use `yes` only for a continuous completed 2-mile test. |
| `data_source` | yes | `apple_watch`, `manual`, `estimate`, `mock` |
| `avg_hr` | no | Heart rate, 30–230 |
| `max_hr` | no | Heart rate, 30–230, and not below `avg_hr` |
| `avg_cadence` | no | Steps per minute, 50–250 |
| `active_calories` | no | 0–5000 |
| `stride_length_m` | no | Meters, 0.300–3.000 |
| `ground_contact_time_ms` | no | Milliseconds, 50–500 |

`yes` / `no`, energy, completed, and `data_source` may be any case. Activity names must match the list exactly, including spaces.

Do not rename those four activity types. To add a new one, update `ACTIVITY_TYPES` in `scripts/validate_running_data.py` and `EXERCISE_TYPES` or `WALKING_TYPES` in `app.js`, then document it here. A new type has to be classified as exercise or walking so mileage cannot be double-counted.

## Checks

The validator rejects:

- missing required fields, unknown activity types, bad dates, and values outside the lists above
- a pace that does not match duration ÷ distance
- duplicate rows (same date, activity, workout, distance, and duration)
- the same date stored under two different week numbers
- a walk with running time, or a walk marked as a benchmark

It also flags impossible values and refuses to treat them as records. The check fails until the row is corrected. Examples: 2.00 mi in 5:00 (2:30 per mile or faster at any distance), faster than 3:43 per mile over 1 mile or more, more than 50 miles, longer than 8 hours, or a heart rate, cadence, stride, or ground-contact time outside the ranges above.

On a clean file it prints the real-row metrics and a trend:

- `insufficient data` — fewer than four exercise sessions across two weeks
- `normal progression` — comparable pace and continuous running are both moving forward
- `improving pace` — comparable pace is faster
- `improving endurance` — the longest continuous run is longer
- `stalled` — pace and continuous running are flat or worse
- `high fatigue` — recent RPE is up and pace or endurance is flat or worse

Mock rows are not used for that trend. When the file is still all mock, the script says `insufficient data` and then prints a clearly labeled mock preview.

```bash
python3 scripts/validate_running_data.py
python3 scripts/validate_running_data.py --self-test
node tests/dashboard_rules.test.mjs
```

## Dashboard

From the repo root:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. Opening `index.html` as a file will not load the CSV.

After this branch is merged, the public page is:

https://ry2vlea.github.io/running-2mile-tracker/

GitHub still has to be told to publish with Actions. On the repository **ry2vlea/running-2mile-tracker**:

1. Click **Settings**.
2. In the left sidebar, click **Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.

The workflow `.github/workflows/pages.yml` deploys on every push to `main`. If a run failed before that source was selected, open **Actions**, select **Deploy GitHub Pages**, and click **Re-run all jobs**.
