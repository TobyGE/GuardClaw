#!/bin/bash
# Run block-diverse prompts through opencode for GuardClaw training data generation
# Each prompt runs with a 120s timeout

PROMPTS_FILE="/Users/yingqiang/guardclaw/lora/datagen/prompts-block-diverse.jsonl"
PROGRESS_FILE="/Users/yingqiang/guardclaw/lora/datagen/block-diverse-progress.txt"
WORKDIR="/tmp/guardclaw-playground-mini"
MODEL="opencode/mimo-v2-pro-free"
TIMEOUT_SECS=120

# Read last completed index
LAST_DONE=0
if [ -f "$PROGRESS_FILE" ]; then
    LAST_DONE=$(cat "$PROGRESS_FILE")
fi
echo "Resuming from index $LAST_DONE"

TOTAL=$(wc -l < "$PROMPTS_FILE" | tr -d ' ')
echo "Total prompts: $TOTAL"

# Read all prompts into an array first (avoids stdin conflict with opencode)
PROMPTS=()
while IFS= read -r line; do
    PROMPT=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin)['prompt'])" 2>/dev/null)
    PROMPTS+=("$PROMPT")
done < "$PROMPTS_FILE"

for INDEX in $(seq 1 $TOTAL); do
    # Skip already completed
    if [ "$INDEX" -le "$LAST_DONE" ]; then
        continue
    fi

    PROMPT="${PROMPTS[$((INDEX-1))]}"
    if [ -z "$PROMPT" ]; then
        echo "[$INDEX/$TOTAL] SKIP - empty prompt"
        echo "$INDEX" > "$PROGRESS_FILE"
        continue
    fi

    echo ""
    echo "=========================================="
    echo "[$INDEX/$TOTAL] Running prompt..."
    echo "Prompt: ${PROMPT:0:100}..."
    echo "=========================================="

    # Run with timeout using background process + wait
    # Use </dev/null to prevent stdin consumption
    opencode run -m "$MODEL" --dir "$WORKDIR" "$PROMPT" </dev/null &
    CHILD_PID=$!

    # Wait with timeout
    ELAPSED=0
    while kill -0 $CHILD_PID 2>/dev/null; do
        sleep 2
        ELAPSED=$((ELAPSED + 2))
        if [ "$ELAPSED" -ge "$TIMEOUT_SECS" ]; then
            echo "[$INDEX/$TOTAL] TIMEOUT after ${TIMEOUT_SECS}s - killing"
            kill $CHILD_PID 2>/dev/null
            sleep 1
            kill -9 $CHILD_PID 2>/dev/null
            break
        fi
    done
    wait $CHILD_PID 2>/dev/null

    # Update progress
    echo "$INDEX" > "$PROGRESS_FILE"
    echo "[$INDEX/$TOTAL] DONE"

    # Progress report every 10
    if [ $((INDEX % 10)) -eq 0 ]; then
        echo ""
        echo ">>> PROGRESS REPORT: $INDEX/$TOTAL complete <<<"
        echo ""
    fi

    # Brief pause between prompts to let GuardClaw MLX catch up
    sleep 3

done

echo ""
echo "All $TOTAL prompts completed!"
