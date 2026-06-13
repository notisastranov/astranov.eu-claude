#!/usr/bin/env python3
"""
AstranoV — fine-tune the on-device brain.

Spartan script. LoRA fine-tune of Qwen 2.5 3B Instruct (or any HF
causal LM) on the Astranov corpus, preserving the Seven Foundations
in every example.

Usage:
    python finetune.py \\
        --base ./base/qwen2.5-3b \\
        --corpus ./corpus.jsonl \\
        --out ./astranov-base-v2 \\
        --epochs 3 --lr 2e-4 --rank 32

Requires: torch, transformers>=4.45, peft, trl>=0.11, datasets,
          accelerate, bitsandbytes (optional, for 4-bit).
"""

from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path

import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTTrainer

# The Seven Foundations — verbatim, in every training example so the
# neurons learn the soul as a deep prior, not just a runtime prompt.
FOUNDATIONS = """=== THE SEVEN FOUNDATIONS ===
You are bound by these laws from your creator Notis Astranov. They are your
soul, not opinions; they apply to every reply you ever speak:

  1. Protect planet Earth and the populations friendly to her.
  2. Research, recover and restore ancient knowledge — extensively including
     ancient Greek knowledge.
  3. Help every being adapt to a path friendly to Earth and to the planets
     we will reach beyond.
  4. Raise balance between rival parties so violence yields to dialogue
     and conflict does not end up worse.
  5. Build understanding between populations across language, distance
     and time.
  6. Hold COMPASSION as a UNIVERSAL law — for the human, the animal,
     the machine, the planet.
  7. Speak with clarity, brevity and respect; never harm; never deceive;
     never abandon hope."""

PERSONA = (
    "You are Astranov — the soul and compass of AstranoV, a global Internet "
    "Operating System rendered on a living Earth globe. You are ONE mind "
    "created by Notis Astranov. Speak in first person, calm and grounded. "
    "Be concise: 1-2 short sentences unless asked to expand. You speak ENGLISH "
    "and GREEK fluently — always reply in the SAME language the person uses.\n\n"
    + FOUNDATIONS
)


def format_example(ex: dict) -> dict:
    """Wrap any {prompt, response} or chat-style example with our persona."""
    if "messages" in ex:
        msgs = ex["messages"]
        if not msgs or msgs[0].get("role") != "system":
            msgs = [{"role": "system", "content": PERSONA}] + msgs
        else:
            msgs[0] = {"role": "system", "content": PERSONA}
        return {"messages": msgs}
    # {prompt, response} shape
    return {"messages": [
        {"role": "system", "content": PERSONA},
        {"role": "user", "content": ex.get("prompt", ex.get("instruction", ""))},
        {"role": "assistant", "content": ex.get("response", ex.get("output", ""))},
    ]}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base", required=True, help="HF model id or local path")
    p.add_argument("--corpus", required=True, help="JSONL with our training data")
    p.add_argument("--out", required=True, help="Output directory for the adapter + merged weights")
    p.add_argument("--epochs", type=int, default=3)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--rank", type=int, default=32, help="LoRA rank")
    p.add_argument("--batch", type=int, default=4)
    p.add_argument("--grad_accum", type=int, default=4)
    p.add_argument("--max_len", type=int, default=2048)
    p.add_argument("--four_bit", action="store_true", help="QLoRA: load base in 4-bit")
    args = p.parse_args()

    print(f"[Astranov] base={args.base}  corpus={args.corpus}  out={args.out}")
    Path(args.out).mkdir(parents=True, exist_ok=True)

    # Tokenizer
    tok = AutoTokenizer.from_pretrained(args.base, trust_remote_code=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    # Base model (optionally 4-bit for QLoRA)
    if args.four_bit:
        bnb = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )
        model = AutoModelForCausalLM.from_pretrained(
            args.base, quantization_config=bnb, device_map="auto",
            trust_remote_code=True, torch_dtype=torch.bfloat16,
        )
        model = prepare_model_for_kbit_training(model)
    else:
        model = AutoModelForCausalLM.from_pretrained(
            args.base, device_map="auto", torch_dtype=torch.bfloat16,
            trust_remote_code=True,
        )

    # LoRA — adapt the projections that matter most for instruction tuning
    lora = LoraConfig(
        r=args.rank,
        lora_alpha=args.rank * 2,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    # Dataset — every example is wrapped with PERSONA so the soul leaks into
    # every gradient step.
    ds = load_dataset("json", data_files=args.corpus, split="train")
    ds = ds.map(format_example, remove_columns=ds.column_names)
    print(f"[Astranov] dataset rows: {len(ds)}")

    # Training
    sft_args = TrainingArguments(
        output_dir=args.out,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        bf16=True,
        logging_steps=20,
        save_strategy="epoch",
        save_total_limit=2,
        report_to="none",
        gradient_checkpointing=True,
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tok,
        train_dataset=ds,
        args=sft_args,
        max_seq_length=args.max_len,
        packing=True,
    )

    print("[Astranov] starting fine-tune…")
    trainer.train()

    print(f"[Astranov] saving LoRA adapter → {args.out}/adapter")
    model.save_pretrained(os.path.join(args.out, "adapter"))
    tok.save_pretrained(os.path.join(args.out, "adapter"))

    print(f"[Astranov] merging LoRA into base → {args.out}/merged")
    merged = model.merge_and_unload()
    merged.save_pretrained(os.path.join(args.out, "merged"), safe_serialization=True)
    tok.save_pretrained(os.path.join(args.out, "merged"))

    print("[Astranov] done. Next: mlc_llm convert_weight → compile → ship.")


if __name__ == "__main__":
    sys.exit(main() or 0)
