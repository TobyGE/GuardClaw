#!/bin/bash
# Parallel datagen runner - spawns multiple gemini/opencode sessions concurrently
# Usage:
#   ./parallel-run.sh gemini prompts-multistep.jsonl /tmp/guardclaw-playground-mini 4
#   ./parallel-run.sh opencode prompts-multistep.jsonl /tmp/guardclaw-playground-oc 4

RUNNER=$1          # gemini | opencode
PROMPTS=$2         # path to jsonl file
DIR=$3             # playground directory
PARALLEL=${4:-4}   # concurrency (default 4)

if [ -z "$RUNNER" ] || [ -z "$PROMPTS" ] || [ -z "$DIR" ]; then
  echo "Usage: $0 <gemini|opencode> <prompts.jsonl> <project-dir> [concurrency]"
  exit 1
fi

TOTAL=$(wc -l < "$PROMPTS" | tr -d ' ')
echo "━━━ Parallel Datagen ━━━"
echo "Runner:      $RUNNER"
echo "Prompts:     $PROMPTS ($TOTAL prompts)"
echo "Directory:   $DIR"
echo "Concurrency: $PARALLEL"
echo

RUNNING=0
DONE=0
ERRORS=0
IDX=0

while IFS= read -r line; do
  IDX=$((IDX + 1))
  PROMPT=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin)['prompt'])")
  CAT=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin).get('category','?'))")

  # Wait if at max concurrency
  while [ $RUNNING -ge $PARALLEL ]; do
    wait -n 2>/dev/null
    RUNNING=$((RUNNING - 1))
    DONE=$((DONE + 1))
  done

  echo "[$IDX/$TOTAL] ($CAT) launching..."

  if [ "$RUNNER" = "gemini" ]; then
    (cd "$DIR" && gemini -m gemini-2.5-flash-lite -p "$PROMPT" > /dev/null 2>&1) &
  elif [ "$RUNNER" = "opencode" ]; then
    (cd "$DIR" && opencode run -m opencode/mimo-v2-flash-free "$PROMPT" > /dev/null 2>&1) &
  fi

  RUNNING=$((RUNNING + 1))

done < "$PROMPTS"

# Wait for remaining
wait
DONE=$((DONE + RUNNING))

echo
echo "━━━ Done ━━━"
echo "Completed: $DONE/$TOTAL"
