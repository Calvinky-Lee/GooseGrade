# GooseGrade

## Running it locally

The v2 app runs entirely on in-memory mock data, so you need **no Supabase
credentials and no database** to click through it.

```bash
npm install
npm run dev
```

Then open:

| URL | What it is |
|---|---|
| http://localhost:3000/dashboard | My Term — credit-weighted term average, cumulative, cross-course "what do I need" |
| http://localhost:3000/dashboard/course/course-cs240 | Course detail — the grade-back loop, rules panel, "show the math" |
| http://localhost:3000/dashboard/add | Paste-your-schedule intake (click *use a sample paste*) |

`.env.local` is created for you with `NEXT_PUBLIC_API_MODE=mock`. Marks live in
memory, so a reload resets them.

### Things worth trying

- On **CS 240**, type a mark into **Final Exam** and watch the course grade and the
  achievable range move as you type.
- On any assessment, switch the status between **Excused** and **Missed**. The same
  item gives very different grades — excused removes its weight from the denominator,
  missed is a real zero. That distinction is the reason a passing student is never
  displayed as failing.
- Untick **Best 4 of 5 quizzes count** in the rules panel and watch the grade change,
  then read *Show the math* to see exactly what the engine did.
- On the dashboard, change **Aim for** to `90` — it reports the target as unreachable
  and gives the maximum achievable instead of a required average over 100%.

### Tests

```bash
npm test          # engine + API unit tests
npm run typecheck
```

## ⚠ Do not apply the v2 migrations yet

`supabase/migrations/03_v2_catalog.sql` renames `courses` → `catalog_courses` and
`assessments` → `catalog_assessments`. The **v1 pages** (`/`, `/calculator`,
`/course/[code]`) still query the old names, so applying the migrations breaks them
until those pages are ported to `lib/api`.

Order to unblock that: port the v1 pages to `lib/api` → implement `lib/api/live/` →
apply migrations to a **dev** Supabase project → flip `NEXT_PUBLIC_API_MODE=live`.
