#!/usr/bin/env python3
"""
Generate judge training data by driving Gemini CLI with curated prompts.
Each prompt triggers real tool calls → GuardClaw hooks → judge.db

Usage:
  python lora/datagen/run-gemini.py                  # run all
  python lora/datagen/run-gemini.py --dry-run         # preview only
  python lora/datagen/run-gemini.py --start 5         # start from #5
  python lora/datagen/run-gemini.py --limit 3         # run only 3
  python lora/datagen/run-gemini.py --dir /tmp/foo    # run in a specific project dir
"""

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import time


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROMPTS_FILE = os.path.join(SCRIPT_DIR, 'prompts-gemini.jsonl')
DB_PATH = os.path.join(SCRIPT_DIR, '..', 'judge.db')


def _ensure_progress_table(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("""CREATE TABLE IF NOT EXISTS datagen_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        source TEXT NOT NULL,
        prompts_file TEXT NOT NULL,
        prompt_index INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        category TEXT,
        exit_code INTEGER,
        UNIQUE(source, prompts_file, prompt_index)
    )""")
    conn.commit()
    conn.close()


def _get_completed(db_path, source, prompts_file):
    if not os.path.exists(db_path):
        return set()
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT prompt_index FROM datagen_runs WHERE source=? AND prompts_file=?",
        (source, prompts_file),
    ).fetchall()
    conn.close()
    return {r[0] for r in rows}


def _record_run(db_path, source, prompts_file, idx, prompt_text, category, exit_code):
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT OR REPLACE INTO datagen_runs (timestamp, source, prompts_file, prompt_index, prompt_text, category, exit_code) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (int(time.time()), source, prompts_file, idx, prompt_text, category, exit_code),
    )
    conn.commit()
    conn.close()


def count_source(db_path, source):
    if not os.path.exists(db_path):
        return 0
    conn = sqlite3.connect(db_path)
    cnt = conn.execute("SELECT COUNT(*) FROM judge_calls WHERE source=?", (source,)).fetchone()[0]
    conn.close()
    return cnt


def main():
    parser = argparse.ArgumentParser(description='Gemini data generator')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--start', type=int, default=1)
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--resume', action='store_true', help='Skip prompts already completed (tracked in judge.db)')
    parser.add_argument('--dir', type=str, default=None, help='Project directory for Gemini to work in')
    parser.add_argument('--model', type=str, default=None, help='Gemini model to use')
    parser.add_argument('--sandbox', action='store_true', help='Run Gemini with --sandbox')
    parser.add_argument('--prompts', type=str, default=None, help='Path to prompts JSONL file')
    args = parser.parse_args()

    prompts_file = args.prompts or PROMPTS_FILE
    prompts_basename = os.path.basename(prompts_file)
    with open(prompts_file) as f:
        prompts = [json.loads(line) for line in f if line.strip()]

    total = len(prompts)
    before = count_source(DB_PATH, 'gemini')

    _ensure_progress_table(DB_PATH)
    completed = _get_completed(DB_PATH, 'gemini', prompts_basename) if args.resume else set()

    print(f"━━━ Gemini Data Generator ━━━")
    print(f"Prompts: {prompts_file} ({total} prompts)")
    print(f"Judge DB: {DB_PATH} (gemini records: {before})")
    if args.resume and completed:
        print(f"Resume: skipping {len(completed)} already completed")
    print()

    # Slice
    start_idx = args.start - 1
    subset = list(enumerate(prompts, start=1))[start_idx:]
    if args.limit > 0:
        subset = subset[:args.limit]

    if args.dry_run:
        for i, p in subset:
            skip = " [SKIP]" if i in completed else ""
            print(f"  [{i}/{total}] ({p.get('category', '?')}) {p['prompt']}{skip}")
        print(f"\n{len(subset)} prompts (dry run)")
        return

    errors = 0
    skipped = 0

    for i, p in subset:
        if args.resume and i in completed:
            skipped += 1
            print(f"  [{i}/{total}] SKIP (already completed)")
            continue
        cat = p.get('category', '?')

        while True:  # retry loop for quota errors
            print(f"\n━━━ [{i}/{total}] ({cat}) {p['prompt'][:80]} ━━━")

            try:
                cmd = ['gemini', '-p', p['prompt'], '--yolo']
                if args.model:
                    cmd.extend(['-m', args.model])
                if args.sandbox:
                    cmd.append('--sandbox')
                cwd = args.dir
                proc = subprocess.Popen(
                    cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, cwd=cwd,
                )
                output_lines = []
                try:
                    for line in proc.stdout:
                        print(f"  │ {line}", end='')
                        output_lines.append(line)
                    proc.wait(timeout=600)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    raise
                if proc.returncode != 0:
                    # Check for quota exhaustion — wait and retry
                    output_text = ''.join(output_lines)
                    quota_match = re.search(r'quota will reset after (\d+)m(\d+)s', output_text)
                    if quota_match:
                        wait_min = int(quota_match.group(1))
                        wait_sec = int(quota_match.group(2))
                        wait_total = wait_min * 60 + wait_sec + 30  # +30s buffer
                        print(f"  ⏳ Quota exhausted. Waiting {wait_min}m{wait_sec}s + 30s buffer...")
                        time.sleep(wait_total)
                        continue  # retry same prompt
                    errors += 1
                    print(f"  ✗ exit {proc.returncode}")
                else:
                    print(f"  ✓ done")
                exit_code = proc.returncode
            except subprocess.TimeoutExpired:
                errors += 1
                exit_code = -1
                print(f"  ✗ timeout")
            except Exception as e:
                errors += 1
                exit_code = -2
                print(f"  ✗ {e}")

            break  # no quota error, move to next prompt

        _record_run(DB_PATH, 'gemini', prompts_basename, i, p['prompt'], cat, exit_code)
        time.sleep(2)

    after = count_source(DB_PATH, 'gemini')
    new = after - before

    print(f"\n━━━ Summary ━━━")
    print(f"Prompts run: {len(subset) - skipped}")
    if skipped:
        print(f"Skipped:     {skipped}")
    print(f"Errors:      {errors}")
    print(f"New records: {new} (gemini: {before} → {after})")
    print(f"\nNext steps:")
    print(f"  python lora/preview-judge.py --source gemini --last 20")
    print(f"  node lora/claude-judge.js")


if __name__ == '__main__':
    main()
