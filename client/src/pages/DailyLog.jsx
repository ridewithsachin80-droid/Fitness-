/**
 * pages/DailyLog.jsx — the member home route.
 *
 * Sprint 3: this file is now a one-line wrapper. The page it used to be
 * (2,100 lines of state, fetches, tiles and inline panels) is split into:
 *   hooks/useTodayModel.js       — every piece of state, effect and save path
 *   pages/Today.jsx              — the new layout
 *   components/today/*           — greeting, read, dots, strip, timeline, cards
 *   components/today/DayWidgets  — FastingBar, MacroProgress, NutritionSummary, PrescribedMeals
 *   components/sheets/*          — one bottom sheet per logging action
 *
 * The file keeps its name and its default export because deploy is drag-drop
 * onto GitHub (adds/overwrites, never deletes) and App.jsx imports it here.
 * The PWA shortcuts (?open=ai / ?open=weight) are handled inside the model.
 */
import Today from './Today';

export default function DailyLog() {
  return <Today />;
}
