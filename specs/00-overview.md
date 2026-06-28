# 00 — Overview, Scope & Phasing

## What GooseGrade is

GooseGrade answers one question for a UWaterloo student, accurately and instantly:

> *"Given my course's official grading scheme, what's my grade now, and what do I need on
> what's left to hit my target?"*

**The moat:** grading weights are **pre-loaded from official `outline.uwaterloo.ca` outlines**,
scraped and parsed by AI. A generic calculator makes you type every weight; GooseGrade already
knows them. v2 keeps that moat and adds **accounts, persistence, and multi-course intelligence**.

## The transformation (v1 → v2)

| | v1 (today) | v2 (this rebuild) |
|---|---|---|
| State | Ephemeral React state, lost on refresh | Persistent, per-user, across the whole degree |
| Scope | One course at a time | **All courses at once** + term/cumulative average |
| Data | Shared read-only catalog; edits leak to everyone (bug) | Catalog template + **per-user forked copy** |
| Grading | `sum(grade × weight)` only | **Declarative rules engine** (best-N-of-M, replacement, pass gates, …) |
| Scraper | Manual local scripts, hardcoded term | Productionized, scheduled, Claude-extracted, re-scrape + diff |
| Infra | Vercel + Supabase (read-only) | Same + Supabase Auth/RLS; **Docker/K8s** scraper & QA slice |

## Who it's for

- **Primary:** UWaterloo undergrads tracking grades across a term — especially co-op/scholarship
  students who live and die by their **term average**.
- **Secondary:** anyone needing a quick one-off calculation (the calculator stays usable
  signed-out).

## Product philosophy (binding)

- **Durable, repeat, multi-term utility** over flashy features. It must be worth opening every
  week for four years: a trusted **system of record** + a reliable **"what do I need" loop**.
- **Neutral data tool** tone — numbers and ranges, no coaching or judgment.
- **Correctness is sacred.** A rule that turns a passing grade into a displayed fail would kill
  trust and retention. Uncertain → fall back to plain weighted sum; verify by **multi-agent QA**.

## Scope

### ✅ Phase 1 — Core (this build)
Accounts (Supabase Auth, UW email) · lifetime academic record · **My Term dashboard** with live
credit-weighted term & cumulative average · grade-back loop · term rollover · cross-course
"what do I need" + achievable range · the **grade engine** with the full per-course rule taxonomy
(layered overrides, visible + toggleable) · catalog fork-on-add · intake via smart manual add +
term/level auto-suggest · catalog trust (auto re-scrape + diff, downloadable source outline) ·
feedback button · opt-in class distributions (give-to-get, percentile, per-term, min-sample
floor) · formalized design system (glow landing-only) · refactor of the legacy 1,800-line
duplication into shared engine + components · Docker/K8s QA slice.

### 🕓 Later (post-v1)
LEARN/Quest grade auto-import · Google Calendar deadline sync · degree-long planner · proactive
standing nudges (Dean's list) · crowd auto-healing of the catalog · dedicated EKS backend API ·
Quest **schedule** import (intake).

### ❌ Cut (do not build)
Grade-health score · study-time ROI · early-warning engine · adaptive tone · heavy rule
safeguards (show-both / verification gates) · probabilistic/Monte-Carlo forecasting · snapshot-lock.

## Phasing within Phase 1 (suggested build order)

1. **Foundation** — schema + RLS + Auth + profile + the typed `lib/api` layer (mock + live).
2. **Engine** — `lib/engine` pure module + unit tests (the riskiest piece; do early).
3. **Single course, persisted** — course detail page on the new model (grade-back loop, fork-on-add).
4. **Dashboard** — My Term, multi-course, credit-weighted averages, cross-course "what do I need".
5. **Term lifecycle** — rollover, past terms, lifetime record.
6. **Trust & community** — outline source links, feedback, opt-in distributions.
7. **Scraper v2** — productionize + Claude extraction + Docker/K8s QA over every course.
8. **Polish** — design-system pass, mobile/a11y, dark mode.

## Success criteria

- A student can sign in, add their real term's courses in **< 2 minutes**, and see a correct,
  credit-weighted term average.
- Entering a returned grade updates standing in **< 5 seconds** (the grade-back loop).
- The engine reproduces the **exact** official grade for a verified sample of real courses, and
  **never** displays a passing student as failing (asserted by the QA runner over every course).
- Data persists across sessions and terms; a user can export and delete all their data.

## Non-goals

Not a course-review site (UW Flow exists), not an LMS, not a social network. It is a grade
intelligence tool with just enough community (distributions, corrections) to stay accurate.
