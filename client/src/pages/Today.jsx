import useTodayModel from '../hooks/useTodayModel';
import { Card, OfflineBanner, MemberBottomNav } from '../components/UI';
import { HeroNumber, SkeletonCard, Skeleton, Eyebrow } from '../components/primitives';
import { haptic } from '../store/settingsStore';
import AIChatLog, { useAIChat } from '../components/AIChatLog';
import InstallPrompt from '../components/InstallPrompt';
import StreakCard    from '../components/StreakCard';
import PendingSync   from '../components/PendingSync';
import PushPrimer    from '../components/PushPrimer';
import Greeting      from '../components/today/Greeting';
import DateNav       from '../components/today/DateNav';
import AIRead        from '../components/today/AIRead';
import ProtocolDots  from '../components/today/ProtocolDots';
import DayStrip      from '../components/today/DayStrip';
import Timeline      from '../components/today/Timeline';
import CoachCard     from '../components/today/CoachCard';
import CoachNotes    from '../components/today/CoachNotes';
import MilestoneModal from '../components/today/MilestoneModal';
import { FastingBar } from '../components/today/DayWidgets';
import { WeightSheet, WaterSheet, SleepSheet, ProtocolSheet, FoodSheet, WorkoutSheet, NutritionSheet } from '../components/sheets';

/**
 * Today — the member's home screen (Sprint 3).
 *
 * One scrolling surface, in reading order:
 *   greeting → date → the ONE number (weight) → today's read → protocol dots
 *   → day strip → from your coach → timeline → streak → coach messages
 *   → fasting → notes
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
            streak={m.streak} streakIsBest={m.streakIsBest} isToday={isToday} />
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

      <main className="max-w-md mx-auto px-4 space-y-3 pb-20">
        {loading ? (
          <>
            <SkeletonCard lines={1} />
            <Skeleton className="h-[72px]" />
            <div className="flex gap-2"><Skeleton className="h-[74px] w-32 flex-shrink-0" /><Skeleton className="h-[74px] w-32 flex-shrink-0" /><Skeleton className="h-[74px] w-32 flex-shrink-0" /></div>
            <SkeletonCard lines={3} />
          </>
        ) : (
          <>
            <AIRead read={m.read} onOpenChat={() => openChat()} />

            <ProtocolDots activeActivities={m.activeActivities} activeACV={m.activeACV} activeSupplements={m.activeSupplements}
              log={log} done={m.protocolDone} total={m.protocolTotal} terms={terms} onOpen={() => openSheet('protocol')} />

            {m.balance != null && (
              <button type="button" onClick={() => openSheet('food')} data-testid="balance-chip"
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 border active:scale-95 transition-transform ${
                  m.balance > 0 ? 'bg-amber-400/10 border-amber-400/30' : 'bg-ok/10 border-ok/30'}`}>
                <span className={`text-caption font-extrabold tabular-nums ${m.balance > 0 ? 'text-amber-300' : 'text-gold-light'}`}>
                  {m.balance > 0 ? '↑ +' : '↓ −'}{Math.abs(m.balance).toLocaleString('en-IN')} kcal
                </span>
                <span className="text-micro font-medium text-mute">{m.balance > 0 ? 'surplus' : 'deficit'} so far</span>
              </button>
            )}

            <DayStrip m={m} onOpen={openSheet} />

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

            <CoachCard rows={m.coachRows} coachPlan={m.coachPlan} protocol={protocol} onOpen={openSheet} />

            <Card>
              <Eyebrow className="mb-2">{isToday ? 'Today so far' : 'That day'}</Eyebrow>
              <Timeline m={m} onOpen={openSheet} onOpenChat={() => openChat()} />
            </Card>

            {/* The conversation. Its composer is docked above the nav (portaled
                from inside AIChatLog), so it is reachable from anywhere on the page. */}
            <Card>
              <AIChatLog />
            </Card>

            <StreakCard />
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

            <Card>
              <div id="section-notes" />
              <Eyebrow className="mb-2">{terms.notes}</Eyebrow>
              <textarea value={log.notes} onChange={e => m.update('notes', e.target.value)} data-testid="notes"
                placeholder={ageMode === 'child' ? 'How did you feel today? What was fun?' : 'Symptoms, how you felt, energy levels, challenges…'} rows={3}
                className="w-full text-sm border border-white/[0.12] rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gold/30 resize-none" />
            </Card>
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
