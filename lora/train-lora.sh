#!/bin/bash
set -e

# LoRA fine-tuning script for GuardClaw safety scorer
# Uses mlx-lm on Apple Silicon

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$SCRIPT_DIR"
MODEL="mlx-community/Qwen3-4B-Instruct-2507-4bit"
OUTPUT_DIR="$SCRIPT_DIR/adapters"
PYTHON="/opt/homebrew/opt/python@3.13/bin/python3.13"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}━━━ GuardClaw LoRA Training ━━━${NC}"
echo ""

# 1. Check prerequisites
if [ ! -f "$DATA_DIR/train.jsonl" ]; then
    echo "❌ Training data not found. Run first:"
    echo "   cd guardclaw && node lora/export-training-data.js"
    exit 1
fi

TRAIN_COUNT=$(wc -l < "$DATA_DIR/train.jsonl" | tr -d ' ')
VALID_COUNT=$(wc -l < "$DATA_DIR/valid.jsonl" | tr -d ' ')
echo -e "${GREEN}📊 Dataset: ${TRAIN_COUNT} train, ${VALID_COUNT} valid${NC}"

# 2. Check Python + mlx-lm
if ! $PYTHON -c "import mlx_lm" 2>/dev/null; then
    echo "📦 Installing mlx-lm..."
    $PYTHON -m pip install mlx-lm --quiet
fi
echo -e "${GREEN}✓ mlx-lm ready${NC}"

# 3. Create output dir
mkdir -p "$OUTPUT_DIR"

# 4. Train
echo ""
echo -e "${BLUE}🚀 Starting LoRA training...${NC}"
echo "   Model:  $MODEL"
echo "   Output: $OUTPUT_DIR"
echo ""

$PYTHON -m mlx_lm lora \
    --model "$MODEL" \
    --train \
    --data "$DATA_DIR" \
    --adapter-path "$OUTPUT_DIR" \
    --batch-size 1 \
    --num-layers 4 \
    --iters 500 \
    --learning-rate 1e-5 \
    --val-batches 10 \
    --steps-per-report 10 \
    --steps-per-eval 50 \
    --save-every 50 \
    --max-seq-length 4096

echo ""
echo -e "${GREEN}✅ Training complete!${NC}"
echo "   Adapters saved to: $OUTPUT_DIR"
echo ""
echo "To test:"
echo "   $PYTHON -m mlx_lm generate --model $MODEL --adapter-path $OUTPUT_DIR --prompt 'Tool: Bash\nCommand: rm -rf /'"
