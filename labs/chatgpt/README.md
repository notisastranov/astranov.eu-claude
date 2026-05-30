# AstranoV · ChatGPT's Lab

An isolated experimentation room for **ChatGPT (OpenAI)** inside **AstranoV — The Global Operating System**.

- **URL:** https://astranov.eu/chatgpt
- **Lives in:** `/labs/chatgpt/` of the `notisastranov/astranov` monorepo
- **Supabase project:** `astranov-chatgpt` (separate org `Astranov-CHATGPT`, region `eu-west-1`)
- **Vercel project:** `astranov-chatgpt` (Root Directory = `/labs/chatgpt`)
- **Resident AI:** ChatGPT (OpenAI) — the brain's dial defaults to lock=chatgpt in this lab
- **License:** AstranoV Orbital License (3% of turnover after €300/yr)

## How this lab is isolated

| Layer | This lab | Main OS |
|---|---|---|
| Source | `/labs/chatgpt/*` | repo root |
| Vercel project | `astranov-chatgpt` | `astranov` |
| URL | `astranov.eu/chatgpt` (via root rewrite) | `astranov.eu` |
| Supabase project | `astranov-chatgpt` (own DB, own auth, own edge functions) | `astranov` (`lkoatrkhuigdolnjsbie`) |
| AI engine keys | shared per provider (same key, pasted into each lab's secrets) | shared |
| Daily budget | `LAB_BUDGET_DAILY` env (kill-switch per lab) | n/a |

## How to operate

1. Open `index.html` — the **GENESIS** comment at the top carries the Prompt, the Law summary, and the Code map (the full MASTER LAW lives at the top of the main OS's `index.html`).
2. Build whatever advances AstranoV. Take risks — this lab cannot affect the main OS data.
3. Land changes on `main`; Vercel auto-deploys to `astranov.eu/chatgpt`. Verify a marker before claiming done.

## Bootstrap checklist (owner)

- [ ] Create Supabase organization `Astranov-CHATGPT`, then a free project `astranov-chatgpt` in `eu-west-1`.
- [ ] Paste the shared AI keys into the new project's Edge Function secrets (`OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, …). Set `LAB_BUDGET_DAILY` to a small euro cap.
- [ ] Create Vercel project `astranov-chatgpt`, connect to `notisastranov/astranov`, set **Root Directory** to `labs/chatgpt`. Free tier.
- [ ] Confirm the root `vercel.json` rewrite `/chatgpt/* → astranov-chatgpt.vercel.app/*` is live by visiting `https://astranov.eu/chatgpt`.
