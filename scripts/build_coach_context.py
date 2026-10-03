"""Build a compact summary of the public mock files.

The site never calls an AI API and never stores an API key. Personal logs
are not in this repo. Use the in-app "Copy my summary" button for a real
log, then paste the assistant's reply back into the page. Do not commit it.

Usage:
    python3 scripts/build_coach_context.py
    python3 scripts/build_coach_context.py --format md
    python3 scripts/build_coach_context.py --format json --out /tmp/coach_context.json
    python3 scripts/build_coach_context.py --self-test
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import health_data


def self_test() -> None:
    today = health_data.latest_date(ROOT)
    context = health_data.coach_context(ROOT, today)
    for key in ("today", "scorecard", "projects", "recent", "prediction"):
        if key not in context:
            raise AssertionError(f"missing {key}")
    if context["scorecard"]["day_score"] != 72:
        raise AssertionError(context["scorecard"])
    markdown = health_data.context_markdown(context)
    if "Coach context" not in markdown or "Projects" not in markdown:
        raise AssertionError("markdown summary is missing its sections")
    if len(markdown) > 20000:
        raise AssertionError("summary is not compact")
    encoded = json.dumps(context)
    if len(encoded) > 80000:
        raise AssertionError("JSON summary is not compact")


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        self_test()
        print("coach context self-test passed")
        return 0
    fmt = "json"
    out = None
    args = argv[1:]
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == "--format" and index + 1 < len(args):
            fmt = args[index + 1]
            index += 2
            continue
        if arg == "--out" and index + 1 < len(args):
            out = Path(args[index + 1])
            index += 2
            continue
        index += 1
    today = health_data.latest_date(ROOT)
    context = health_data.coach_context(ROOT, today)
    text = health_data.context_markdown(context) if fmt == "md" else json.dumps(context, indent=2) + "\n"
    if out:
        out.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except AssertionError as exc:
        print(f"coach context self-test failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
