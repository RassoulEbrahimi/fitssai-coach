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
1. **Step 1**: Store feedback (current implementation)
2. **Step 2**: Add UI for collecting feedback
3. **Step 3**: Analyze patterns and adjust AI prompts based on historical feedback
4. **Step 4**: Implement feedback loops for continuous improvement

## Future Enhancements

- Add sentiment analysis on `reason` field
- Track acceptance rate trends over time
- Correlate feedback with workout completion rates
- Use feedback to fine-tune AI prompt generation
