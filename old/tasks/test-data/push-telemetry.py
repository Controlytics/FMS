#!/usr/bin/env python3
"""
Push telemetry data from CSV to DigiLog entities via HTTP API.
Runs continuously in rounds until stopped with Ctrl+C.

Usage:
  python3 push-telemetry.py                                # Push to default token (test@1234)
  python3 push-telemetry.py --token "Welcome@123"          # Push to specific token
  python3 push-telemetry.py --all                           # Push to ALL known entities
  python3 push-telemetry.py --delay 0.5                     # 500ms delay between rows (default: 0.2)
  python3 push-telemetry.py --pause 5                       # 5s pause between rounds (default: 5)
  python3 push-telemetry.py --file telemetry-200.csv        # Custom CSV file
  python3 push-telemetry.py --api http://3.108.185.106      # Production API
"""

import csv
import json
import time
import argparse
import os
import sys
import signal
import random
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

KNOWN_TOKENS = [
    ("test@1234", "test 01"),
    ("unique_custom_token_xyz", "temperature sensor"),
    ("my_test_custom_token_12345", "CCTV3"),
    ("welcome@123", "CPU1"),
    ("Tele@123", "CPU2"),
    ("Chatgpt@123", "Alarm"),
    ("Smoke@1234", "smoke 1"),
    ("Airs@123", "air 1"),
    ("Token@123", "gas 1"),
    ("Saivenna@123", "sensor 1"),
    ("Test@123", "device 1"),
    ("Welcome@123", "TempSensor_01"),
    ("Active@123", "fir 1"),
    ("Actives@123", "alarm"),
    ("Wass@123", "checker"),
]

running = True


def handle_stop(sig, frame):
    global running
    running = False
    print("\n\n  Stopping after current row... (Ctrl+C again to force quit)")
    signal.signal(signal.SIGINT, lambda s, f: sys.exit(1))


signal.signal(signal.SIGINT, handle_stop)


def read_csv(filepath):
    rows = []
    with open(filepath, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            data = {}
            for key, val in row.items():
                if key == "timestamp":
                    continue
                try:
                    data[key] = float(val)
                    if data[key] == int(data[key]):
                        data[key] = int(data[key])
                except ValueError:
                    data[key] = val
            rows.append(data)
    return rows


def randomize_row(row):
    """Generate fresh random values each round so data varies."""
    new = {}
    for key, val in row.items():
        if isinstance(val, (int, float)):
            # Add +/- 10% jitter
            jitter = val * 0.1
            new[key] = round(val + random.uniform(-jitter, jitter), 1)
        else:
            new[key] = val
    return new


def send_telemetry(api_url, token, data):
    url = f"{api_url}/api/data/telemetry"
    body = json.dumps(data).encode("utf-8")
    req = Request(url, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    resp = urlopen(req)
    return json.loads(resp.read().decode("utf-8"))


def progress_bar(current, total, width=30, suffix=""):
    pct = current / total
    filled = int(width * pct)
    bar = "\u2588" * filled + "\u2591" * (width - filled)
    sys.stdout.write(f"\r   {bar} {pct*100:.0f}% ({current}/{total}) {suffix}")
    sys.stdout.flush()


def run_round(args, rows, tokens, round_num):
    """Push one full round of CSV data. Returns (sent, failed)."""
    total_sent = 0
    total_failed = 0

    for token, name in tokens:
        if not running:
            break
        print(f"\n  Entity: {name} (token: {token[:12]}...)")
        sent = 0
        failed = 0

        for i, row in enumerate(rows):
            if not running:
                break
            data = randomize_row(row)
            try:
                send_telemetry(args.api, token, data)
                sent += 1
            except (HTTPError, URLError) as e:
                failed += 1
                if failed <= 3:
                    print(f"\n   X Row {i+1} failed: {e}")
                elif failed == 4:
                    print(f"\n   X Suppressing further errors...")

            if (i + 1) % 10 == 0 or i == len(rows) - 1:
                suffix = f"| temp={data.get('temperature','?')}, hum={data.get('humidity','?')}"
                progress_bar(i + 1, len(rows), suffix=suffix)

            if args.delay > 0 and i < len(rows) - 1:
                time.sleep(args.delay)

        print(f"\n   Sent: {sent} | Failed: {failed}")
        total_sent += sent
        total_failed += failed

    return total_sent, total_failed


def main():
    global running

    parser = argparse.ArgumentParser(description="Push CSV telemetry to DigiLog API (continuous)")
    parser.add_argument("--api", default="http://localhost:3000", help="API base URL")
    parser.add_argument("--file", default="telemetry-200.csv", help="CSV file name")
    parser.add_argument("--token", default="test@1234", help="Device access token")
    parser.add_argument("--delay", type=float, default=0.2, help="Delay in seconds between rows")
    parser.add_argument("--pause", type=float, default=5, help="Pause in seconds between rounds")
    parser.add_argument("--all", action="store_true", help="Push to all known entities")
    args = parser.parse_args()

    csv_path = os.path.join(SCRIPT_DIR, args.file)
    rows = read_csv(csv_path)
    keys = list(rows[0].keys()) if rows else []
    tokens = KNOWN_TOKENS if args.all else [(args.token, "specified")]

    print(f"\n  CSV: {csv_path}")
    print(f"  Rows: {len(rows)} | Keys: {', '.join(keys)}")
    print(f"  API: {args.api}")
    print(f"  Delay: {args.delay}s between rows | Pause: {args.pause}s between rounds")
    print(f"  Targets: {len(tokens)} entity(s)")
    print(f"  Mode: CONTINUOUS (Ctrl+C to stop)\n")

    grand_total_sent = 0
    grand_total_failed = 0
    round_num = 0

    while running:
        round_num += 1
        print("=" * 60)
        print(f"  ROUND {round_num}  |  {time.strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 60)

        sent, failed = run_round(args, rows, tokens, round_num)
        grand_total_sent += sent
        grand_total_failed += failed

        print(f"\n  Round {round_num} done: {sent} sent, {failed} failed")
        print(f"  Grand total: {grand_total_sent} sent, {grand_total_failed} failed")

        if not running:
            break

        print(f"\n  Next round in {args.pause}s... (Ctrl+C to stop)")
        # Sleep in small increments so Ctrl+C is responsive
        for _ in range(int(args.pause * 10)):
            if not running:
                break
            time.sleep(0.1)

    print("\n" + "=" * 60)
    print(f"  STOPPED after {round_num} round(s)")
    print(f"  Grand total: {grand_total_sent} sent, {grand_total_failed} failed")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
