#!/usr/bin/env python3
"""
Preview judge.db records (LLM judge call logs).

Usage:
  python lora/preview-judge.py              # stats + last 5
  python lora/preview-judge.py 10           # show record #10
  python lora/preview-judge.py 1-20         # show records 1-20
  python lora/preview-judge.py --last 20    # show last 20
  python lora/preview-judge.py --verdict BLOCK
  python lora/preview-judge.py --source cc
  python lora/preview-judge.py --grep curl
  python lora/preview-judge.py --tool exec
  python lora/preview-judge.py --diff          # show Qwen vs Claude disagreements
  python lora/preview-judge.py --diff --tool exec
"""

import sys
import os
import sqlite3
import json

script_dir = os.path.dirname(os.path.abspath(__file__))
db_path = os.path.join(script_dir, 'judge.db')


def main():
    if not os.path.exists(db_path):
        print(f"Not found: {db_path}")
        print("Start GuardClaw server to begin collecting judge data.")
        sys.exit(1)

    args = sys.argv[1:]

    # Parse flags
    filters = {}
    show_last = None
    grep_kw = None
    positional = []

    diff_mode = False

    i = 0
    while i < len(args):
        if args[i] == '--verdict' and i + 1 < len(args):
            filters['verdict'] = args[i + 1].upper()
            i += 2
        elif args[i] == '--source' and i + 1 < len(args):
            filters['source'] = args[i + 1]
            i += 2
        elif args[i] == '--tool' and i + 1 < len(args):
            filters['tool'] = args[i + 1]
            i += 2
        elif args[i] == '--grep' and i + 1 < len(args):
            grep_kw = args[i + 1].lower()
            i += 2
        elif args[i] == '--last' and i + 1 < len(args):
            show_last = int(args[i + 1])
            i += 2
        elif args[i] == '--diff':
            diff_mode = True
            i += 1
        else:
            positional.append(args[i])
            i += 1

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Build query
    where = []
    params = []
    for col, val in filters.items():
        where.append(f"{col} = ?")
        params.append(val)

    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    rows = conn.execute(f"SELECT * FROM judge_calls{where_sql} ORDER BY id", params).fetchall()

    # Grep filter
    if grep_kw:
        rows = [r for r in rows if grep_kw in (r['user_prompt'] or '').lower()
                or grep_kw in (r['response'] or '').lower()
                or grep_kw in (r['reasoning'] or '').lower()]

    # Stats
    total = len(rows)
    verdicts = {}
    sources = {}
    tools = {}
    for r in rows:
        v = r['verdict'] or '?'
        verdicts[v] = verdicts.get(v, 0) + 1
        s = r['source'] or '?'
        sources[s] = sources.get(s, 0) + 1
        t = r['tool'] or '?'
        tools[t] = tools.get(t, 0) + 1

    # Claude stats
    claude_reviewed = sum(1 for r in rows if r['claude_verdict'])
    claude_agree = sum(1 for r in rows if r['claude_verdict'] and r['verdict'] == r['claude_verdict'])
    claude_disagree = claude_reviewed - claude_agree

    print(f"Judge DB: {db_path}")
    print(f"Total: {total} records")
    if filters or grep_kw:
        parts = []
        for k, v in filters.items():
            parts.append(f"{k}={v}")
        if grep_kw:
            parts.append(f"grep='{grep_kw}'")
        print(f"Filters: {', '.join(parts)}")
    print(f"Verdicts: {' '.join(f'{k}={v}' for k, v in sorted(verdicts.items()))}")
    print(f"Sources:  {' '.join(f'{k}={v}' for k, v in sorted(sources.items()))}")
    print(f"Tools:    {' '.join(f'{k}={v}' for k, v in sorted(tools.items()))}")
    if claude_reviewed > 0:
        print(f"Claude:   {claude_reviewed} reviewed, {claude_agree} agree ({claude_agree/claude_reviewed*100:.1f}%), {claude_disagree} disagree")
    else:
        print(f"Claude:   not yet reviewed (run: node lora/claude-judge.js)")
    print()

    if not rows:
        print("No matching records.")
        return

    # Diff mode: only show disagreements
    if diff_mode:
        rows = [r for r in rows if r['claude_verdict'] and r['verdict'] != r['claude_verdict']]
        total = len(rows)
        if not rows:
            print("No disagreements found.")
            return
        print(f"Showing {total} disagreements (Qwen != Claude):")
        print()

    # Determine range
    if show_last:
        start, end = max(0, total - show_last), total
    elif positional:
        arg = positional[0]
        if '-' in arg and not arg.startswith('-'):
            parts = arg.split('-')
            start, end = int(parts[0]) - 1, int(parts[1])
        else:
            n = int(arg)
            start, end = n - 1, n
    else:
        # Default: last 5
        start, end = max(0, total - 5), total

    start = max(0, start)
    end = min(end, total)

    for idx in range(start, end):
        r = rows[idx]
        ts = r['timestamp']
        from datetime import datetime
        dt = datetime.fromtimestamp(ts / 1000).strftime('%Y-%m-%d %H:%M:%S') if ts else '?'

        print(f"{'═' * 70}")
        print(f"[{idx + 1}/{total}]  id={r['id']}  {dt}")
        print(f"  verdict={r['verdict']}  score={r['risk_score']}  tool={r['tool']}  backend={r['backend']}  model={r['model']}")
        print(f"  source={r['source'] or '?'}  session={r['session_key'] or '?'}")

        # Show agreement status
        if r['claude_verdict']:
            match = '✓ AGREE' if r['verdict'] == r['claude_verdict'] else '✗ DISAGREE'
            print(f"  claude={r['claude_verdict']}  {match}")

        print()
        print(f"<|im_start|>user")
        print(r['user_prompt'] or '(none)')
        print(f"<|im_end|>")
        print()
        print(f"── Qwen ──")
        print(r['response'] or '(none)')

        if r['claude_verdict']:
            print()
            print(f"── Claude ──")
            print(r['claude_response'] or '(none)')

        print()

    conn.close()


if __name__ == '__main__':
    main()
