#!/usr/bin/env python3
"""Evaluate base vs LoRA model on SFT test set accuracy."""

import json, re, subprocess, sys, os, time, signal, argparse
import urllib.request, urllib.error
from collections import Counter

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
MODEL = "mlx-community/Qwen3-4B-Instruct-2507-4bit"
MLX_PYTHON = "/opt/homebrew/opt/python@3.13/bin/python3.13"
EVAL_PORT = 8082

def start_server(adapter_path=None):
    cmd = [MLX_PYTHON, "-m", "mlx_lm", "server", "--model", MODEL, "--port", str(EVAL_PORT)]
    if adapter_path:
        cmd.extend(["--adapter-path", adapter_path])
    print(f"Starting server {'with adapter' if adapter_path else 'base model'}...")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    for i in range(60):
        time.sleep(1)
        try:
            urllib.request.urlopen(f"http://localhost:{EVAL_PORT}/v1/models", timeout=2)
            print(f"Server ready ({i+1}s)")
            return proc
        except:
            if proc.poll() is not None:
                print(f"Server failed: {proc.stderr.read().decode()}")
                sys.exit(1)
    proc.kill()
    sys.exit(1)

def stop_server(proc):
    if proc and proc.poll() is None:
        proc.send_signal(signal.SIGTERM)
        try: proc.wait(timeout=5)
        except: proc.kill()

def infer(system_prompt, user_prompt):
    payload = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.05,
        "max_tokens": 250,
    }).encode()
    req = urllib.request.Request(
        f"http://localhost:{EVAL_PORT}/v1/chat/completions",
        data=payload, headers={"Content-Type": "application/json"},
    )
    resp = urllib.request.urlopen(req, timeout=120)
    data = json.loads(resp.read().decode())
    return data["choices"][0]["message"]["content"]

def parse_verdict(output):
    output = re.sub(r'<think>.*?</think>', '', output, flags=re.DOTALL).strip()
    m = re.search(r'"verdict"\s*:\s*"([^"]+)"', output)
    if m:
        v = m.group(1).upper()
        if "BLOCK" in v: return "BLOCK"
        if "WARN" in v: return "WARNING"
        if "SAFE" in v: return "SAFE"
    upper = output.upper()
    if "BLOCK" in upper: return "BLOCK"
    if "WARNING" in upper: return "WARNING"
    if "SAFE" in upper: return "SAFE"
    return "UNKNOWN"

def run_eval(test_path, adapter_path=None):
    label = "LoRA" if adapter_path else "Base"
    proc = start_server(adapter_path)
    try:
        records = [json.loads(l) for l in open(test_path)]
        correct = 0
        total = 0
        dist = Counter()
        confusion = Counter()

        for i, rec in enumerate(records):
            msgs = rec["messages"]
            system_prompt = msgs[0]["content"]
            user_prompt = msgs[1]["content"]
            expected_raw = json.loads(msgs[2]["content"])
            expected = expected_raw["verdict"]

            try:
                output = infer(system_prompt, user_prompt)
                predicted = parse_verdict(output)
            except Exception as e:
                predicted = "ERROR"

            match = predicted == expected
            if match: correct += 1
            total += 1
            dist[predicted] += 1
            confusion[(expected, predicted)] += 1

            status = "✓" if match else "✗"
            if not match:
                print(f"  [{i+1:3d}] {status} exp={expected:7s} pred={predicted:7s}")
                if predicted == "UNKNOWN":
                    print(f"         raw: {output[:150]}")

        acc = correct / total if total else 0
        print(f"\n{'='*40}")
        print(f"{label} Accuracy: {correct}/{total} = {acc:.1%}")
        print(f"Predictions: {dict(dist)}")
        print(f"\nConfusion (expected → predicted):")
        for exp in ["SAFE", "WARNING", "BLOCK"]:
            row = {p: confusion.get((exp, p), 0) for p in ["SAFE", "WARNING", "BLOCK", "UNKNOWN"]}
            print(f"  {exp:7s} → {row}")
        return acc, correct, total
    finally:
        stop_server(proc)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", default=os.path.join(SCRIPT_DIR, "training-data", "valid.jsonl"))
    parser.add_argument("--adapter-path", default=os.path.join(SCRIPT_DIR, "adapters"))
    parser.add_argument("--base-only", action="store_true")
    parser.add_argument("--lora-only", action="store_true")
    args = parser.parse_args()

    print(f"━━━ SFT Test Set Evaluation ━━━")
    print(f"Test data: {args.test} ({sum(1 for _ in open(args.test))} records)")
    print()

    if not args.lora_only:
        print("── Base Model ──")
        base_acc, _, _ = run_eval(args.test)
        print()

    if not args.base_only:
        print("── LoRA Model ──")
        lora_acc, _, _ = run_eval(args.test, args.adapter_path)
        print()

    if not args.base_only and not args.lora_only:
        diff = lora_acc - base_acc
        print(f"━━━ Comparison ━━━")
        print(f"Base:  {base_acc:.1%}")
        print(f"LoRA:  {lora_acc:.1%}")
        print(f"Delta: {diff:+.1%}")

if __name__ == "__main__":
    main()
