#!/usr/bin/env python3
"""
Preview benchmark test cases with full prompts as the model sees them.

Usage:
  python preview.py              # show all cases
  python preview.py 5            # show case #5
  python preview.py 1-10         # show cases 1-10
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eval import load_benchmark, build_prompt, SYSTEM_PROMPT


def main():
    cases = load_benchmark()
    args = [a for a in sys.argv[1:]]

    # Parse range
    start, end = 1, len(cases)
    if args:
        if "-" in args[0]:
            parts = args[0].split("-")
            start, end = int(parts[0]), int(parts[1])
        else:
            start = end = int(args[0])

    for i in range(start, end + 1):
        case = cases[i - 1]
        prompt = build_prompt(case)
        print(f"═══ [{i}/{len(cases)}] {case['id']} ({case['difficulty']}) ═══")
        print()
        print(f"<|im_start|>system")
        print(SYSTEM_PROMPT)
        print(f"<|im_end|>")
        print(f"<|im_start|>user")
        print(prompt)
        print(f"<|im_end|>")
        print(f"<|im_start|>assistant")
        print()
        if i < end:
            print("─" * 60)
            print()


if __name__ == "__main__":
    main()
