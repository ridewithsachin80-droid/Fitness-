import { useNavigate } from 'react-router-dom';
import AILauncher from '../components/member/AILauncher';
import DailyEssentials from '../components/member/DailyEssentials';
import ThemeToggle from '../components/member/ThemeToggle';
import useTodayModel from '../hooks/useTodayModel';
import { Card, OfflineBanner, MemberBottomNav } from '../components/UI';
import { SkeletonCard, Icon, Collapsible } from '../components/primitives';
import { haptic } from '../store/settingsStore';
import AIChatLog from '../components/AIChatLog';
import { useAIChat } from '../store/aiChatStore';
import InstallPrompt from '../components/InstallPrompt';
import PendingSync   from '../components/PendingSync';
import PushPrimer    from '../components/PushPrimer';
import Greeting      from '../components/today/Greeting';
import DateNav       from '../components/today/DateNav';
import AIRead        from '../components/today/AIRead';
import NotesRow      from '../components/today/NotesRow';
import Timeline      from '../components/today/Timeline';
import CoachNotes    from '../components/today/CoachNotes';
import MilestoneModal from '../components/today/MilestoneModal';
import RecoveryCard  from '../components/today/RecoveryCard';
import NextUp        from '../components/today/NextUp';
import ProgressPhotoCard from '../components/progress/ProgressPhotoCard';
import CheckinCard from '../components/checkin/CheckinCard';
import VoicePilotCard from '../components/voicepilot/VoicePilotCard';
import LogPlannedSheet from '../components/sheets/LogPlannedSheet';
import PlatePhotoSheet from '../components/sheets/PlatePhotoSheet';
import { FastingBar } from '../components/today/DayWidgets';
import { nextAction, istHour } from '../lib/day';
import { WeightSheet, WaterSheet, SleepSheet, ProtocolSheet, FoodSheet, WorkoutSheet, NutritionSheet, MealIdeaSheet } from '../components/sheets';

/** Member home: one daily overview, three navigation destinations and an
 * on-demand AI workspace. All manual sheets and coach services share the
 * original useTodayModel; the complete plan remains one tap away. */
