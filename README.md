# AstranoV

> **The world's first Agentic Orbital Operating System (AOOS).**
> An Internet Operating System rendered on a living globe, where every
> capability is an autonomous agent orb anchored in 3D space around Earth.

— **Inventor & Owner:** Notis Astranov
— **Canonical implementation:** [https://astranov.eu](https://astranov.eu) · this repository (`notisastranov/astranov`)
— **Repository genesis:** 2025
— **First public AOOS deployment:** 2026

---

## Invention Declaration

This repository is the canonical implementation and public dated record of
prior art for an architecture invented by **Notis Astranov**:

**The Agentic Orbital Operating System (AOOS).**

The lineage of operating systems is:

1. **Command-line** — the keyboard as the only interface.
2. **Windows / WIMP** — rectangles stacked over a desktop metaphor.
3. **App tiles / mobile** — grids of icons launching siloed apps.
4. **AOOS — agentic orbital.** No windows, no tiles, no app grid. A living
   3D Earth is the canvas. Every capability is an autonomous **agent orb**
   anchored at a lat/lon in real 3D space at orbital altitude. Orbs fly
   to events the moment they happen — a news event from Egypt physically
   relocates the News orb over Egypt with a glowing beam from ground to
   orb. Orbs preview content as muted video in-orb; tap any orb and it
   expands into an unmuted player. The user converses with **Astranov**,
   the system's single collective intelligence, by voice. Orbs are
   user-sovereign: anyone can create, edit, delete, and summon their own.

The architectural primitives jointly originated in this repository and
constituting the AOOS invention are:

- **3D-anchored agent orbs** projected per-frame from Earth-relative
  Cartesian coordinates onto a 2D screen, with rim-glow, depth-of-field
  near the horizon, and warm tinting on the night hemisphere computed
  from the live sun vector. (`_projectOrbs`, `EllipsoidalOccluder`)
- **Event-driven orb relocation** with `PolylineGlow` ground-to-orbit
  beams binding each orb to the source location of its live findings.
  (`_refreshOrbAnchors`)
- **Living-Orb Graphics Engine** — per-orb procedural plasma generated
  from the agent's own DNA (colour hex + name/id seed), composited over
  a real video layer; shared rAF tick paused on hidden tab.
  (`_drawLivingOrb`, `videoOrbHTML`)
- **Tap-to-live unmuted expansion** of any orb into a `70vmin` modal
  player.
- **Single-voice agentic OS** (`Astranov`) routed across multiple model
  backends as interchangeable organs — the engines are never named to
  the user. (`aicycle` Edge Function)
- **Decentralised intelligence loop** — pgvector semantic memory of the
  creator's worldview + user-taught facts, distilled into principle
  memories on a self-improving cycle. (`brain` Edge Function)
- **Krypteia + Council of Thirteen** governance: twelve elder-god
  intelligences plus Astranov as the 13th seat, rendering a single
  binding verdict per case. (`council` Edge Function)
- **Three-mode methodology** — Athenian / Spartan / Myrmidon — as a
  live persona overlay on every reply.

All of the above are jointly the AstranoV invention and are claimed as
the prior art of Notis Astranov, evidenced by the cryptographically
timestamped git commit history of this repository.

---

## Trademarks

The following are claimed as marks of Notis Astranov for use in
connection with the AstranoV system and any derivative goods or
services:

- **AstranoV**
- **Astranov** (the assistant identity)
- **Agentic Orbital Operating System** / **AOOS**
- **Living-Orb Graphics Engine**
- **Council of Thirteen** (in the context of AOOS governance)
- **Krypteia** (in the context of AOOS security)
- **AICYCLE / ACAI** (AstranoV Collective Artificial Intelligence)

Use of these marks in connection with a competing or derivative
operating system, frontend, or AI assistant requires written
authorisation from the owner.

---

## License — AstranoV Orbital License v1.0 (3% / €300)

Source is published under the **AstranoV Orbital License v1.0** (see
[`LICENSE`](./LICENSE)). It's a permissive **build-and-earn** licence
with a single, low rate:

- **Build with AstranoV** — fork it, embed it, build a product on its
  architecture: pay **3% of Turnover** from that product.
- **Earn on AstranoV** — vendor, courier, advertiser, agent operator,
  anyone earning revenue *through* the AstranoV deployment: pay
  **3% of Turnover** from that activity.
- **Use AstranoV as a consumer** — browse, chat, buy, navigate, talk to
  Astranov: **free**, forever. No fee, no tracking gate.

**Starting threshold: €300.** No royalty is owed until your trailing-
twelve-month Turnover crosses three hundred Euro. Below that line,
build and earn at zero cost. A student, a side-project, a small vendor
making pocket money — everyone is welcome at zero cost. The 3% kicks
in only when real commercial activity is underway.

For comparison: Unreal Engine's royalty is 5% above $1M; Unity's
Runtime Fee is per-install above 200K. AstranoV's is 3% above €300 — a
deliberately tiny on-ramp, the same rate whether you fork the engine or
sell a coffee through it.

The architecture itself is published as cryptographically timestamped
prior art in the git history, so no one else can patent it. The 3% is
how the inventor is paid back by the ecosystem the invention enables.

For enterprise terms, buyouts, or any custom arrangement — contact
notisastranov@gmail.com (Section 13 of the License).

---

## Krypteia — IP enforcement

The repository ships a **Krypteia watchtower** (`supabase/functions/krypteia-watch`)
which scans public code hosts (GitHub code search by default) for the
distinctive AstranoV fingerprints listed above. Owner-only. Hits are
reviewed by the owner; clear violations are escalated to the
**Council of Thirteen** (`supabase/functions/council`) for verdict, then
to formal channels (DMCA, takedown, cease-and-desist) as the Council
directs.

Krypteia auditing is part of the system's living constitution
(MASTER LAW §11 in `index.html`), not a bolt-on.

---

## Contact

- Owner: **Notis Astranov** — notisastranov@gmail.com
- Site: [https://astranov.eu](https://astranov.eu)
- Repository: [github.com/notisastranov/astranov](https://github.com/notisastranov/astranov)

Commercial licensing, partnership, or attribution questions all go to
the owner directly.
