import { useRef } from 'react';
import api from '../api/client';
import { today } from '../constants';
import { useAuthStore } from '../store/authStore';
import { useLogStore } from '../store/logStore';
import { useAIChat } from '../store/aiChatStore';
import { haptic } from '../store/settingsStore';
import { mapServerLog } from '../utils/logSync';
import { foodReviewError } from '../utils/aiFoodReview';
import { portionCorrections } from '../utils/householdPortions';
import { rollbackCard } from '../utils/chatCard';
import { nextRequestId } from '../utils/aiRequestRecovery';
import { copy, same, createDailyChange, dailyMatches, reverseDailyChange, canonicalDailyChange,
  normalizedWorkout, definitiveWriteFailure, destinationNeeded, OVERLAP_MESSAGE } from '../utils/aiSaveReceipt';
import { prepareWorkoutChange } from '../utils/aiWorkoutReceipt';

// A request that left this date and came back is still stale. This generation
// survives route unmounts; auth/session and conversation are checked separately.
let dateGeneration = 0;
useLogStore.subscribe((state, previous) => { if (state.date !== previous.date) dateGeneration++; });
const stopped = () => Object.assign(new Error('Review context changed'), { code: 'REVIEW_SCOPE_CHANGED' });
const states = ['daily', 'workout', 'body'];
const acknowledged = state => ['saved', 'queued', 'not-needed'].includes(state);
const owns = receipt => {
  const auth = useAuthStore.getState(), chat = useAIChat.getState();
  return receipt && receipt.owner === (auth.user?.id ?? null) && receipt.sessionVersion === auth.sessionVersion
    && receipt.chatRevision === chat.revision && chat.messages.some(card => card.saveReceipt?.id === receipt.id);
};
const ready = receipt => owns(receipt) && receipt.day === today() && receipt.day === useLogStore.getState().date
  && !useLogStore.getState().loading && useLogStore.getState().error !== 'Failed to load log';

/** A receipt belongs to a review, never to the most recently pressed button.
 * Retrying an acknowledged destination cannot append its entries again. */
