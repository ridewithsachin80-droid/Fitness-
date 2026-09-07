import useTodayModel from '../hooks/useTodayModel';
import { Card, OfflineBanner, MemberBottomNav } from '../components/UI';
import { HeroNumber, SkeletonCard, Skeleton, Eyebrow } from '../components/primitives';
import { haptic } from '../store/settingsStore';
import AIChatLog, { useAIChat } from '../components/AIChatLog';
import InstallPrompt from '../components/InstallPrompt';
import PendingSync   from '../components/PendingSync';
import PushPrimer    from '../components/PushPrimer';
import Greeting      from '../components/today/Greeting';
import DateNav       from '../components/today/DateNav';
import AIRead        from '../components/today/AIRead';
import TodaysPlan    from '../components/today/TodaysPlan';
import NotesRow      from '../components/today/NotesRow';
import Timeline      from '../components/today/Timeline';
import CoachNotes    from '../components/today/CoachNotes';
import MilestoneModal from '../components/today/MilestoneModal';
import { FastingBar } from '../components/today/DayWidgets';
import { nextAction } from '../lib/day';
import { WeightSheet, WaterSheet, SleepSheet, ProtocolSheet, FoodSheet, WorkoutSheet, NutritionSheet } from '../components/sheets';

/**
 * Today — the member's home screen (Sprint 3 → 5b).
 *
 * One scrolling surface, in reading order (Sprint 5b, "Today v2"):
 *   greeting + date · week N → the ONE number (weight) → today's read with one
 *   action → Today's Plan (Move · Eat · Recover, dots inside Recover)
 *   → the AI thread → logged today → streak → coach messages → fasting → notes
 * Today's Plan replaced the coach card, the four tiles, the deficit chip and
 * the dots card — one section instead of four competing for the same screen.
 * Every logging action is a bottom sheet (components/sheets/), never an
 * inline drawer that pushes the page around.
 *
 * Sprint 4: the AI is on the page. <AIChatLog /> renders the conversation as
 * the "Ask FitLife" card below the timeline and docks the composer (text, mic,
 * camera, lab report) above the bottom nav on every scroll position. The ✨
 * orb, Today's read, the timeline's empty state and the sheets' "Log with AI"
 * banners all call openChat(), which closes any sheet, scrolls the thread into
 * view and focuses the composer.
 *
 * All state and saving is in hooks/useTodayModel.js — this file only lays
 * things out. If a number looks wrong, the bug is in the hook or lib/day,
 * not here.
 */
