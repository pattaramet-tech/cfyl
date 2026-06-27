@AGENTS.md

# Project Status

## In Progress

### Admin Match Management Feature (/admin/matches/manage)
- **Status**: Priority A ✅ + Priority B ✅ Complete
- **Priority A - Foundation (Done)**:
  - Match selector (Season/AgeGroup/Division/Match dropdown)
  - Match summary display
  - Score editor with status dropdown
  - Goals manager (reused GoalsList component)
  - Cards manager (add/delete card UI)
  - Finish validation (score vs goals consistency check)
  - Preserve selected match across filter changes
- **Priority B - Polish & Mobile (Done)**:
  - Mobile responsive design (stack layouts, adjusted padding/text sizes)
  - Thai labels & messages (ฤดูกาล, ระดับอายุ, สัญชาติ, ประตู, ใบเรียบร้อย, etc.)
  - Auto-hide success/error messages (3.5s for success, 4s for error)
  - Finish validation modal (visual card showing goal/score mismatch with colors)
  - Loading state for match data (spinner + disabled inputs)
  - Player list fallback when empty
  - Null checks for team names & player info (default fallbacks)
  - Public sync reminder in success message
  - Better edge case handling (minute=0 displays correctly, undefined/null team names handled)
- **Files changed**: app/admin/matches/manage/page.tsx
- **API used**: /api/admin/matches/[id] PUT, /api/admin/goals, /api/admin/cards
- **Constraints**: No schema changes, no new packages, reuse existing components
- **Build**: ✓ Compiled successfully, 4 lint warnings (React Compiler memoization - existing pattern, not critical)
