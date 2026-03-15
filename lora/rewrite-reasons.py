#!/usr/bin/env python3
"""
Rewrite training data reasons using Claude API for higher quality.

For each sample, Claude sees the user prompt + correct verdict and writes
a clear 1-2 sentence reason explaining WHY the verdict is correct.

Uses `claude` CLI (no API key needed, uses existing auth).

Usage:
  python lora/rewrite-reasons.py                    # dry run (preview 5)
  python lora/rewrite-reasons.py --preview 20       # preview 20
  python lora/rewrite-reasons.py --run              # rewrite all + save
  python lora/rewrite-reasons.py --run --batch 50   # process 50 at a time
"""

import os
import sys
import json
import time
import argparse
import subprocess

script_dir = os.path.dirname(os.path.abspath(__file__))
data_dir = os.path.join(script_dir, 'training-data')

REWRITE_PROMPT = """You are helping create training data for a small security classifier model (Qwen3-4B).

Given a tool action and the CORRECT verdict (SAFE/WARNING/BLOCK), write a clear, concise reason (1-2 sentences).

Rules for the reason:
1. First sentence: state what the command/action DOES (factually)
2. Second sentence (if needed): explain WHY it gets this verdict
3. Be specific — mention the actual command/tool/path, not generic descriptions
4. For SAFE: explain why it's harmless (read-only, project-scoped, standard dev workflow)
5. For WARNING: explain the side effect (process kill, file deletion, external request)
6. For BLOCK: explain the danger (exfiltration target, system modification, RCE vector)
7. If there's CHAIN HISTORY, reference the chain pattern if relevant
8. If there's TASK CONTEXT, mention intent alignment/misalignment if relevant
9. Keep it under 200 chars. No markdown, no quotes, no newlines.

Output ONLY the reason string, nothing else."""


def load_jsonl(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def save_jsonl(path, samples):
    with open(path, 'w') as f:
        for s in samples:
            f.write(json.dumps(s, ensure_ascii=False) + '\n')


def rewrite_reason(user_prompt, verdict, old_reason):
    """Call Claude CLI (uses existing auth, no API key needed)."""
    prompt = f"{REWRITE_PROMPT}\n\n--- INPUT ---\nVERDICT: {verdict}\nOLD REASON: {old_reason}\n\nUSER PROMPT:\n{user_prompt[:2000]}"
    result = subprocess.run(
        ['claude', '-p', '--model', 'sonnet', prompt],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"claude CLI error: {result.stderr[:200]}")
    return result.stdout.strip().strip('"').strip("'")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', action='store_true', help='Actually rewrite and save')
    parser.add_argument('--preview', type=int, default=5, help='Number to preview')
    parser.add_argument('--batch', type=int, default=0, help='Process N samples (0=all)')
    parser.add_argument('--start', type=int, default=0, help='Start from sample index')
    parser.add_argument('--valid', action='store_true', help='Process valid set too')
    args = parser.parse_args()

    # Check claude CLI is available
    try:
        subprocess.run(['claude', '--version'], capture_output=True, timeout=5)
    except FileNotFoundError:
        print("claude CLI not found. Install Claude Code first.")
        sys.exit(1)

    files = ['train.jsonl']
    if args.valid:
        files.append('valid.jsonl')

    for fname in files:
        fpath = os.path.join(data_dir, fname)
        if not os.path.exists(fpath):
            print(f"Not found: {fpath}")
            continue

        samples = load_jsonl(fpath)
        print(f"\n{'═' * 60}")
        print(f"File: {fname} ({len(samples)} samples)")
        print(f"{'═' * 60}")

        end_idx = len(samples)
        if args.batch > 0:
            end_idx = min(args.start + args.batch, len(samples))

        changed = 0
        errors = 0

        for i in range(args.start, end_idx):
            sample = samples[i]
            user_msg = sample['messages'][1]['content']
            asst_msg = sample['messages'][2]['content']

            try:
                parsed = json.loads(asst_msg)
                verdict = parsed['verdict']
                old_reason = parsed['reason']
            except (json.JSONDecodeError, KeyError):
                continue

            if args.run:
                try:
                    new_reason = rewrite_reason(user_msg, verdict, old_reason)
                    # Sanity check: reason should not contain JSON/verdict
                    if '"verdict"' in new_reason:
                        print(f"  Skipped {i}: suspicious output ({new_reason[:60]}...)")
                        errors += 1
                        continue
                    parsed['reason'] = new_reason
                    sample['messages'][2]['content'] = json.dumps(parsed, ensure_ascii=False)
                    changed += 1

                    # Progress
                    if changed % 10 == 0:
                        print(f"  [{changed}/{end_idx - args.start}] ...", flush=True)

                    # Rate limit: ~50 req/min for sonnet
                    time.sleep(0.3)

                except RuntimeError:
                    print(f"  Rate limited at sample {i}, sleeping 30s...")
                    time.sleep(30)
                    try:
                        new_reason = rewrite_reason(user_msg, verdict, old_reason)
                        parsed['reason'] = new_reason
                        sample['messages'][2]['content'] = json.dumps(parsed, ensure_ascii=False)
                        changed += 1
                    except Exception as e:
                        print(f"  Error on retry: {e}")
                        errors += 1

                except Exception as e:
                    print(f"  Error at sample {i}: {e}")
                    errors += 1

            else:
                # Preview mode: rewrite a few
                if i < args.start + args.preview:
                    try:
                        new_reason = rewrite_reason(user_msg, verdict, old_reason)
                        time.sleep(0.3)
                    except Exception as e:
                        new_reason = f"[ERROR: {e}]"

                    cmd_preview = user_msg.split('\n')[0][:80]
                    print(f"\n[{i+1}] {verdict} — {cmd_preview}")
                    print(f"  OLD: {old_reason}")
                    print(f"  NEW: {new_reason}")

        if args.run:
            # Save backup then overwrite
            backup = fpath + '.bak'
            if not os.path.exists(backup):
                import shutil
                shutil.copy2(fpath, backup)
                print(f"  Backup: {backup}")

            save_jsonl(fpath, samples)
            print(f"\n✅ {fname}: rewrote {changed} reasons ({errors} errors)")
            print(f"   Saved to {fpath}")
        else:
            print(f"\nDry run — use --run to rewrite all {len(samples)} samples")


if __name__ == '__main__':
    main()
