import { useNavigate } from 'react-router-dom';
import AILauncher from '../components/member/AILauncher';
import DailyEssentials from '../components/member/DailyEssentials';
import WhatsNew from '../components/member/WhatsNew';
import ThemeToggle from '../components/member/ThemeToggle';
import NotificationBell from '../components/NotificationBell';
import useTodayModel from '../hooks/useTodayModel';
import useScrolledPast from '../hooks/useScrolledPast';
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
 * original useTodayModel; the complete plan remains in Plan & tools. */
export default function Today() {
  const m = useTodayModel();
  const navigate = useNavigate();
  const openChat = useAIChat(s => s.openChat);
  const composerOpen = useAIChat(s => s.composerOpen);
  const { log, protocol, loading, isToday, sheet, openSheet, closeSheet, terms, ageMode } = m;
  // The logging bar slims down to one row once the member scrolls (16 Oct
  // 2026): the bar plus the tabs took a sixth of the screen. Still tappable.
  const slim = useScrolledPast(120);

  return (
    <div className="min-h-screen bg-charcoal font-sans member-home">
      <OfflineBanner />
      <header className="member-header">
        <div className="member-brandbar"><span className="member-wordmark">fitlife</span><div className="member-header-tools"><NotificationBell /><ThemeToggle /></div></div>
        {/* One line, not a greeting + a big "Your day." (16 Oct 2026): the
            Weight and Sleep tiles now sit above the logging bar on a phone. */}
        <div className="member-hello">
          <Greeting compact user={m.user} avatar={null} autoSaved={m.autoSaved} queued={m.queued} saving={m.saving} error={m.error} onRetry={m.retrySave}
            streak={m.streak} streakIsBest={m.streakIsBest} isToday={isToday} weekNumber={m.weekNumber} date={m.date} />
          {isToday && m.streak >= 2 && <span className="member-streak" data-testid="today-streak" aria-label={`${m.streak}-day streak`}>🔥 {m.streak}</span>}
        </div>
        <PendingSync />
      </header>
      <main className="member-content" data-testid="member-main">
        {loading ? <><SkeletonCard lines={3} /><SkeletonCard lines={4} /></> : <>
          <div className="member-overview">
            {isToday && <WhatsNew />}
            <section className="member-snapshot" aria-label="Daily summary">
              <DateNav compact date={m.date} isToday={isToday} onPrev={m.goPrevDay} onNext={m.goNextDay} onToday={m.goToday} />
              <DailyEssentials m={m} onOpen={openSheet} />
            </section>
            {/* The coach's meal plan for today, open — one tap to log a planned meal (as in production). */}
            {isToday && m.mealPlans?.length > 0 && <div className="member-nextup"><NextUp mealPlans={m.mealPlans} food={log.food} terms={terms}
              onLog={m.openPlanned} onSnap={m.openPlate} onOther={() => openChat('text')} /></div>}
            {/* The coach, open on Today (Sachin, 16 Oct 2026): unread messages first, else today's read. */}
            <div className="member-coach-line" data-testid="coach-line">
              {m.unreadNotes?.length ? <CoachNotes m={m} /> :
                <AIRead read={m.read} onOpenChat={() => openChat()} onOpen={openSheet}
                  action={nextAction({ isToday, hour: istHour(), weight: log.weight, foodCount: (log.food || []).length,
                    waterMl: log.water || 0, waterTarget: protocol?.water_target || 3000, protocolDone: m.protocolDone, protocolTotal: m.protocolTotal,
                    sleepSet: !!(log.sleep?.bedtime && log.sleep?.waketime), workoutPlanned: !!m.coachPlan?.todayDay,
                    workoutLogged: (m.workoutSummary.count || 0) > 0 || (m.workoutSummary.cardio || []).length > 0 })} />}
            </div>
            <PushPrimer hasLogged={m.hasLoggedAnything} />
            {/* AI logging works on any day up to today (16 Oct 2026); the save names the day. */}
            <div className={`member-home-logger${slim ? ' is-slim' : ''}`}><AILauncher /></div>
          </div>
          <div className="member-details">
            {/* The next three habits, not "0 of 16" (16 Oct 2026). */}
            <Collapsible defaultOpen={m.detailSection === 'plan'} title="Plan & tools"
              summary={m.protocolTotal > 0 && m.protocolDone < m.protocolTotal && m.pending?.length
                ? `Next: ${m.pending.slice(0, 3).join(' · ')}`
                : m.protocolTotal > 0 ? `All ${m.protocolTotal} daily habits done ✓` : 'Your plan, nutrition and meal ideas'} icon="calendar" testId="home-plan-details">
            <div className="member-links">
              <button type="button" className="member-link" onClick={() => openSheet('protocol')} data-testid="plan-recover"><Icon name="check" size={18} /><span>Daily checklist <small>· {m.protocolDone} of {m.protocolTotal} done</small></span><Icon name="chevron-right" size={15} /></button>
              <button type="button" className="member-link" onClick={() => navigate('/plan')}><Icon name="calendar" size={18} /><span>View your complete plan <small>· meals, training & recovery</small></span><Icon name="chevron-right" size={15} /></button>
              <button type="button" className="member-link" onClick={() => openSheet('nutrition')} data-testid="chip-nutrition"><Icon name="pill" size={18} /><span>Nutrition & micronutrients{m.micro?.hasData && m.micro.known > 0 ? <small> · {m.micro.met}/{m.micro.total} met{m.micro.unknown ? ` · ${m.micro.unknown} not known` : ''}</small> : null}</span><Icon name="chevron-right" size={15} /></button>
              <button type="button" className="member-link" onClick={() => openSheet('mealidea')} data-testid="chip-mealidea"><Icon name="food" size={18} /><span>What could I eat next?</span><Icon name="chevron-right" size={15} /></button>
            </div>
            </Collapsible>
            <Collapsible defaultOpen={m.detailSection === 'log'} title={isToday ? 'Logged today' : 'Logged that day'} summary="Your entries, notes & corrections" icon="note" testId="home-log-details">
              <section data-testid="logged-section"><Timeline m={m} onOpen={openSheet} onOpenChat={() => openChat()} /></section>
              <div id="section-notes"><NotesRow value={log.notes} onChange={v => m.update('notes', v)} label={terms.notes}
                placeholder={ageMode === 'child' ? 'How did you feel today?' : 'Symptoms, energy, how you felt…'} /></div>
            </Collapsible>
            <Collapsible defaultOpen={m.detailSection === 'insights'} title="Check-ins & recovery" summary="Weekly check-in, progress photos and recovery" icon="spark" testId="home-insight-details">
            <div className="member-stack">
            {m.unreadNotes?.length > 0 && <AIRead read={m.read} onOpenChat={() => openChat()} onOpen={openSheet} />}
            {isToday && <><ProgressPhotoCard /><CheckinCard /><VoicePilotCard /><RecoveryCard today={m.date} /></>}
            {!protocol && <Card><h2 className="font-display text-xl mb-2">Welcome to FitLife</h2><p className="text-sm text-mid">Your coach will set up your personalised plan. You can already log food, weight, water and sleep.</p></Card>}
            </div>
            </Collapsible>
          </div>
            {protocol?.fasting && (() => {
              const isMinor = m.profileAge !== null && m.profileAge < 18;
              const hasRisk = ['pre_diabetic', 'insulin_resist', 'hypothyroid'].some(c => (protocol?.conditions || []).includes(c));
              return isMinor || hasRisk ? <Card><p className="text-sm text-warn">Fasting protocol — check with your doctor</p><p className="text-caption text-mid">{isMinor ? 'Fasting is not recommended for people under 18.' : 'Your health conditions may require a modified approach.'} Confirm your protocol is approved before following it.</p></Card> : <FastingBar fasting={protocol.fasting} />;
            })()}
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

      <MemberBottomNav showAIAction={false} />
      <InstallPrompt />
      <MilestoneModal milestone={!sheet && !composerOpen ? m.milestone : null} onClose={() => { haptic(10); m.setMilestone(null); }} />
    </div>
  );
}
