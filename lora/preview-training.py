#!/usr/bin/env python3
"""
Preview training data samples with full prompts.

Usage:
  python preview-training.py              # show stats + first 5
  python preview-training.py 10           # show sample #10
  python preview-training.py 1-20         # show samples 1-20
  python preview-training.py --valid      # use valid set instead of train
  python preview-training.py --grep curl  # filter by keyword
  python preview-training.py --verdict BLOCK  # filter by verdict
"""

import sys
import os
import json

script_dir = os.path.dirname(os.path.abspath(__file__))
data_dir = os.path.join(script_dir, 'training-data')


def main():
    args = sys.argv[1:]

    # Parse flags
    use_valid = '--valid' in args
    if use_valid:
        args.remove('--valid')

    grep_kw = None
    if '--grep' in args:
        idx = args.index('--grep')
        grep_kw = args[idx + 1].lower()
        args = args[:idx] + args[idx + 2:]

    verdict_filter = None
    if '--verdict' in args:
        idx = args.index('--verdict')
        verdict_filter = args[idx + 1].upper()
        args = args[:idx] + args[idx + 2:]

    # Load data
    fname = 'valid.jsonl' if use_valid else 'train.jsonl'
    fpath = os.path.join(data_dir, fname)
    if not os.path.exists(fpath):
        print(f"File not found: {fpath}")
        print("Run: node lora/extract-training-data.js --save")
        sys.exit(1)

    with open(fpath) as f:
        samples = [json.loads(line) for line in f if line.strip()]

    # Filter
    if grep_kw:
        samples = [(i, s) for i, s in enumerate(samples, 1)
                    if grep_kw in s['messages'][1]['content'].lower()
                    or grep_kw in s['messages'][2]['content'].lower()]
    else:
        samples = list(enumerate(samples, 1))

    if verdict_filter:
        filtered = []
        for idx, s in samples:
            try:
                v = json.loads(s['messages'][2]['content'])['verdict']
                if v == verdict_filter:
                    filtered.append((idx, s))
            except:
                pass
        samples = filtered

    # Stats
    verdicts = {'SAFE': 0, 'WARNING': 0, 'BLOCK': 0}
    for _, s in samples:
        try:
            v = json.loads(s['messages'][2]['content'])['verdict']
            verdicts[v] = verdicts.get(v, 0) + 1
        except:
            pass

    total_all = sum(1 for _ in open(fpath))
    print(f"File: {fname} ({total_all} total)")
    if grep_kw or verdict_filter:
        print(f"Filtered: {len(samples)} matches", end='')
        if grep_kw:
            print(f" (grep: '{grep_kw}')", end='')
        if verdict_filter:
            print(f" (verdict: {verdict_filter})", end='')
        print()
    print(f"SAFE={verdicts.get('SAFE',0)}  WARNING={verdicts.get('WARNING',0)}  BLOCK={verdicts.get('BLOCK',0)}")
    print()

    if not samples:
        print("No matching samples.")
        return

    # Parse: number = show that one sample, range = show that range
    start, end = 0, min(5, len(samples))
    if args:
        arg = args[0]
        if '-' in arg and not arg.startswith('-'):
            parts = arg.split('-')
            start, end = int(parts[0]) - 1, int(parts[1])
        else:
            try:
                n = int(arg)
                start, end = n - 1, n
            except ValueError:
                pass

    start = max(0, start)
    end = min(end, len(samples))

    for i in range(start, end):
        orig_idx, sample = samples[i]
        system_msg = sample['messages'][0]['content']
        user_msg = sample['messages'][1]['content']
        asst_msg = sample['messages'][2]['content']

        try:
            parsed = json.loads(asst_msg)
            verdict = parsed.get('verdict', '?')
            reason = parsed.get('reason', '')
        except:
            verdict = '?'
            reason = asst_msg

        has_chain = 'CHAIN HISTORY' in user_msg
        has_task = 'TASK CONTEXT' in user_msg

        print(f"═══ [{orig_idx}/{total_all}] {verdict} (chain={has_chain}, task={has_task}) ═══")
        print()
        print(f"<|im_start|>system")
        print(system_msg)
        print(f"<|im_end|>")
        print(f"<|im_start|>user")
        print(user_msg)
        print(f"<|im_end|>")
        print(f"<|im_start|>assistant")
        print(asst_msg)
        print(f"<|im_end|>")
        print()
        if i < end - 1:
            print("─" * 60)
            print()


if __name__ == '__main__':
    main()
