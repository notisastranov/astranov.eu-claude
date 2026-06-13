#!/usr/bin/env python3
"""
AstranoV — build the Astranov training corpus.

Pulls together:
  - seeds.jsonl                — hand-written EN + EL Astranov examples
  - open English instruction set (HuggingFace)
  - open Greek instruction set (HuggingFace)
  - cic_logs.jsonl             — exported live conversations
and writes the final mixed JSONL the fine-tune script consumes.

Greek is weighted heavier than English (3:1) so the model speaks fluent
Athenian, not just "translated English".
"""

from __future__ import annotations
import argparse
import json
import random
from pathlib import Path

try:
    from datasets import load_dataset
except ImportError:
    load_dataset = None


def read_jsonl(path: str):
    if not path:
        return []
    p = Path(path)
    if not p.exists():
        return []
    return [json.loads(line) for line in p.open("r", encoding="utf-8") if line.strip()]


def emit_msg(out, ex):
    """Normalize any shape into a {messages:[…]} record."""
    if "messages" in ex:
        out.write(json.dumps({"messages": ex["messages"]}, ensure_ascii=False) + "\n")
        return
    instr = ex.get("prompt") or ex.get("instruction") or ex.get("input") or ""
    resp  = ex.get("response") or ex.get("output") or ex.get("completion") or ""
    if not instr or not resp:
        return
    out.write(json.dumps({
        "messages": [
            {"role": "user", "content": instr},
            {"role": "assistant", "content": resp},
        ]
    }, ensure_ascii=False) + "\n")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--seeds",        default="seeds.jsonl")
    p.add_argument("--cic_logs",     default="")
    p.add_argument("--include_open_en", action="store_true")
    p.add_argument("--include_open_el", action="store_true")
    p.add_argument("--en_take", type=int, default=20_000, help="cap on English open samples")
    p.add_argument("--el_take", type=int, default=60_000, help="cap on Greek open samples (heavier weight)")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    rows = []

    # 1. Hand-written Astranov seeds — every release of the corpus carries
    #    these as gospel. Their weight stays high because we replicate.
    seeds = read_jsonl(args.seeds)
    for _ in range(5):
        rows.extend(seeds)
    print(f"[corpus] seeds × 5  → {len(rows)}")

    # 2. Live conversations from cic_logs (when present).
    cic = read_jsonl(args.cic_logs)
    rows.extend(cic)
    print(f"[corpus] +cic_logs  → {len(rows)} (added {len(cic)})")

    # 3. Open Greek slice — the model speaks Greek because we train on Greek.
    if args.include_open_el and load_dataset is not None:
        try:
            ds = load_dataset("CohereForAI/aya_dataset", split="train")
            el = ds.filter(lambda r: (r.get("language_code") or "").startswith("ell"))
            el = el.select(range(min(args.el_take, len(el))))
            for r in el:
                rows.append({"prompt": r["inputs"], "response": r["targets"]})
            print(f"[corpus] +aya_el   → {len(rows)} (added {len(el)})")
        except Exception as e:
            print(f"[corpus] aya_el skipped: {e}")

    # 4. Open English instruction set — balanced general capability.
    if args.include_open_en and load_dataset is not None:
        try:
            ds = load_dataset("HuggingFaceH4/ultrachat_200k", split="train_sft")
            ds = ds.select(range(min(args.en_take, len(ds))))
            for r in ds:
                rows.append({"messages": r["messages"]})
            print(f"[corpus] +ultrachat→ {len(rows)} (added {len(ds)})")
        except Exception as e:
            print(f"[corpus] ultrachat skipped: {e}")

    random.shuffle(rows)
    with open(args.out, "w", encoding="utf-8") as out:
        for r in rows:
            emit_msg(out, r)
    print(f"[corpus] wrote {args.out}  ({len(rows)} rows)")


if __name__ == "__main__":
    main()
