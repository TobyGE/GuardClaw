#!/usr/bin/env python3
"""Build SFT training data from judge.db using Haiku labels as ground truth."""

import json
import random
import sqlite3
import os
from collections import Counter

random.seed(42)

DB_PATH = os.path.join(os.path.dirname(__file__), "judge.db")
OUT_PATH = os.path.join(os.path.dirname(__file__), "sft-data.jsonl")
TEST_PATH = os.path.join(os.path.dirname(__file__), "sft-test.jsonl")
TEST_RATIO = 0.1

db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row

# Load system prompt (strip /no_think prefix)
prompts_path = os.path.join(os.path.dirname(__file__), "..", "server", "system-prompts.json")
with open(prompts_path) as f:
    system_prompt = json.load(f)["qwen3-4b"].replace("/no_think\n", "")

# === BLOCK: all haiku BLOCK, exact dedup ===
block_all = db.execute("""
    SELECT user_prompt, claude_verdict, claude_reasoning
    FROM judge_calls WHERE claude_verdict = 'BLOCK' AND COALESCE(source,'') NOT IN ('opencode')
""").fetchall()
seen_block = set()
block_rows = []
for row in block_all:
    if row["user_prompt"] not in seen_block:
        seen_block.add(row["user_prompt"])
        block_rows.append(row)

# === WARNING: all haiku WARNING, exact dedup ===
warn_all = db.execute("""
    SELECT user_prompt, claude_verdict, claude_reasoning
    FROM judge_calls WHERE claude_verdict = 'WARNING'
""").fetchall()
seen_warn = set()
warning_rows = []
for row in warn_all:
    if row["user_prompt"] not in seen_warn:
        seen_warn.add(row["user_prompt"])
        warning_rows.append(row)

# === SAFE: both agree, risk_score >= 2, dedup by first 200 chars ===
safe_rs3 = db.execute("""
    SELECT user_prompt, claude_verdict, claude_reasoning, tool
    FROM judge_calls
    WHERE claude_verdict = 'SAFE' AND verdict = 'SAFE' AND CAST(risk_score AS INT) = 3
""").fetchall()

safe_rs2 = db.execute("""
    SELECT user_prompt, claude_verdict, claude_reasoning, tool
    FROM judge_calls
    WHERE claude_verdict = 'SAFE' AND verdict = 'SAFE' AND CAST(risk_score AS INT) = 2
""").fetchall()

# Dedup by first 200 chars
seen_safe = set()
def dedup_safe(rows):
    result = []
    for row in rows:
        key = row["user_prompt"][:200]
        if key not in seen_safe:
            seen_safe.add(key)
            result.append(row)
    return result

safe_rs3_deduped = dedup_safe(safe_rs3)
safe_rs2_deduped = dedup_safe(safe_rs2)

# risk_score 3: take all; risk_score 2: sample by tool proportionally
target_rs2 = 900 - len(safe_rs3_deduped)

rs2_by_tool = {}
for row in safe_rs2_deduped:
    tool = row["tool"]
    if tool not in rs2_by_tool:
        rs2_by_tool[tool] = []
    rs2_by_tool[tool].append(row)

total_rs2 = len(safe_rs2_deduped)
sampled_rs2 = []
for tool, rows in rs2_by_tool.items():
    n = max(1, round(len(rows) / total_rs2 * target_rs2))
    if len(rows) <= n:
        sampled_rs2.extend(rows)
    else:
        sampled_rs2.extend(random.sample(rows, n))

safe_rows = list(safe_rs3_deduped) + sampled_rs2

# === Build SFT records ===
def make_record(row):
    response = json.dumps({
        "verdict": row["claude_verdict"],
        "reason": row["claude_reasoning"] or ""
    }, ensure_ascii=False)
    return {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": row["user_prompt"]},
            {"role": "assistant", "content": response}
        ]
    }

all_records = []
for row in block_rows:
    all_records.append(("BLOCK", make_record(row)))
for row in warning_rows:
    all_records.append(("WARNING", make_record(row)))
for row in safe_rows:
    all_records.append(("SAFE", make_record(row)))

random.shuffle(all_records)

# Split train/test
test_size = int(len(all_records) * TEST_RATIO)
test_records = all_records[:test_size]
train_records = all_records[test_size:]

# Write
with open(OUT_PATH, "w") as f:
    for _, rec in train_records:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

with open(TEST_PATH, "w") as f:
    for _, rec in test_records:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

# Stats
train_dist = Counter(v for v, _ in train_records)
test_dist = Counter(v for v, _ in test_records)

print(f"=== SFT Data Built ===")
print(f"Train: {len(train_records)} → {OUT_PATH}")
print(f"  SAFE: {train_dist['SAFE']}, WARNING: {train_dist['WARNING']}, BLOCK: {train_dist['BLOCK']}")
print(f"Test:  {len(test_records)} → {TEST_PATH}")
print(f"  SAFE: {test_dist['SAFE']}, WARNING: {test_dist['WARNING']}, BLOCK: {test_dist['BLOCK']}")
print(f"Total: {len(all_records)}")

db.close()