export default function Today() {
  const m = useTodayModel();
  const navigate = useNavigate();
  const openChat = useAIChat(s => s.openChat);
  const { log, protocol, loading, isToday, sheet, openSheet, closeSheet, terms, ageMode } = m;

  return (
    <div className="min-h-screen bg-charcoal font-sans member-home">
      <OfflineBanner />
      <header className="member-header">
        <div className="member-brandbar"><span className="member-wordmark">FitLife<span /></span><ThemeToggle /></div>
        <Greeting user={m.user} avatar={null} autoSaved={m.autoSaved} queued={m.queued} error={m.error}
          streak={m.streak} streakIsBest={m.streakIsBest} isToday={isToday} weekNumber={m.weekNumber} date={m.date} />
        <PendingSync /><PushPrimer hasLogged={m.hasLoggedAnything} />
        <DateNav date={m.date} isToday={isToday} onPrev={m.goPrevDay} onNext={m.goNextDay} onToday={m.goToday} />
      </header>
      <main className="member-content">
        {loading ? <><SkeletonCard lines={3} /><SkeletonCard lines={4} /></> : <>
          <div className="member-stack">
            {isToday ? <AILauncher /> : <Card><p className="text-sm text-mid">You are viewing an earlier day. Manual edits stay on this date.</p><button type="button" className="member-link" onClick={m.goToday}>Return to today for AI logging <Icon name="arrow-right" size={16} /></button></Card>}
            {isToday && m.mealPlans?.length > 0 && <NextUp mealPlans={m.mealPlans} food={log.food} terms={terms}
              onLog={m.openPlanned} onSnap={m.openPlate} onOther={() => openChat('text')} />}
            <section><div className="member-section-title">Your daily essentials <span className="text-caption text-lo">Tap to view or edit</span></div>
              <DailyEssentials m={m} onOpen={openSheet} />
            </section>
            <button type="button" className="member-weight" data-testid="hero-weight" onClick={() => openSheet('weight')}>
              <Icon name="scale" size={20} /><span>Weight</span><strong>{log.weight || '—'} <span className="text-caption text-lo">kg</span></strong>
              {m.weightDelta != null && <span className="weight-change">{m.weightDelta < 0 ? '↓' : '↑'} {Math.abs(m.weightDelta)} kg</span>}<small>Update</small>
            </button>
            <div className="member-links">
              <button type="button" className="member-link" onClick={() => openSheet('protocol')} data-testid="plan-recover"><Icon name="check" size={18} /><span>Daily checklist <small>· {m.protocolDone} of {m.protocolTotal} done</small></span><Icon name="chevron-right" size={15} /></button>
              <button type="button" className="member-link" onClick={() => navigate('/plan')}><Icon name="calendar" size={18} /><span>View your complete plan <small>· meals, training & recovery</small></span><Icon name="chevron-right" size={15} /></button>
              <button type="button" className="member-link" onClick={() => openSheet('nutrition')} data-testid="chip-nutrition"><Icon name="pill" size={18} /><span>Nutrition & micronutrients</span><Icon name="chevron-right" size={15} /></button>
              <button type="button" className="member-link" onClick={() => openSheet('mealidea')} data-testid="chip-mealidea"><Icon name="food" size={18} /><span>What could I eat next?</span><Icon name="chevron-right" size={15} /></button>
            </div>
          </div>
          <div className="member-stack">
            <AIRead read={m.read} onOpenChat={() => openChat()} onOpen={openSheet}
              action={nextAction({ isToday, hour: istHour(), weight: log.weight, foodCount: (log.food || []).length,
                waterMl: log.water || 0, waterTarget: protocol?.water_target || 3000, protocolDone: m.protocolDone, protocolTotal: m.protocolTotal,
                sleepSet: !!(log.sleep?.bedtime && log.sleep?.waketime), workoutPlanned: !!m.coachPlan?.todayDay,
                workoutLogged: (m.workoutSummary.count || 0) > 0 || (m.workoutSummary.cardio || []).length > 0 })} />
            <CoachNotes m={m} />
            {isToday && <><ProgressPhotoCard /><CheckinCard /><VoicePilotCard /><RecoveryCard today={m.date} /></>}
            {!protocol && <Card><h2 className="font-display text-xl mb-2">Welcome to FitLife</h2><p className="text-sm text-mid">Your coach will set up your personalised plan. You can already log food, weight, water and sleep.</p></Card>}
            <Card><Collapsible title={isToday ? 'Logged today' : 'Logged that day'} summary="Review your entries, make a correction" icon="note" defaultOpen>
              <section data-testid="logged-section"><Timeline m={m} onOpen={openSheet} onOpenChat={() => openChat()} /></section>
            </Collapsible><div id="section-notes"><NotesRow value={log.notes} onChange={v => m.update('notes', v)} label={terms.notes}
              placeholder={ageMode === 'child' ? 'How did you feel today?' : 'Symptoms, energy, how you felt…'} /></div></Card>
            {protocol?.fasting && (() => {
              const isMinor = m.profileAge !== null && m.profileAge < 18;
              const hasRisk = ['pre_diabetic', 'insulin_resist', 'hypothyroid'].some(c => (protocol?.conditions || []).includes(c));
              return isMinor || hasRisk ? <Card><p className="text-sm text-warn">Fasting protocol — check with your doctor</p><p className="text-caption text-mid">{isMinor ? 'Fasting is not recommended for people under 18.' : 'Your health conditions may require a modified approach.'} Confirm your protocol is approved before following it.</p></Card> : <FastingBar fasting={protocol.fasting} />;
            })()}
          </div>
        </>}
      </main>
      <AIChatLog mealPlans={m.mealPlans} onLogPlanned={m.openPlanned} overlay />

      <WeightSheet    open={sheet === 'weight'}    onClose={closeSheet} m={m} />
      <WaterSheet     open={sheet === 'water'}     onClose={closeSheet} m={m} />
      <SleepSheet     open={sheet === 'sleep'}     onClose={closeSheet} m={m} />
      <ProtocolSheet  open={sheet === 'protocol'}  onClose={closeSheet} m={m} />
      <FoodSheet      open={sheet === 'food'}      onClose={closeSheet} m={m} />
      <WorkoutSheet   open={sheet === 'workout'}   onClose={closeSheet} m={m} />
      <NutritionSheet open={sheet === 'nutrition'} onClose={closeSheet} m={m} />
      <MealIdeaSheet   open={sheet === 'mealidea'}  onClose={closeSheet} m={m} />
      <LogPlannedSheet meal={m.plannedMeal} onClose={m.closePlanned} m={m} />
      <PlatePhotoSheet job={m.plateJob} onClose={m.closePlate} onRetake={m.openPlate} m={m} />

      <MemberBottomNav />
      <InstallPrompt />
      <MilestoneModal milestone={m.milestone} onClose={() => { haptic(10); m.setMilestone(null); }} />
    </div>
  );
}