export default function useAIReviewSave({ mealSlots, mealPlans, computePending }) {
  const messages = useAIChat(s => s.messages);
  const applying = messages.some(card => card.saveReceipt?.running);
  const applyingRef = useRef(false);
  applyingRef.current = applying;
  const write = (receipt, patch = {}) => {
    if (!owns(receipt)) return;
    useAIChat.getState().setMessages(cards => cards.map(card => card.saveReceipt?.id === receipt.id
      ? { ...card, ...patch, saveReceipt: receipt } : card));
  };
  const message = (index, text) => useAIChat.getState().setMessages(cards => cards.map((card, i) => i === index ? { ...card, saveNotice: text } : card));
  const begin = receipt => {
    if (applyingRef.current || useAIChat.getState().messages.some(card => card.saveReceipt?.running) || !ready(receipt)) return null;
    const generation = dateGeneration;
    receipt.running = true; applyingRef.current = true; write(receipt, { saveNotice: null });
    return () => { if (!ready(receipt) || generation !== dateGeneration) throw stopped(); };
  };
  const finish = receipt => {
    receipt.running = false; applyingRef.current = false;
    // A navigation/account boundary can interrupt after a write was sent.
    // An ambiguous append is never silently retried.
    for (const key of states) {
      if (receipt[key].state === 'saving') receipt[key].state = receipt[key].attempted && key !== 'daily' ? 'unconfirmed' : 'failed';
      if (receipt[key].undoState === 'saving') receipt[key].undoState = key === 'workout' ? 'unconfirmed' : 'failed';
    }
    write(receipt);
  };
  const saveDaily = async (receipt, check, undo = false) => {
    const daily = receipt.daily;
    const result = await useLogStore.getState().saveLog(); check();
    const state = useLogStore.getState();
    if (!result || result.ok === false || state.error) {
      if (undo) daily.undoState = 'failed'; else daily.state = 'failed';
      return false;
    }
    if (undo) {
      if (result.data && !dailyMatches(mapServerLog(result.data), daily.change, 'before')) {
        daily.undoState = 'conflict';
        receipt.undoError = 'The server kept newer daily values. Undo is not confirmed; those values were not claimed or overwritten by this review.';
        write(receipt); return false;
      }
      daily.undoState = result.queued ? 'queued' : 'saved';
    } else {
      daily.state = result.queued ? 'queued' : 'saved';
      if (result.data && !canonicalDailyChange(daily.change, mapServerLog(result.data))) daily.state = 'conflict';
    }
    write(receipt);
    return true;
  };
  const saveWorkout = async (receipt, check) => {
    const dest = receipt.workout;
    if (acknowledged(dest.state) || dest.state === 'conflict') return;
    dest.state = 'saving'; write(receipt);
    try {
      if (!dest.change) dest.change = await prepareWorkoutChange(api, receipt.parsed.workouts.filter(w => w.on), receipt.day, check);
      const { data } = await api.get('/workouts', { params: { date: receipt.day } }); check();
      const current = normalizedWorkout(data, receipt.day);
      if (same(current, dest.change.after)) { dest.state = 'saved'; write(receipt); return; }
      if (!same(current, dest.change.before)) { dest.state = 'conflict'; write(receipt); return; }
      dest.attempted = true;
      await api.post('/workouts', copy(dest.change.after)); check();
      dest.state = 'saved';
    } catch (error) {
      if (error.code === 'REVIEW_SCOPE_CHANGED') throw error;
      dest.state = error.code === 'WORKOUT_CONFLICT' ? 'conflict' : dest.attempted && !definitiveWriteFailure(error) ? 'unconfirmed' : 'failed';
      if (error.code === 'WORKOUT_CONFLICT') dest.detail = error.message;
    }
    write(receipt);
  };
  const saveBody = async (receipt, check) => {
    const dest = receipt.body;
    if (acknowledged(dest.state) || dest.state === 'unconfirmed') return;
    dest.state = 'saving'; write(receipt);
    try {
      check(); dest.attempted = true;
      const { data } = await api.post('/members/me/labs', {
        test_date: receipt.day, results: receipt.parsed.bodyMetrics.map(bm => ({ test_name: bm.name, value: bm.value, unit: bm.unit })),
        lab_name: 'Smart Scale', notes: 'Captured from a scale screenshot via AI chat',
      }); check();
      dest.state = Number(data?.saved) === receipt.parsed.bodyMetrics.length ? 'saved' : 'unconfirmed';
    } catch (error) {
      if (error.code === 'REVIEW_SCOPE_CHANGED') throw error;
      dest.state = definitiveWriteFailure(error) ? 'failed' : 'unconfirmed';
    }
    write(receipt);
  };
  const bookkeeping = receipt => {
    if (receipt.bookkeeping || !['saved', 'queued'].includes(receipt.daily.state)) return;
    receipt.bookkeeping = true;
    const foods = receipt.parsed.foods || [], corrections = portionCorrections(foods.filter(f => f.on));
    if (corrections.length) api.post('/ai-chat/portions', { corrections }).catch(() => {});
    if (!receipt.evalMessage) return;
    for (const food of foods) {
      if (food.on && (!(Number(food.grams) > 0) || Number(food.grams) === Number(food.ai_grams))) continue;
      api.post('/ai-chat/eval-sample', { source: receipt.evalSource || 'member_parse', message: receipt.evalMessage,
        field: food.on ? 'grams' : 'food_name', ai_output: { name: food.name, grams: Number(food.ai_grams), meal: food.meal || null },
        corrected: food.on ? { name: food.name, grams: Number(food.grams), meal: food.meal || null } : null }).catch(() => {});
    }
  };

  const applyAll = async index => {
    const card = useAIChat.getState().messages[index];
    if (!card?.parsed || applyingRef.current || useAIChat.getState().messages.some(item => item.saveReceipt?.running) || card.undone) return;
    let receipt = card.saveReceipt;
    if (!receipt || receipt.rolledBack) {
      const log = useLogStore.getState(), auth = useAuthStore.getState();
      if (card.applied || log.date !== today() || log.loading || log.error === 'Failed to load log' || (card.logDate && card.logDate !== today())) {
        message(index, 'Return to today and wait for your log to load before saving this review.'); return;
      }
      if (foodReviewError(card.parsed.foods)) return;
      const id = nextRequestId(), parsed = copy(card.parsed);
      if (parsed.bodyMetricsLocked) parsed.bodyMetricsOn = false;
      const destinations = destinationNeeded(parsed);
      const change = createDailyChange(parsed, log.log, { id, mealSlots, mealPlans });
      receipt = { id, owner: auth.user?.id ?? null, sessionVersion: auth.sessionVersion, day: log.date,
        chatRevision: useAIChat.getState().revision, parsed, evalSource: card.evalSource, evalMessage: card.evalMessage,
        daily: { state: change.needed ? 'pending' : 'not-needed', change, locallyApplied: false },
        workout: { state: destinations.workout ? 'pending' : 'not-needed' }, body: { state: destinations.body ? 'pending' : 'not-needed' }, running: false };
      useAIChat.getState().setMessages(cards => cards.map((item, i) => i === index ? { ...item, saveReceipt: receipt, applied: true, editing: false } : item));
    }
    const check = begin(receipt);
    if (!check) { if (!ready(receipt)) message(index, 'This review belongs to another day or sign-in. Return to its original day before making changes.'); return; }
    try {
      check();
      const daily = receipt.daily;
      if (!acknowledged(daily.state) && daily.state !== 'conflict') {
        if (!daily.locallyApplied) {
          // The daily change was prepared synchronously from this same visible snapshot.
          for (const field of new Set([...daily.change.scalars.map(r => r.field), ...daily.change.maps.map(r => r.field), ...(daily.change.foods.length ? ['food'] : [])])) {
            useLogStore.getState().updateLog(field, copy(daily.change.after[field]));
          }
          daily.locallyApplied = true;
        } else if (!dailyMatches(useLogStore.getState().log, daily.change)) {
          daily.state = 'conflict'; write(receipt); return;
        }
        daily.state = 'saving'; write(receipt);
        await saveDaily(receipt, check);
      }
      check(); await saveWorkout(receipt, check);
      check(); await saveBody(receipt, check);
      check(); bookkeeping(receipt);
      write(receipt, { logSaveFailed: receipt.daily.state === 'failed', queued: receipt.daily.state === 'queued',
        workoutSaveFailed: !acknowledged(receipt.workout.state), pending: computePending(useLogStore.getState().log) });
      useAIChat.getState().markApplied(); haptic(30);
    } catch (error) {
      if (error.code !== 'REVIEW_SCOPE_CHANGED') write(receipt, { saveNotice: 'Saving was interrupted. Your review is kept; check each result below before retrying.' });
    } finally { finish(receipt); }
  };

  const rollback = async (index, { reopen }) => {
    const card = useAIChat.getState().messages[index], receipt = card?.saveReceipt;
    if (!receipt || receipt.rolledBack || !card.applied) return;
    const check = begin(receipt);
    if (!check) { if (!ready(receipt)) message(index, 'Return to the review’s original day and sign-in before editing or undoing it.'); return; }
    receipt.undoRequested = true;
    if (receipt.undoReopen === undefined) receipt.undoReopen = reopen;
    try {
      check();
      const daily = receipt.daily, workout = receipt.workout;
      const workoutConflict = () => {
        workout.undoState = 'conflict';
        receipt.undoError = ['saved', 'queued'].includes(daily.undoState)
          ? `${daily.undoState === 'queued' ? 'Daily changes were reverted on this device and are waiting to sync' : 'Daily changes were reverted'}, but your workout has newer changes. Those workout changes were not overwritten; review the workout manually.`
          : 'Your workout has changed since this review. Nothing else was undone. Review the workout manually.';
      };
      let dailyReverse;
      if (daily.locallyApplied && !['saved', 'queued'].includes(daily.undoState)) {
        if (daily.undoApplied) {
          if (!dailyMatches(useLogStore.getState().log, daily.change, 'before')) { receipt.undoError = OVERLAP_MESSAGE; return; }
        } else {
          dailyReverse = reverseDailyChange(useLogStore.getState().log, daily.change);
          if (!dailyReverse.ok) { receipt.undoError = dailyReverse.message; return; }
        }
      }
      // Preflight every changed destination before reversing anything new.
      if (workout.change && !['saved', 'not-needed'].includes(workout.undoState)) {
        const { data } = await api.get('/workouts', { params: { date: receipt.day } }); check();
        const current = normalizedWorkout(data, receipt.day);
        if (same(current, workout.change.before)) workout.undoState = 'saved';
        else if (!same(current, workout.change.after)) { workoutConflict(); return; }
      }
      check(); receipt.undoError = null;
      if (daily.locallyApplied && !['saved', 'queued'].includes(daily.undoState)) {
        // Recompute after the workout GET: a manual edit may have occurred while waiting.
        if (!daily.undoApplied) {
          dailyReverse = reverseDailyChange(useLogStore.getState().log, daily.change);
          if (!dailyReverse.ok) { receipt.undoError = dailyReverse.message; return; }
          Object.entries(dailyReverse.patch).forEach(([field, value]) => useLogStore.getState().updateLog(field, value));
          daily.undoApplied = true;
        }
        daily.undoState = 'saving'; write(receipt);
        if (!await saveDaily(receipt, check, true)) { receipt.undoError ||= 'Undo is kept on this device, but could not be saved. Retry undo to finish.'; return; }
      }
      check();
      if (workout.change && workout.undoState !== 'saved') {
        // Daily persistence above can take time. Recheck immediately before the
        // workout replacement so an intervening manual save is not overwritten.
        const { data } = await api.get('/workouts', { params: { date: receipt.day } }); check();
        const current = normalizedWorkout(data, receipt.day);
        if (same(current, workout.change.before)) workout.undoState = 'saved';
        else if (!same(current, workout.change.after)) { workoutConflict(); return; }
      }
      if (workout.change && workout.undoState !== 'saved') {
        // An empty prior session is a real restoration: POST clears notes, sets,
        // cardio and duration even if the API retains an empty session row.
        workout.undoState = 'saving'; write(receipt);
        try { await api.post('/workouts', copy(workout.change.before)); check(); workout.undoState = 'saved'; }
        catch (error) { if (error.code === 'REVIEW_SCOPE_CHANGED') throw error; workout.undoState = 'failed'; receipt.undoError = 'The workout undo is not confirmed. Retry undo to check and finish it.'; return; }
      }
      check();
      receipt.rolledBack = true;
      receipt.bodyRetained = ['saved', 'unconfirmed'].includes(receipt.body.state);
      receipt.undoQueued = daily.undoState === 'queued';
      const next = rollbackCard(card, { reopen: receipt.undoReopen });
      // The append-only lab API cannot erase saved/uncertain body metrics.
      // Reopening excludes them so saving the corrected daily fields cannot duplicate them.
      if (receipt.bodyRetained || card.parsed.bodyMetricsLocked) next.parsed = { ...next.parsed, bodyMetricsOn: false, bodyMetricsLocked: true };
      const reversed = daily.locallyApplied || workout.change;
      const undoNotice = [reversed ? receipt.undoQueued ? 'Changes reverted on this device — waiting to sync.' : 'Daily and workout changes from this review were reverted.' : 'This review is closed.',
        receipt.bodyRetained ? receipt.body.state === 'unconfirmed'
          ? 'Body metrics may already exist in Lab results; they were not removed and will not be submitted again.'
          : 'Body metrics remain in health history; review them from Lab results. They will not be submitted again.' : null].filter(Boolean).join(' ');
      write(receipt, { ...next, saveReceipt: receipt, undoNotice, saveNotice: null });
      useAIChat.getState().markApplied(); haptic(20);
    } catch (error) {
      if (error.code !== 'REVIEW_SCOPE_CHANGED') receipt.undoError = 'Undo could not be completed. Your receipt is kept; retry after reconnecting.';
    } finally { finish(receipt); }
  };
  return { applying, applyingRef, applyAll, undo: index => rollback(index, { reopen: false }),
    editApplied: index => rollback(index, { reopen: true }), retryUndo: index => rollback(index, { reopen: !!useAIChat.getState().messages[index]?.saveReceipt?.undoReopen }) };
}
