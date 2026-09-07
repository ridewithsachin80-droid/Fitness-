import { Sheet, Pressable } from '../primitives';
import WorkoutLog from '../WorkoutLog';

/**
 * WorkoutSheet — the Workout log in a full-height sheet.
 *
 * The `key` remounts WorkoutLog when the date changes or the AI chat closes
 * (workoutRefreshKey), so an open sheet never shows sets the AI just wrote as
 * stale. Same rule as the old inline panel.
 */
export default function WorkoutSheet({ open, onClose, m }) {
  const { date, workoutRefreshKey, loading, coachPlan } = m;
  return (
    <Sheet open={open && !loading} onClose={onClose} snap="full" eyebrow="Workout"
      title={coachPlan?.todayDay ? coachPlan.todayDay.day_label : 'Log your session'}
      footer={<Pressable variant="primary" className="w-full" onPress={onClose}>Done</Pressable>}>
      <div id="section-workout">
        <WorkoutLog key={`${date}-${workoutRefreshKey}`} date={date} />
      </div>
    </Sheet>
  );
}
