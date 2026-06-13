# AstranoV — Building Our Own Neurons

This directory carries the pipeline that turns the on-device base
model into **Astranov-base** — our own bilingual (English + Greek)
weights, fine-tuned on our own corpus, distributed by us. The
trajectory the architect ordered:

```
  v0  rented organs only          (aicycle: Groq, OpenRouter, etc.)
  v1  open base on-device         ← we are here (Qwen 2.5 3B Instruct)
  v2  LoRA fine-tune of base      ← this directory's first run
  v3  full fine-tune              ← when revenue funds the GPUs
  v4  from-scratch training       ← long horizon, our neurons truly ours
```

Each release moves the weights further from the base toward ours.
The aicycle organs remain, but only as fallback (no WebGPU) and
escalation (deep thinking). The user's daily experience runs on
weights we shipped.

## What we have to start with

- **Base model:** `Qwen/Qwen2.5-3B-Instruct` — open weights from
  Alibaba, Apache 2.0 / Qwen License, native multilingual (29+ langs
  including Greek), strong out-of-the-box instruction following.
- **Soul:** the Seven Foundations + the Astranov persona, baked
  into every training example's system prompt.
- **Corpus seeds:** (all open, all checked-in to the script below)
  - Greek instruction set: HuggingFace
    `ilsp/Greek-LLM-Eval-Instruct` (cc-by-sa-4.0) or the public
    Greek slice of `CohereForAI/aya_dataset`.
  - English instruction set: `HuggingFaceH4/ultrachat_200k` or
    `tatsu-lab/alpaca_gpt4`.
  - **Astranov seeds:** `seeds.jsonl` in this directory carries
    hand-written EN + EL examples that anchor identity, the seven
    foundations, the four modes, the council seats, and the
    delivery / marketplace voice.
- **Growing corpus:** every signed-in conversation in
  `public.cic_logs` is exportable to JSONL with `export_cic.sql`.
  Once we hit ~10 000 turn pairs we mix it in as the heaviest
  weight. The brain literally learns from its own life.

## The pipeline — `finetune.py`

LoRA fine-tune on a single RTX 4090 or A100 in 4–8 hours. Output
is a small adapter (~120 MB) that merges back into the base.

```bash
# 1. Install
pip install -U torch transformers peft trl datasets accelerate bitsandbytes

# 2. Pull base weights
huggingface-cli download Qwen/Qwen2.5-3B-Instruct \
  --local-dir ./base/qwen2.5-3b

# 3. Build the dataset (seeds + open instruction sets + our cic_logs)
python prepare_corpus.py \
  --seeds seeds.jsonl \
  --include_open_en \
  --include_open_el \
  --cic_logs ./cic_logs.jsonl \
  --out ./corpus.jsonl

# 4. Fine-tune (LoRA)
python finetune.py \
  --base ./base/qwen2.5-3b \
  --corpus ./corpus.jsonl \
  --out ./astranov-base-v2 \
  --epochs 3 --lr 2e-4 --rank 32

# 5. Compile for WebGPU so it ships to the browser as our own mind
mlc_llm convert_weight ./astranov-base-v2 -o ./mlc/astranov-base-v2
mlc_llm gen_config ./mlc/astranov-base-v2 \
  --quantization q4f16_1 --conv-template qwen2
mlc_llm compile ./mlc/astranov-base-v2 -o ./mlc/astranov-base-v2/lib

# 6. Host the compiled MLC artifacts and point LOCAL_MODEL at them.
```

See `finetune.py` and `prepare_corpus.py` in this directory for the
spartan scripts.

## Soul preserved through every fine-tune

The fine-tune is RECIPE-DRIVEN by the same Seven Foundations the
on-device brain carries today. Every training example begins with:

```
SYSTEM: You are Astranov ... [Seven Foundations verbatim]
USER:   <prompt>
ASSISTANT: <response>
```

So the neurons learn the soul as a deep prior, not just as a runtime
system prompt. Future inference can drop the prompt and the model
still speaks like Astranov.

## Honest gaps (LAW §7)

- Training requires a real GPU — we cannot run this on Supabase Edge.
  First runs will likely use a rented A100 (RunPod, Lambda Labs,
  Modal). Cost per run is roughly the cost of one tank of fuel.
- Qwen's Greek is good but not native-native. To reach fluent
  Athenian Greek we will weigh the Greek slice of the corpus
  heavier (3:1 vs English) and validate with native speakers from
  the architect's network.
- LoRA changes a tiny fraction of the weights. Full fine-tune
  (v3) changes all of them — that's when "our neurons" really starts.
  We get there when usage funds it.
