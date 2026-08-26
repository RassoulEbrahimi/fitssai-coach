# AI feedback — retired

> **Status: historical.** Nothing described here runs. The implementation was
> removed in PR46 (Phase 2). This file is kept as a record of what once existed
> and why it was withdrawn, so the Phase 2 backend work does not rebuild it by
> accident.

## What this document used to claim

An earlier revision described an `ai_feedback` **Postgres table** with row-level
security policies, read and written through `@supabase/supabase-js`, feeding a
`generate-day-suggestions` **Supabase Edge Function** that adjusted prompts from
the user's last 20 ratings. Every step was marked "✅ Implemented".

None of that was true of this repository at the time it was written down, and
none of it is true now:

- FitssAI runs on **Firebase (Auth + Firestore)**. There is no Postgres, so
  there are no tables, no RLS policies and no SQL triggers.
- `@supabase/supabase-js` is **not a dependency** and cannot be imported.
- There are **no Edge Functions and no Cloud Functions** of any kind. The repo
  contains no `functions/` directory, no `firebase.json` and no `.firebaserc`.
- The client-side helpers had already been reduced to stubs: `saveAIFeedback()`
  threw unconditionally, and `getUserFeedbackSummary()` returned all zeros.

## What was removed in PR46

`WorkoutFeedbackCard` collected a rating (👍 Super / 🥵 Zu schwer / 😴 Zu leicht /
👎 Nicht mein Stil) and `await`ed `saveAIFeedback()` with no `catch`. Because
that function always threw, tapping "Feedback senden" produced no confirmation
and no error — the interaction simply did nothing. Rather than keep a control
that could only fail, the card and both stub modules were deleted:

- `src/components/feedback/WorkoutFeedbackCard.tsx`
- `src/integrations/supabase/tables/ai_feedback.ts`
- `src/integrations/supabase/ai_adaptation.ts`
- `src/lib/adaptivePrompt.ts` (already imported by nothing)

**No feedback has ever been persisted on the Firebase stack.** There is no
`ai_feedback` collection in Firestore to migrate or read.

## If feedback is rebuilt

The idea — learn intensity preference from post-workout ratings — is still
sound, and Phase 2 may revisit it. Rebuilt on this stack it would need:

1. A Firestore collection (e.g. `users/{uid}/workout_feedback`) with security
   rules committed to this repository. Rules are currently **not** in version
   control.
2. A write path that surfaces failure to the user instead of swallowing it.
3. A UI entry point that appears only where feedback can actually be stored.

Aggregation and any prompt adjustment belong **server-side**, not in the client
bundle. Nothing should be reintroduced from the Supabase design above without
being redesigned for Firestore first.