export default function Today() {
  const m = useTodayModel();
  const openChat = useAIChat(s => s.openChat);
  const { log, protocol, loading, isToday, sheet, openSheet, closeSheet, terms, ageMode } = m;

  return (
    <div className="min-h-screen bg-charcoal font-sans">
      <OfflineBanner />

      <header className="px-4 pt-8 pb-4 bg-gradient-to-b from-surface to-charcoal">
        <div className="max-w-md mx-auto">
          <Greeting user={m.user} avatar={m.avatar} autoSaved={m.autoSaved} queued={m.queued} error={m.error}
            streak={m.streak} streakIsBest={m.streakIsBest} isToday={isToday} weekNumber={m.weekNumber} date={m.date} />
          <PendingSync />
          <PushPrimer hasLogged={m.hasLoggedAnything} />
          <DateNav date={m.date} isToday={isToday} onPrev={m.goPrevDay} onNext={m.goNextDay} onToday={m.goToday} />

          {/* The one number. Tap to log or correct it. */}
          <button type="button" onClick={() => openSheet('weight')} data-testid="hero-weight"
            className="w-full text-left mt-5 active:scale-[0.99] transition-transform">
            {loading ? (
              <Skeleton className="h-12 w-40" />
            ) : log.weight ? (
              <HeroNumber value={parseFloat(log.weight)} unit="kg" delta={m.weightDelta} deltaUnit=" kg"
                label={m.weightDelta == null ? (isToday ? 'this morning' : 'that morning') : 'vs yesterday'} />
            ) : (
              <HeroNumber value="—" unit="kg" placeholder label={isToday ? 'Tap to log this morning\u2019s weight' : 'No weight logged'} />
            )}
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 space-y-3 pb-32">
        {loading ? (
          <>
            <SkeletonCard lines={1} />
            <Skeleton className="h-[72px]" />
            <div className="flex gap-2"><Skeleton className="h-[74px] w-32 flex-shrink-0" /><Skeleton className="h-[74px] w-32 flex-shrink-0" /><Skeleton className="h-[74px] w-32 flex-shrink-0" /></div>
            <SkeletonCard lines={3} />
          </>
        ) : (
          <>
            <AIRead read={m.read} onOpenChat={() => openChat()} onOpen={openSheet}
              action={nextAction({
                isToday, hour: new Date().getHours(),
                weight: log.weight, foodCount: (log.food || []).length,
                waterMl: log.water || 0, waterTarget: protocol?.water_target || 3000,
                protocolDone: m.protocolDone, protocolTotal: m.protocolTotal,
                sleepSet: !!(log.sleep?.bedtime && log.sleep?.waketime),
                workoutPlanned: !!m.coachPlan?.todayDay,
                workoutLogged: (m.workoutSummary.count || 0) > 0 || (m.workoutSummary.cardio || []).length > 0,
              })} />

            <TodaysPlan m={m} onOpen={openSheet} />

            {!protocol && (
              <Card>
                <div className="text-center py-3">
                  <h2 className="font-display text-xl font-medium text-white mb-1">Welcome to FitLife</h2>
                  <p className="text-sm text-mid leading-relaxed">
                    Your coach will set up your personalised protocol shortly — activities, supplements, macros and water target will appear here.
                  </p>
                  <p className="text-caption text-lo mt-3">You can already log your weight, food and water.</p>
                </div>
              </Card>
            )}

            <section className="px-1 pt-2" data-testid="logged-section">
              <Eyebrow className="mb-1">{isToday ? 'Logged today' : 'Logged that day'}</Eyebrow>
              <Timeline m={m} onOpen={openSheet} onOpenChat={() => openChat()} />
            </section>

            {/* The conversation. Its composer is docked above the nav (portaled
                from inside AIChatLog), so it is reachable from anywhere on the page. */}
            <Card>
              <AIChatLog />
            </Card>

            <CoachNotes m={m} />

            {protocol?.fasting && (() => {
              const isMinor = m.profileAge !== null && m.profileAge < 18;
              const hasRisk = ['pre_diabetic', 'insulin_resist', 'hypothyroid'].some(c => (protocol?.conditions || []).includes(c));
              if (isMinor || hasRisk) {
                return (
                  <div className="bg-amber-400/10 border border-amber-400/20 rounded-2xl px-4 py-3" role="note">
                    <p className="text-xs font-bold text-amber-400 mb-1">Fasting protocol — check with your doctor</p>
                    <p className="text-xs text-mid leading-relaxed">
                      {isMinor ? 'Fasting is not recommended for people under 18.' : 'Your health conditions may require a modified fasting approach.'} Please confirm this protocol is approved by your doctor.
                    </p>
                  </div>
                );
              }
              return <FastingBar fasting={protocol.fasting} />;
            })()}

            <div id="section-notes" className="px-1">
              <NotesRow value={log.notes} onChange={v => m.update('notes', v)} label={terms.notes}
                placeholder={ageMode === 'child' ? 'How did you feel today? What was fun?' : 'Symptoms, how you felt, energy levels, challenges…'} />
            </div>
          </>
        )}
      </main>

      <WeightSheet    open={sheet === 'weight'}    onClose={closeSheet} m={m} />
      <WaterSheet     open={sheet === 'water'}     onClose={closeSheet} m={m} />
      <SleepSheet     open={sheet === 'sleep'}     onClose={closeSheet} m={m} />
      <ProtocolSheet  open={sheet === 'protocol'}  onClose={closeSheet} m={m} />
      <FoodSheet      open={sheet === 'food'}      onClose={closeSheet} m={m} />
      <WorkoutSheet   open={sheet === 'workout'}   onClose={closeSheet} m={m} />
      <NutritionSheet open={sheet === 'nutrition'} onClose={closeSheet} m={m} />

      <MemberBottomNav />
      <InstallPrompt />
      <MilestoneModal milestone={m.milestone} onClose={() => { haptic(10); m.setMilestone(null); }} />
    </div>
  );
}
