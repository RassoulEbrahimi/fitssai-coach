# 🧠 AI Feedback Table

The `ai_feedback` table stores user interactions with AI-generated workout suggestions.

## Columns

- **id** → UUID primary key (auto-generated)
- **user_id** → UUID linked to `auth.users` (cascade delete)
- **suggestion_id** → UUID identifying which AI suggestion was rated
- **accepted** → Boolean indicating whether the user accepted the suggestion
- **reason** → Text field for user's feedback (e.g., "zu schwer", "nicht mein Stil")
- **created_at** → Timestamp when feedback was created
- **updated_at** → Timestamp when feedback was last updated (auto-updated via trigger)

## Indexes

- `idx_ai_feedback_user_id` on `user_id` for efficient user-based queries
- `idx_ai_feedback_suggestion_id` on `suggestion_id` for suggestion-based lookups

## Row Level Security (RLS)

Users can only:
- View their own feedback
- Create feedback for themselves
- Update their own feedback
- Delete their own feedback

## Usage Example

```typescript
import { saveAIFeedback, getAIFeedbackByUser } from "@/integrations/supabase/tables/ai_feedback";

// Save feedback when user accepts/rejects a workout
await saveAIFeedback({
  user_id: user.id,
  suggestion_id: workout.id,
  accepted: false,
  reason: "zu schwer",
});

// Retrieve all feedback for a user
const userFeedback = await getAIFeedbackByUser(user.id);
```

## Integration with Adaptive Learning

This table serves as the foundation for the Adaptive Learning System (Phase 10.15):

### ✅ Step 1: Store feedback (Implemented)
The `ai_feedback` table with RLS policies and helper functions.

### ✅ Step 2: Add UI for collecting feedback (Implemented)
**WorkoutFeedbackCard** (`src/components/feedback/WorkoutFeedbackCard.tsx`)
- Emoji-based feedback collection (👍 Super, 🥵 Zu schwer, 😴 Zu leicht, 👎 Nicht mein Stil)
- Optional text feedback for detailed reasons
- Appears after completed AI-generated workouts

### ✅ Step 3: Analyze patterns and adjust AI prompts (Implemented)

**Data Aggregation** (`src/integrations/supabase/ai_adaptation.ts`)

Analyzes the last 20 feedback entries to identify patterns:
- `super` (positive feedback) → reinforce current style
- `hard` (too difficult) → reduce intensity
- `light` (too easy) → increase intensity  
- `notstyle` (not their style) → vary the workout type

```ts
const feedback = await getUserFeedbackSummary(userId);
// Returns: { super: 5, hard: 2, light: 1, notstyle: 0, total: 8 }

const insight = getFeedbackInsight(feedback);
// Returns: "Aktueller Stil wird beibehalten"
```

**Adaptive Prompts** (`src/lib/adaptivePrompt.ts`)

The `buildAdaptivePrompt()` function enhances the base AI prompt with personalized adjustments:

```ts
const adaptivePrompt = await buildAdaptivePrompt(user.id, basePrompt);
// Automatically adds intensity adjustments, style variations, etc.
```

**Edge Function Integration**

The `generate-day-suggestions` edge function automatically applies adaptive adjustments:

1. Fetches user feedback history (last 20 entries)
2. Analyzes patterns (hard vs light, style preferences)
3. Adjusts the AI prompt accordingly
4. Generates personalized workout suggestions

Example adjustment patterns:
- If user marked workouts as "hard" 3+ times → reduce intensity by 10-15%
- If user marked workouts as "light" 3+ times → increase intensity
- If user rejected style 3+ times → add variety and new exercises
- If user consistently accepts (70%+) → maintain current approach

**UI Indicator** (`src/components/ui/AdaptiveHint.tsx`)
- Visual indicator showing adaptive learning in action
- Displays: "🤖 Lernt aus deinem Feedback: [insight message]"
- Shows when generating new workouts with feedback data

### Data Flow

```
User completes workout
  ↓
WorkoutFeedbackCard shown
  ↓
User provides feedback (accepted/reason)
  ↓
Saved to ai_feedback table
  ↓
Next AI generation request
  ↓
Edge function fetches last 20 feedback entries
  ↓
Analyzes patterns and adjusts prompt
  ↓
Generates personalized workout
  ↓
AdaptiveHint shows applied adjustments
```

### Benefits

- **Automatic personalization**: No manual tuning required
- **Learns over time**: Gets better with each feedback entry
- **Transparent**: Users see how their feedback influences AI
- **Privacy-focused**: All data stays in user's own database

## Future Enhancements

- Weight progression tracking based on "zu leicht" feedback
- Equipment preference learning
- Time-of-day optimization
- Recovery pattern recognition
- Long-term goal tracking and adaptation
- Sentiment analysis on `reason` field
- Track acceptance rate trends over time
- Correlate feedback with workout completion rates
