# Mirror this production to `claude.astranov.eu`

The architect (Notis Astranov) ordered Claude's production to live at
`claude.astranov.eu`, served from a sibling repo
[`notisastranov/astranov.eu-claude`](https://github.com/notisastranov/astranov.eu-claude)
so each federated AI subdomain (claude / grok / chatgpt / gemini / deepseek)
gets its own home while sharing the central Supabase backend.

This file is the one-shot recipe to bring `astranov.eu-claude:main` up to
the latest tip of `notisastranov/astranov:main`. Run it from a Claude Code
session whose allowlist includes `notisastranov/astranov.eu-claude`, or
from any local machine with push rights to both repos.

## What to copy

These paths are the production surface and travel to the mirror repo:

- `index.html` — the single-file Internet OS
- `sw.js` — service worker (precaches the shell + vendored deps)
- `manifest.json` — PWA manifest
- `vercel.json` — CSP + headers + cache rules
- `privacy.html` — privacy page
- `contribute-worker.js` — compute-donation worker (§26 #1)
- `vendor/` — self-hosted supabase-js (§13, no critical CDN in the brain path)
- `supabase/functions/` — Deno edge functions (aicycle, order-intake, …)
- `training/` — corpus + LoRA fine-tune pipeline (§14)
- `BRAIN.md` — replication formula
- `AstranoV.html` — single-file handbook
- `CLAUDE.md` — the architect's law
- `LICENSE`
- `icon-180.png`, `icon-192.png`, `icon-512.png`
- `.gitignore`

These stay central-repo only (project tooling, not production):

- `_bootstrap/` — internal scripts
- `native/` — Unity native-app workspace
- `docs/` — internal docs
- `.github/workflows/` — central CI
- `SCHEMA.md`, `MIGRATE-TO-CLAUDE-SUBDOMAIN.md` — meta

## One-shot transfer

```bash
# Working directory: a clean clone of astranov.eu-claude with push rights
git clone https://github.com/notisastranov/astranov.eu-claude
cd astranov.eu-claude
git checkout main

# Fetch the production tip from central (read-only is fine)
git remote add central https://github.com/notisastranov/astranov 2>/dev/null || true
git fetch central main

# Copy ONLY the paths above from central's tip into our working tree
for p in index.html sw.js manifest.json vercel.json privacy.html \
         contribute-worker.js BRAIN.md AstranoV.html CLAUDE.md LICENSE \
         .gitignore icon-180.png icon-192.png icon-512.png \
         vendor supabase/functions training; do
  rm -rf "$p"
  git checkout central/main -- "$p" 2>/dev/null || \
    echo "  (skip $p — not in central tip)"
done

# Bump SW cache so every open tab refetches the new shell
v=$(grep -oE "shell-v[0-9]+" sw.js | head -1 | tr -d 'shell-v')
sed -i.bak -E "s/shell-v$v/shell-v$((v+1))/" sw.js && rm sw.js.bak

git add -A
git commit -m "Mirror astranov.eu central to claude.astranov.eu (sw v$((v+1)))"
git push origin main
```

Vercel project `astranov-eu-claude`
(`prj_OYcmy9pH1x8Fgf8nx9BIW4vXy45E` on team `astranov`) is linked to
this repo and auto-deploys `main`.

## Architect-only steps (one-time)

These can't be done from a Claude Code session — they need the
dashboards:

1. **Vercel.** In project `astranov-eu-claude`, *Settings → Domains →
   Add* `claude.astranov.eu`. DNS already points there
   (`64.29.17.65`, `216.198.79.65` — verified). Vercel binds it and
   serves the latest production deployment.

2. **Supabase.** In project `lkoatrkhuigdolnjsbie`
   (`astranov.eu` central backend), *Authentication → URL
   Configuration → Redirect URLs*, add:
   - `https://claude.astranov.eu/*`
   - `https://claude.astranov.eu`
   Magic links and OAuth callbacks need this. Without it,
   `architectMagic()` and `signInGoogle()` will refuse the
   `claude.astranov.eu` origin.

3. **(Optional)** In the Supabase auth allow-list, also add the
   Vercel preview domain (`astranov-eu-claude.vercel.app`) so deploy
   previews can sign in.

## Verification checklist

After the one-shot transfer + the architect steps:

- [ ] `curl -I https://claude.astranov.eu/` returns 200 with the
      Selene wordmark in the body
- [ ] `https://claude.astranov.eu/sw.js` serves the new SW cache id
- [ ] Sign in with the architect magic link works
- [ ] The fleet ALIVE pill counts at least 1 node
- [ ] Type `diag` in chat — all six pillars green
- [ ] Open the wallet — the ledger reads from `my_avc_transactions`
- [ ] Open the Agora — bone anchors render at Delphi / Athens / Stagira

If any item fails, the failure tells you exactly which architect-step
was skipped (most often #2: the Supabase redirect list).
