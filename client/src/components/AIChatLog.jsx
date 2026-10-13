/** One review flow for typed, spoken and photographed member logs.
 * The shared store keeps a draft across navigation. Today mounts this once
 * as an on-demand workspace; existing manual sheets use the same log store. */

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import useAIEntryActions from '../hooks/useAIEntryActions';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import api from '../api/client';
import { useLogStore } from '../store/logStore';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore, haptic } from '../store/settingsStore';
import { useVoiceComposer } from './VoiceComposer';
import { today, plural } from '../constants';
import { resolveProtocolItems, defaultMealSlot, isMealPlanQuestion } from '../lib/day';
import LogPlannedButton from './chat/LogPlannedButton';
import { useAIChat } from '../store/aiChatStore';
import { COMPOSER_BOTTOM_PX, COMPOSER_BOTTOM_FOCUSED_PX, autoGrow, SUGGESTION_CHIPS, GroupHeader, ToggleChip } from './chat/ChatAtoms';

// Re-exported so every existing `import { useAIChat } from './AIChatLog'` keeps working.
export { useAIChat };
import DaySummary from './DaySummary';
import AIFoodReview from './chat/AIFoodReview';
import UsualMeals from './chat/UsualMeals';
import { usualReview } from '../utils/usualMeals';
import AIAttachments from './chat/AIAttachments';
import { withFoodGrams, foodReviewError } from '../utils/aiFoodReview';
import { Icon } from './primitives';
import { isScaleWeightRow, routeLabRows } from '../utils/labRouting';
import { foodWithLabel } from './chat/ChatFoodMacros';
import { requestSnapshot } from '../utils/aiRequestRecovery';
import { downscale, readFileAsBase64 } from '../utils/aiAttachments';
import { countIncluded } from '../utils/aiParsedReview';
import { aiReplyText, aiContextText, hasLoggingPreview } from '../utils/aiReplyText';
import useAIRequestRecovery from '../hooks/useAIRequestRecovery';
import AIRequestRecovery from './chat/AIRequestRecovery';
import useAIReviewSave from '../hooks/useAIReviewSave';
import AIReviewSaveStatus from './chat/AIReviewSaveStatus';
import { definitiveWriteFailure } from '../utils/aiSaveReceipt';

const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_PHOTO_BASE64 = 3_000_000;

// resolveProtocolItems (lib/day) is the ONE derivation, shared with Today and
// Plan; this adapter keeps the field names the chat has always used.
function deriveProtocolItemsCompat(protocol) {
  const r = resolveProtocolItems(protocol);
  return { activities: r.activeActivities, acv: r.activeACV, supplements: r.activeSupplements };
}

export default function AIChatLog({ mealPlans = [], onLogPlanned = null, overlay = false } = {}) {
  const mealSlots = useSettingsStore(s => s.mealSlots);
  // Where food goes when the member does not say which meal: shown on the
  // preview, and used on apply, so what they see is what is logged.
  const todayFood = useLogStore(s => s.log?.food);
  const autoSlot = defaultMealSlot({ mealSlots, mealPlans, food: todayFood || [] });

  // Conversation state comes from the store (see useAIChat above) so it
  // survives the member navigating away from Today and back.
  const messages    = useAIChat(s => s.messages);
  const setMessages = useAIChat(s => s.setMessages);
  const input       = useAIChat(s => s.input);
  const setInput    = useAIChat(s => s.setInput);

  // Transient UI state stays local — a half-finished upload is not worth
  // resuming across a navigation, and leaving `busy` true in the store would
  // strand the composer permanently if the member navigated mid-request.
  const {
    busy, setBusy, photoBusy, setPhotoBusy, labBusy, setLabBusy,
    replacingPhoto, pickerContext, photoFlight, parseFlight, labFlight,
    requestEdit, setRequestEdit, requestCurrent, rememberPicker, consumePicker, acceptPhoto,
    newRequest, beginRequest, failRequest, finishRequest,
  } = useAIRequestRecovery();
  const fileRef = useRef(null);
  const galleryRef = useRef(null);
  const logDate = useLogStore(s => s.date);
  const chatDay = useAIChat(s => s.dayKey);
  const logLoading = useLogStore(s => s.loading);
  const logError = useLogStore(s => s.error);
  const assistantReady = logDate === today() && !logLoading && logError !== 'Failed to load log';
  const overlayRef = useRef(null);
  const previousFocus = useRef(null);
  const [composerHeight, setComposerHeight] = useState(220);

  const labRef  = useRef(null);
  const labSaveFlight = useRef(null);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const recogRef  = useRef(null);


  // ── What's still pending after applying — the "coach nudge" ────────────────
  const computePending = useCallback((newLog) => {
    const proto  = deriveProtocolItemsCompat(useLogStore.getState().protocol);
    const target = useLogStore.getState().protocol?.water_target || 3000;
    const pending = [];

    if (!newLog.weight) pending.push('morning weight');
    const actLeft = proto.activities.filter(a => !newLog.activities?.[a.id]).length;
    if (actLeft > 0) pending.push(`${actLeft} activit${actLeft > 1 ? 'ies' : 'y'}`);
    const acvLeft = proto.acv.filter(a => !newLog.acv?.[a.id]).length;
    if (acvLeft > 0) pending.push(`${acvLeft} ${plural(acvLeft, 'ACV dose')}`);
    const suppLeft = proto.supplements.filter(s => !newLog.supplements?.[s.id]).length;
    if (suppLeft > 0) pending.push(`${suppLeft} ${plural(suppLeft, 'supplement')}`);
    if ((newLog.water || 0) < target) pending.push(`water (${((target - (newLog.water || 0)) / 1000).toFixed(1)}L to go)`);
    if (!newLog.food?.length) pending.push('food log');
    if (!newLog.sleep?.bedtime || !newLog.sleep?.waketime) pending.push('sleep times');

    return pending.slice(0, 3);
  }, []);

  const { applying, applyingRef, applyAll, undo, editApplied, retryUndo } = useAIReviewSave({ mealSlots, mealPlans, computePending });

  useEffect(() => {
    if (useAIChat.getState().composerOpen) bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages, busy]);

  const focusRequest = useAIChat(s => s.focusRequest);
  const composerFocused = useAIChat(s => s.composerFocused);
  const composerOpen    = useAIChat(s => s.composerOpen);
  const threadRef = useRef(null);
  const kbInset   = useKeyboardInset();

  // The box follows its content in BOTH directions — grows when a dictation
  // lands, shrinks when text is deleted or cleared — so it can never sit
  // taller than what is in it.
  useEffect(() => { autoGrow(inputRef.current); }, [input]);

  // Onboarding hands over a sample message; it lands in the box, not sent.
  const prefillText = useAIChat(s => s.prefillText);
  useEffect(() => {
    if (!prefillText) return;
    setInput(prefillText);
    useAIChat.setState({ prefillText: '' });
  }, [prefillText]);

  // × on the box: discard the draft and drop the keyboard. The only way out
  // used to be Send.
  const clearDraft = () => {
    setInput('');
    haptic(8);
    inputRef.current?.blur();
  };

  useEffect(() => { useAIChat.getState().ensureFreshDay(today()); }, []);

  // ── Voice input ────────────────────────────────────────────────────────────
  // Dictation lives in its own review card above the input (useVoiceComposer):
  // 3s of silence auto-stops into a Send button; the mic appends more takes.
  // The typing box below is untouched by voice.
  const vc = useVoiceComposer({ onSend: (t) => send(t), contextKey: `${logDate || ''}:${chatDay || ''}` });
  useAIEntryActions({ inputRef, fileRef, overlayRef, bottomRef, previousFocus, vc, focusRequest, composerOpen,
    canPhoto: assistantReady && !photoBusy && !labBusy && !busy && !applying });

  // ── Photo food logging ─────────────────────────────────────────────────────


  // `silent` is set when we are re-routing a file the member already sent via
  // the report button — a second "📷 Photo" bubble would be confusing.
  // sendPhoto and sendLabReport can each hand a file to the other, so one side
  // goes through a ref to avoid a circular useCallback dependency.
  const sendLabReportRef = useRef(null);

  const sendPhoto = useCallback(async (file, { silent = false, recovery = null } = {}) => {
    if ((!file && !recovery?.payload) || photoFlight.current || parseFlight.current || applyingRef.current) return;
    if (recovery && !requestCurrent(recovery)) return;
    const request = recovery || newRequest('photo', 'Photo attached · AI will estimate your meal',
      { silent, file, payload: null });
    photoFlight.current = request.id;
    const controller = beginRequest(request);
    const requestDay = request.day;
    setPhotoBusy(true);
    haptic(10);
    try {
      if (!request.payload) {
        if (request.file.size > MAX_PHOTO_BYTES) {
          request.file = null;
          throw { response: { status: 413 } };
        }
        const base64 = await downscale(request.file);
        if (!requestCurrent(request) || controller.signal.aborted) return;
        if (base64.length > MAX_PHOTO_BASE64) {
          request.file = null;
          throw { response: { status: 413 } };
        }
        request.payload = requestSnapshot({ image: base64, mimeType: 'image/jpeg', mealSlots });
        setMessages(prev => prev.map(m => m.requestId === request.id || m.requestIds?.includes(request.id)
          ? { ...m, photoPreview: 'data:image/jpeg;base64,' + base64 } : m));
      }
      const { data } = await api.post('/ai-chat/photo', requestSnapshot(request.payload),
        { timeout: 60000, signal: controller.signal });
      if (!requestCurrent(request) || controller.signal.aborted) return;

      // A lab report reached the camera button — send it to the reader instead.
      if (data.route_to === 'lab') {
        setMessages(m => [...m, { role: 'ai', text: data.reply }]);
        setPhotoBusy(false);
        const original = request.file || new File([Uint8Array.from(atob(request.payload.image), c => c.charCodeAt(0))], 'meal.jpg', { type: 'image/jpeg' });
        request.file = null; request.payload = null;
        return sendLabReportRef.current?.(original, { silent: true });
      }

      setMessages(m => [...m, {
        role: 'ai',
        text: data.reply,
        // Eval set: what produced this card. A photo has no replayable text, so
        // it is tagged as such rather than stored as "photo attached" — a
        // sample whose question is not the real question scores nothing.
        logDate: requestDay,
        evalSource: 'photo',
        evalMessage: null,
        parsed: {
          // Scale screenshots return a weight and body metrics; meal photos
          // return foods. Same preview card handles both.
          weight_kg: data.weight_kg ?? null, weightOn: data.weight_kg != null,
          bodyMetrics: data.body_metrics || [],
          bodyMetricsOn: (data.body_metrics || []).length > 0,
          activities: [], acv: [], supplements: [],
          water_ml_add: null, waterOn: false,
          sleep: null, sleepOn: false,
          foods: (data.foods || []).map(f => ({ ...f, on: true, ai_grams: f.grams })),
          workouts: [],
          totals: data.totals,
        },
        applied: false,
      }]);
      request.file = null;
      request.payload = null;
    } catch (err) {
      // Once compressed, the retry needs only the bounded request image.
      if (request.payload) request.file = null;
      failRequest(request, err);
    } finally {
      finishRequest(request);
      if (photoFlight.current === request.id) { photoFlight.current = false; setPhotoBusy(false); }
    }
  }, [mealSlots, requestCurrent]);



  // ── Lab report reading ─────────────────────────────────────────────────────
  // PDFs go up untouched: rasterising one client-side would throw away the text
  // layer and turn a clean extraction into OCR guesswork on medical numbers.
  // Photos of printouts get the same downscale as food photos.


  const sendLabReport = useCallback(async (file, { silent = false, force = false } = {}) => {
    if (!file || labFlight.current) return;
    const isPdf = file.type === 'application/pdf';
    const request = newRequest('lab', isPdf ? '📄 PDF attached' : '📷 Photo attached', { silent, file });
    labFlight.current = request.id;
    const controller = beginRequest(request);
    setLabBusy(true);
    haptic(10);
    // Neutral label: the member attaches a file, the app works out what it is.
    // Claiming "my lab report" up front reads wrong when it turns out to be a
    // scale photo, and pre-labels a decision the classifier hasn't made yet.
    // A full panel can take 30–60 seconds. Without this the screen sits blank
    // and members upload the same file again, doubling the load.
    setMessages(m => [...m, { role: 'ai', text: 'Reading it… a full lab panel can take up to a minute.', pending: true, pendingRequest: request.id }]);
    try {
      // Reject oversized files here rather than after a long upload. Express
      // caps the body at 12MB and base64 inflates by ~33%, so anything over
      // ~8MB of source will be refused server-side anyway.
      if (file.size > 8 * 1024 * 1024) {
        throw Object.assign(new Error('too large'), {
          response: { data: { error: 'That file is over 8MB. Export a smaller PDF, or photograph just the results page.' } },
        });
      }

      const base64 = isPdf ? await readFileAsBase64(file) : await downscale(file);
      if (!requestCurrent(request) || controller.signal.aborted) return;

      // Reading a multi-page pathology report takes far longer than a chat
      // reply. The shared client aborts at 35s, which was cutting the request
      // off before the server had even answered — the failure looked like a
      // read error when it was really a client-side timeout.
      const { data } = await api.post('/ai-chat/lab-report', {
        file: base64,
        mimeType: isPdf ? 'application/pdf' : 'image/jpeg',
        force,
      }, { timeout: 120000, signal: controller.signal });
      if (!requestCurrent(request) || controller.signal.aborted) return;

      // Wrong button: the image is a scale reading or a meal. Route it to the
      // photo pipeline, which already reads both — the member never has to
      // learn which button does what.
      if (data.route_to === 'photo' && !force) {
        setMessages(m => [...m.filter(x => !x.pending), { role: 'ai', text: data.reply }]);
        setLabBusy(false);
        return sendPhoto(file, { silent: true });
      }
      // Genuinely ambiguous — ask rather than guess. Losing a real lab report
      // to a wrong guess is far worse than one extra tap.
      if (data.route_to === 'ask' && !force) {
        setMessages(m => [...m.filter(x => !x.pending), {
          role: 'ai', text: data.reply, imageChoice: { file },
        }]);
        setLabBusy(false);
        return;
      }

      setMessages(m => [...m.filter(x => !x.pending), {
        role: 'ai',
        text: data.reply,
        lab: {
          test_date: data.test_date || today(),
          lab_name: data.lab_name || '',
          results: (data.results || []).map(r => ({ ...r, on: r.value !== null })),
          needs_review: data.needs_review || 0,
        },
        applied: false,
      }]);
    } catch (err) {
      if (!requestCurrent(request) || controller.signal.aborted) return;
      const timedOut = err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
      const msg = file.size > 8 * 1024 * 1024
        ? 'That file is over 8MB. Export a smaller PDF, or photograph just the results page.'
        : (timedOut
            ? 'That report took too long to read. A single page, or a photo of just the results table, is much quicker.'
            : 'Could not reach the reader — check your connection and try again.');
      setMessages(m => [...m.filter(x => !x.pending), { role: 'ai', text: msg, error: true }]);
    } finally {
      request.file = null;
      finishRequest(request);
      if (labFlight.current === request.id) { labFlight.current = false; setLabBusy(false); }
    }
  }, [requestCurrent, sendPhoto]);
  sendLabReportRef.current = sendLabReport;

  const patchLab = useCallback((mi, fn) => {
    setMessages(prev => {
      const next = [...prev];
      const m = next[mi];
      if (!m?.lab || m.applied || labSaveFlight.current || m.labSaveLocked || m.labSaveUnconfirmed) return prev;
      next[mi] = { ...m, lab: fn(m.lab) };
      return next;
    });
  }, []);

  // A body-scale weight hiding among lab rows. Members upload scale screenshots
  // through the lab button too — that weight belongs in today's daily log, not
  // in lab history (where it duplicates the weight series and never reaches the
  // coach's daily view). 20–300 kg plausibility gate matches the parsers.
  const saveLabs = useCallback(async (mi) => {
    const m = useAIChat.getState().messages[mi];
    if (!m?.lab || m.applied || m.labSaveUnconfirmed || applyingRef.current
      || (labSaveFlight.current?.current())) return;
    const auth = useAuthStore.getState(), selectedDay = useLogStore.getState().date;
    const initialWeight = useLogStore.getState().log.weight;
    const revision = useAIChat.getState().revision, reviewDay = today();
    if (selectedDay !== reviewDay || useLogStore.getState().loading || useLogStore.getState().error === 'Failed to load log') return;
    let invalidated = false;
    const current = () => !invalidated && useAuthStore.getState().user?.id === auth.user?.id
      && useAuthStore.getState().sessionVersion === auth.sessionVersion
      && useAIChat.getState().revision === revision && today() === reviewDay
      && useLogStore.getState().date === selectedDay && useAIChat.getState().messages.some(card => card.lab === m.lab);
    const patch = values => { if (current()) setMessages(cards => cards.map(card => card.lab === m.lab ? { ...card, ...values } : card)); };
    const rows = m.lab.results.filter(r => r.on && r.value !== null && r.value !== '');
    if (!rows.length) return;

    // Only when the reading is from today — retro-writing today's log from an
    // old report would be wrong. Past-dated weight rows stay in lab history.
    // Routing rules live in utils/labRouting.js — the same functions
    // test-coach-view runs, and asserted to agree with the server's copy of the
    // weight-name predicate.
    const { weightRow, labRows } = routeLabRows(rows, m.lab.test_date, reviewDay);

    const flight = { current }; labSaveFlight.current = flight;
    const unsubscribe = useLogStore.subscribe((state, previous) => { if (state.date !== previous.date) invalidated = true; });
    setLabBusy(true); patch({ labSaveNotice: null });
    let appendSent = false, appendConfirmed = !!m.labSaveLocked;
    try {
      let saved = m.labSaved || 0, notice = m.labNotice || null;
      if (labRows.length && !appendConfirmed) {
        if (!current()) return;
        appendSent = true;
        // Persist the uncertain boundary on the card before the append. A
        // day change or remount must never make the same report retryable.
        patch({ labSaveUnconfirmed: true, labSaveNotice: 'The report save is not yet confirmed. Check Lab results before repeating it.' });
        const { data } = await api.post('/members/me/labs', {
          test_date: m.lab.test_date,
          lab_name: m.lab.lab_name || null,
          results: labRows.map(r => ({
            test_name: r.test_name, value: r.value, unit: r.unit,
            ref_min: r.ref_min, ref_max: r.ref_max,
          })),
        });
        if (!current()) return;
        saved = data.saved; notice = data.notice;
        if (Number(saved) !== labRows.length) {
          patch({ labSaveUnconfirmed: true, labSaveNotice: 'Some report results may already be saved. Check Lab results before adding them again.' }); return;
        }
        appendConfirmed = true;
        patch({ labSaved: saved, labNotice: notice, labSaveLocked: true, labSaveUnconfirmed: false, labSaveNotice: null });
      }
      let weightQueued = false;
      if (weightRow) {
        if (!current()) return;
        const { updateLog, saveLog } = useLogStore.getState();
        const value = String(parseFloat(weightRow.value));
        if ((m.labWeightApplied && useLogStore.getState().log.weight !== value)
          || (!m.labWeightApplied && String(useLogStore.getState().log.weight ?? '') !== String(initialWeight ?? ''))) {
          patch({ labSaveNotice: 'Weight has changed since this review. Keep the newer value and use the Weight editor to make a correction.' }); return;
        }
        if (!m.labWeightApplied) updateLog('weight', value);
        patch({ labWeightApplied: true, labSaveLocked: true });
        const result = await saveLog();
        if (!current()) return;
        if (!result || result.ok === false || useLogStore.getState().error) {
          patch({ labSaveNotice: `${saved ? 'Report results saved. ' : ''}Weight save was not confirmed. Retry to save the weight without repeating report results.` }); return;
        }
        if (result.data && Number(result.data.weight_kg) !== Number(weightRow.value)) {
          patch({ labSaveNotice: 'The server kept a different weight. Check the Weight editor before making another change.' }); return;
        }
        weightQueued = !!result.queued;
      }
      if (!current()) return;
      haptic(30);
      patch({ applied: true, labSaved: saved, labNotice: notice, weightQueued,
        weightLogged: weightRow ? parseFloat(weightRow.value) : null, labSaveNotice: null });
    } catch (err) {
      if (!current()) return;
      const uncertain = appendSent && !appendConfirmed && !definitiveWriteFailure(err);
      patch({ labSaveUnconfirmed: uncertain, labSaveNotice: uncertain
        ? 'The report save is not confirmed. Check Lab results before adding it again.'
        : 'Could not save those results. Reconnect and try again.' });
    } finally {
      unsubscribe();
      if (labSaveFlight.current === flight) { labSaveFlight.current = null; if (!labFlight.current) setLabBusy(false); }
    }
  }, [setMessages]);

  // ── Send → parse ───────────────────────────────────────────────────────────
  const send = useCallback(async (textOverride, { recovery = null } = {}) => {
    const text = (textOverride ?? recovery?.payload?.message ?? input).trim();
    if (!text) return;
    if (parseFlight.current || photoFlight.current || labFlight.current || applyingRef.current || !assistantReady) {
      // A dictated take must not replace an unrelated typed draft.
      if (!recovery && textOverride != null) setInput(current => current ? `${current}\n${text}` : text);
      return;
    }
    if (recovery && !requestCurrent(recovery)) return;
    if (!recovery) useAIChat.getState().ensureFreshDay(today());
    let payload = recovery?.payload;
    if (!payload) {
      const proto = deriveProtocolItemsCompat(useLogStore.getState().protocol);
      // Chat memory: the last few visible turns plus today's logged foods, so
      // follow-ups like "make the dal 250g" or "that was dinner" resolve to
      // real items instead of "couldn't find anything to log".
      const recent = useAIChat.getState().messages.slice(-6).map(m => ({
        role: m.role === 'user' ? 'user' : 'ai',
        text: aiContextText(m).slice(0, 200),
      })).filter(r => r.text);
      const lastFoods = (useLogStore.getState().log?.food || []).slice(-20)
        .map(f => ({ name: f.name, grams: f.grams, meal: f.meal }));
      payload = requestSnapshot({
        message: text,
        context: {
          mealSlots,
          recent,
          lastFoods,
          activities:    proto.activities.map(({ id, label, sub }) => ({ id, label, sub })),
          acv:           proto.acv.map(({ id, label, sub }) => ({ id, label, sub })),
          supplements:   proto.supplements.map(({ id, label, sub }) => ({ id, label, sub })),
          waterTargetMl: useLogStore.getState().protocol?.water_target || 3000,
        },
      });
    } else if (text !== payload.message) {
      payload = requestSnapshot({ ...payload, message: text });
    }
    const request = recovery ? { ...recovery, payload } : newRequest('text', text, { payload });
    parseFlight.current = request.id;
    const controller = beginRequest(request);
    const requestDay = request.day;
    // Only a send from the main composer consumes its draft. A voice result,
    // Retry or the failed-card editor leaves any newer typed message intact.
    if (!recovery && textOverride == null) {
      setInput(current => current.trim() === text ? '' : current);
      if (inputRef.current) inputRef.current.style.height = 'auto';
    }
    if (recovery) setMessages(previous => previous.map(m => m.requestId === request.id ? { ...m, text } : m));
    setBusy(true);
    haptic(10);

    try {
      const { data } = await api.post('/ai-chat/parse', requestSnapshot(payload), { signal: controller.signal });
      if (!requestCurrent(request) || controller.signal.aborted) return;

      // A whole-day summary comes back as structured fields, and renders as the
      // same card the coach sees. Nothing to apply, so no preview list.
      if (data.summary) {
        setMessages(m => [...m, { role: 'ai', summary: data.summary }]);
        return;
      }

      // Every parsed thing starts INCLUDED — member unticks anything misheard
      setMessages(m => [...m, {
        role: 'ai',
        text: data.reply,
        // Eval set: the exact message that produced this card, so an edit the
        // member makes below can be paired with the question that caused it.
        logDate: requestDay,
        evalSource: 'member_parse',
        evalMessage: text,
        // A meal-plan question with nothing to apply: the answer offers "Log <next meal> as planned".
        planAsk: isMealPlanQuestion(text) && data.weight_kg == null && !(data.foods || []).length
          && !(data.workouts || []).length && !(data.corrections || []).length,
        parsed: {
          weight_kg:    data.weight_kg,
          weightOn:     data.weight_kg != null,
          activities:   (data.activities  || []).map(a => ({ ...a, on: true })),
          acv:          (data.acv         || []).map(a => ({ ...a, on: true })),
          supplements:  (data.supplements || []).map(s => ({ ...s, on: true })),
          water_ml_add: data.water_ml_add,
          waterOn:      data.water_ml_add != null,
          sleep:        data.sleep,
          sleepOn:      !!data.sleep,
          notes: data.notes || '', notesOn: !!data.notes,
          foods:        (data.foods || []).map(f => ({ ...f, on: true, ai_grams: f.grams })),
          corrections:  (data.corrections || []).map(c => ({ ...c, on: true })),
          workouts:     (data.workouts || []).map(w => ({ ...w, on: true })),
          totals:       data.totals,
        },
        applied: false,
      }]);
    } catch (err) {
      failRequest(request, err);
    } finally {
      finishRequest(request);
      if (parseFlight.current === request.id) { parseFlight.current = false; setBusy(false); }
    }
  }, [input, assistantReady, mealSlots, requestCurrent]);

  // ── Toggle helpers on a message's parsed preview ───────────────────────────
  const patchParsed = useCallback((mi, patchFn) => {
    setMessages(prev => {
      const next = [...prev];
      const msg = next[mi];
      if (!msg?.parsed || msg.applied) return prev;
      next[mi] = { ...msg, reviewProposed: hasLoggingPreview(msg), noteProposed: msg.noteProposed || !!msg.parsed.notes, parsed: patchFn(msg.parsed) };
      return next;
    });
  }, []);

  const setGrams = useCallback((mi, idx, value) => {
    patchParsed(mi, p => ({ ...p, foods: p.foods.map((f, i) => i === idx ? withFoodGrams(f, value) : f) }));
  }, [patchParsed]);

  // The member's own macros for a preview food (10 Oct 2026, chat/ChatFoodMacros).
  const setMacros = (mi, idx, per) => patchParsed(mi, p => ({ ...p, foods: p.foods.map((f, i) => (i === idx ? foodWithLabel(f, per) : f)) }));
  const toggleListItem = (mi, key, idx) =>
    patchParsed(mi, p => ({
      ...p,
      [key]: p[key].map((it, i) => (i === idx ? { ...it, on: !it.on } : it)),
    }));

  useEffect(() => {
    if (!overlay || !composerOpen) return undefined;
    if (!previousFocus.current) previousFocus.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = e => {
      const nested = e.target?.closest?.('[role="dialog"]');
      if (nested && nested !== overlayRef.current) return;
      if (e.key === 'Escape') { e.preventDefault(); useAIChat.getState().closeComposer(); }
      if (e.key === 'Tab') {
        const nodes = [...(overlayRef.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]') || []),
          ...document.querySelectorAll('.member-assistant-composer button:not(:disabled),.member-assistant-composer textarea:not(:disabled)')].filter(el => el.getClientRects().length);
        if (!nodes.length) return;
        if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes[nodes.length-1].focus(); }
        else if (!e.shiftKey && document.activeElement === nodes[nodes.length-1]) { e.preventDefault(); nodes[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKey); previousFocus.current?.focus?.(); previousFocus.current = null; };
  }, [overlay, composerOpen]);
  useEffect(() => {
    if (!overlay || !composerOpen || typeof ResizeObserver === 'undefined') return undefined;
    const el = document.querySelector('[data-testid="composer-bar"]');
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setComposerHeight(el.getBoundingClientRect().height + 40));
    ro.observe(el); return () => ro.disconnect();
  }, [overlay, composerOpen]);

  const thread = (
    <section ref={threadRef} id="ai-thread" data-testid="ai-thread" aria-label="FitLife AI" className="scroll-mt-4">
      <div className="chat-thread-header flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-full text-charcoal bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center text-sm  flex-shrink-0"><Icon name="spark" size={17} /></div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white leading-tight">FitLife AI</p>
          <p className="text-eyebrow text-lo leading-tight">Log your whole day in one message</p>
        </div>
        <span className="flex-1" />
        {!composerOpen && (
          <button type="button" onClick={() => { haptic(10); useAIChat.getState().openChat(); }} data-testid="thread-open-composer"
            style={{ minHeight: 36 }}
            className="text-caption font-bold text-charcoal bg-gold rounded-full px-3 active:scale-95 transition-transform whitespace-nowrap">
            Tell me
          </button>
        )}
      </div>

      {/* ── Messages ── */}
      <div className="space-y-4" data-testid="ai-messages">

        {messages.length === 0 && (
          <div className="member-ai-welcome">
            <Icon name="spark" size={25} />
            <h2>A little less effort.</h2>
            <p>Meals, movement, water, sleep or weight. Tell me once; review and save.</p>
            <p className="member-ai-example">Try “2 idlis and sambar for breakfast”.</p>
          </div>
        )}

        {messages.map((m, mi) => (
          m.role === 'user' ? (
            <div key={mi} className="flex justify-end">
              <div className="ai-user-bubble max-w-[85%] bg-gold text-charcoal text-sm rounded-2xl rounded-br-md px-4 py-2.5 shadow-sm">
                {m.photoPreview && <img src={m.photoPreview} alt="Your attached meal" className="max-h-40 w-full object-cover rounded-xl mb-2" />}
                {m.text}
              </div>
            </div>
          ) : (
            <div key={mi} className="flex justify-start" data-testid={m.parsed ? "ai-review-card" : undefined} data-review-index={mi} data-review-id={m.saveReceipt?.id}>
              <div className="max-w-[94%] w-full">
                <div className={`ai-reply text-sm rounded-2xl rounded-bl-md px-4 py-3 border ${
                  m.error
                    ? 'bg-red-500/[0.08] border-red-500/25 text-red-300'
                    : m.summary
                      ? 'bg-gold/[0.06] border-gold/20 text-gold-light'
                      : 'bg-surface border-hair text-white'
                }`} data-testid={m.failedRequest ? 'ai-request-error' : undefined}>
                  {m.summary
                    ? <DaySummary s={m.summary} />
                    : <p className="leading-relaxed whitespace-pre-line" data-testid="ai-reply-text">{aiReplyText(m)}</p>}

                  {m.failedRequest && requestCurrent(m.failedRequest) && <AIRequestRecovery
                    request={m.failedRequest} requestEdit={requestEdit} setRequestEdit={setRequestEdit}
                    disabled={busy || photoBusy || labBusy || applying || !assistantReady}
                    send={send} sendPhoto={sendPhoto}
                    onReplace={request => { replacingPhoto.current = request; fileRef.current?.click(); }} />}


                  {m.planAsk && <LogPlannedButton mealPlans={mealPlans} food={todayFood} onLogPlanned={onLogPlanned} />}

                  {/* Lab report draft — nothing is saved until confirmed. A
                      misread decimal on a blood test is a different order of
                      mistake from a misread portion size. */}
                  {/* Ambiguous image — the member decides which reader to use */}
                  {m.imageChoice && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        onClick={() => { const f = m.imageChoice.file;
                          setMessages(prev => prev.map(x => x === m ? { ...x, imageChoice: null } : x));
                          sendPhoto(f, { silent: true }); }}
                        style={{ minHeight: 40 }}
                        className="px-3 rounded-full text-xs font-semibold bg-gold text-charcoal">
                        It's a meal or my scale
                      </button>
                      <button
                        onClick={() => { const f = m.imageChoice.file;
                          setMessages(prev => prev.map(x => x === m ? { ...x, imageChoice: null } : x));
                          sendLabReportRef.current?.(f, { silent: true, force: true }); }}
                        style={{ minHeight: 40 }}
                        className="px-3 rounded-full text-xs font-semibold border border-hair-hi text-mid">
                        It's a lab report
                      </button>
                    </div>
                  )}

                  {m.lab && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <input type="date" value={m.lab.test_date}
                          max={today()}
                          disabled={m.applied || labBusy || m.labSaveLocked || m.labSaveUnconfirmed}
                          onChange={e => patchLab(mi, l => ({ ...l, test_date: e.target.value }))}
                          style={{ minHeight: 32 }}
                          className="bg-charcoal border border-white/[0.12] rounded-lg px-2 text-caption text-white" />
                        <input value={m.lab.lab_name} placeholder="Lab name"
                          disabled={m.applied || labBusy || m.labSaveLocked || m.labSaveUnconfirmed}
                          onChange={e => patchLab(mi, l => ({ ...l, lab_name: e.target.value }))}
                          style={{ minHeight: 32 }}
                          className="flex-1 min-w-0 bg-charcoal border border-white/[0.12] rounded-lg px-2 text-caption text-white placeholder-lo" />
                      </div>
                      {!m.applied
                        && m.lab.test_date === today()
                        && m.lab.results.some(r => r.on && isScaleWeightRow(r)) && (
                        <p className="text-caption text-gold mb-2 px-1">
                          ⚖ Weight found — it will go into today's daily log, the rest into body history.
                        </p>
                      )}

                      {m.lab.needs_review > 0 && !m.applied && (
                        <p className="text-eyebrow text-amber-300 mb-2 leading-relaxed">
                          ⚠ {m.lab.needs_review} {plural(m.lab.needs_review, 'row')} came out unclear —
                          check the highlighted ones against your report before saving.
                        </p>
                      )}

                      <div className="space-y-1.5">
                        {m.lab.results.map((r, ri) => (
                          <div key={ri}
                            className={`bg-charcoal border rounded-xl px-3 py-2 ${
                              r.confidence === 'low' || r.value === null
                                ? 'border-amber-400/35' : 'border-white/[0.06]'
                            } ${r.on ? '' : 'opacity-40'}`}>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => patchLab(mi, l => ({
                                  ...l, results: l.results.map((x, j) => j === ri ? { ...x, on: !x.on } : x) }))}
                                disabled={m.applied || labBusy || m.labSaveLocked || m.labSaveUnconfirmed}
                                className={`w-4 h-4 rounded-full flex items-center justify-center text-tiny flex-shrink-0 ${
                                  r.on ? 'bg-gold text-charcoal' : 'bg-white/[0.08] text-transparent'}`}>✓</button>
                              <span className="text-caption font-semibold text-white flex-1 min-w-0 truncate">
                                {r.test_name}
                              </span>
                              <input
                                value={r.value ?? ''} inputMode="decimal"
                                placeholder="?"
                                disabled={m.applied || labBusy || m.labSaveLocked || m.labSaveUnconfirmed}
                                onChange={e => patchLab(mi, l => ({
                                  ...l, results: l.results.map((x, j) => j === ri
                                    ? { ...x, value: e.target.value === '' ? null : parseFloat(e.target.value), on: e.target.value !== '' } : x) }))}
                                style={{ width: 62, minHeight: 28 }}
                                className={`rounded-md px-1 text-center text-caption border bg-surface text-white
                                  ${r.value === null ? 'border-amber-400/50' : 'border-white/[0.12]'}`} />
                              <span className="text-eyebrow text-lo w-12 truncate">{r.unit || ''}</span>
                            </div>
                            {(r.ref_min != null || r.ref_max != null) && (
                              <p className="text-tiny text-lo ml-6 mt-0.5">
                                ref {r.ref_min ?? '−'}–{r.ref_max ?? '−'}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>

                      {m.applied ? (
                        <div className="mt-2 bg-ok-deep/[0.08] border border-ok-deep/25 rounded-xl px-3.5 py-3">
                          <p className="text-body-sm font-bold text-gold-light">
                            {m.labSaved > 0 ? `${m.labSaved} results saved` : m.weightQueued ? 'Kept on this device' : 'Saved'}
                            {m.weightLogged != null && ` · ${m.weightLogged} kg ${m.weightQueued ? 'waiting to sync' : 'logged for today'}`}
                          </p>
                          {m.labNotice && (
                            <p className="text-caption text-amber-200 mt-1 leading-relaxed">{m.labNotice}</p>
                          )}
                        </div>
                      ) : (
                        <>
                          {m.labSaveNotice && <p role="status" className="text-caption text-warn mt-2">{m.labSaveNotice}</p>}
                          <button onClick={() => saveLabs(mi)} disabled={labBusy || applying || !assistantReady || m.labSaveUnconfirmed}
                            style={{ minHeight: 44 }}
                            className="w-full mt-2 rounded-xl text-sm font-bold text-charcoal
                              bg-gradient-to-r from-gold-light via-gold to-gold-dark
                              active:scale-[0.98] transition-transform disabled:opacity-60">
                            {labBusy ? 'Saving…' : m.labSaveUnconfirmed ? 'Check Lab results' : m.labSaveLocked ? 'Retry weight save' : `Save ${m.lab.results.filter(r => r.on && r.value !== null).length} results`}
                          </button>
                          <p className="text-eyebrow text-lo mt-1.5 leading-relaxed">
                            {m.labSaveLocked || m.labSaveUnconfirmed ? 'Previously submitted report results will not be sent again.' : 'Read from your report by AI — check the numbers before saving. Nothing is stored until you do.'}
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {m.parsed && hasLoggingPreview(m) && (
                    <div className="mt-3 space-y-3">

                      {/* ⚖ Weight */}
                      {m.parsed.weight_kg != null && (
                        <div>
                          <GroupHeader icon="⚖️" title="Morning weight" />
                          <ToggleChip on={m.parsed.weightOn}
                            onToggle={() => patchParsed(mi, p => ({ ...p, weightOn: !p.weightOn }))}>
                            {m.parsed.weight_kg} kg
                          </ToggleChip>
                        </div>
                      )}

                      {/* 📊 Body scan metrics from a scale screenshot */}
                      {m.parsed.bodyMetrics?.length > 0 && (
                        <div>
                          <GroupHeader icon="📊" title="Body scan" count={m.parsed.bodyMetrics.length} />
                          {m.parsed.bodyMetricsLocked ? <p className="text-caption text-mid">Body metrics were already submitted. Check Lab results to avoid adding them twice.</p> : <ToggleChip on={m.parsed.bodyMetricsOn}
                            onToggle={() => patchParsed(mi, p => ({ ...p, bodyMetricsOn: !p.bodyMetricsOn }))}>
                            Save {m.parsed.bodyMetrics.length} metrics to body history
                          </ToggleChip>}
                          <p className="text-eyebrow text-lo mt-1 px-1">
                            {m.parsed.bodyMetrics.slice(0, 4).map(bm => `${bm.name} ${bm.value}${bm.unit || ''}`).join(' · ')}
                            {m.parsed.bodyMetrics.length > 4 && ` · +${m.parsed.bodyMetrics.length - 4} more`}
                          </p>
                        </div>
                      )}

                      {/* ✏️ Corrections to items already in today's log */}
                      {m.parsed.corrections?.length > 0 && (
                        <div>
                          <GroupHeader icon="✏️" title="Corrections" count={m.parsed.corrections.filter(c => c.on).length} />
                          <div className="flex flex-wrap gap-1.5">
                            {m.parsed.corrections.map((c, i) => (
                              <ToggleChip key={`corr-${i}`} on={c.on}
                                onToggle={() => patchParsed(mi, p => ({
                                  ...p,
                                  corrections: p.corrections.map((x, xi) => xi === i ? { ...x, on: !x.on } : x),
                                }))}>
                                {c.name} → {[c.grams && `${c.grams}g`, c.meal].filter(Boolean).join(' · ')}
                              </ToggleChip>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 🏃 Activities */}
                      {m.parsed.activities.length > 0 && (
                        <div>
                          <GroupHeader icon="🏃" title="Activities" count={m.parsed.activities.filter(a => a.on).length} />
                          <div className="flex flex-wrap gap-1.5">
                            {m.parsed.activities.map((a, i) => (
                              <ToggleChip key={a.id} on={a.on} onToggle={() => toggleListItem(mi, 'activities', i)}>
                                {a.label}
                              </ToggleChip>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 🧃 ACV */}
                      {m.parsed.acv.length > 0 && (
                        <div>
                          <GroupHeader icon="🧃" title="ACV" count={m.parsed.acv.filter(a => a.on).length} />
                          <div className="flex flex-wrap gap-1.5">
                            {m.parsed.acv.map((a, i) => (
                              <ToggleChip key={a.id} on={a.on} onToggle={() => toggleListItem(mi, 'acv', i)}>
                                {a.label}
                              </ToggleChip>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 💊 Supplements */}
                      {m.parsed.supplements.length > 0 && (
                        <div>
                          <GroupHeader icon="💊" title="Supplements" count={m.parsed.supplements.filter(s => s.on).length} />
                          <div className="flex flex-wrap gap-1.5">
                            {m.parsed.supplements.map((s, i) => (
                              <ToggleChip key={s.id} on={s.on} onToggle={() => toggleListItem(mi, 'supplements', i)}>
                                {s.label}
                              </ToggleChip>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 💧 Water */}
                      {m.parsed.water_ml_add != null && (
                        <div>
                          <GroupHeader icon="💧" title="Water" />
                          <ToggleChip on={m.parsed.waterOn}
                            onToggle={() => patchParsed(mi, p => ({ ...p, waterOn: !p.waterOn }))}>
                            +{m.parsed.water_ml_add >= 1000
                              ? `${(m.parsed.water_ml_add / 1000).toFixed(m.parsed.water_ml_add % 1000 ? 2 : 0)}L`
                              : `${m.parsed.water_ml_add}ml`}
                          </ToggleChip>
                        </div>
                      )}

                      {/* 🌙 Sleep */}
                      {m.parsed.sleep && (
                        <div>
                          <GroupHeader icon="🌙" title="Sleep" />
                          <ToggleChip on={m.parsed.sleepOn}
                            onToggle={() => patchParsed(mi, p => ({ ...p, sleepOn: !p.sleepOn }))}>
                            {m.parsed.sleep.bedtime || '—'} → {m.parsed.sleep.waketime || '—'}
                          </ToggleChip>
                        </div>
                      )}

                      {/* 🥗 Foods */}
                      {m.parsed.foods.length > 0 && (
                        <div>
                          <GroupHeader icon="🥗" title="Food" count={m.parsed.foods.filter(f => f.on).length} />
                          <AIFoodReview foods={m.parsed.foods} disabled={m.applied || applying}
                            mealSlots={mealSlots} autoSlot={autoSlot}
                            onToggle={fi => toggleListItem(mi, 'foods', fi)}
                            onGrams={(fi, value) => setGrams(mi, fi, value)}
                            onPatch={(fi, patch) => patchParsed(mi, p => ({ ...p, foods: p.foods.map((f, i) => i === fi ? { ...f, ...patch } : f) }))}
                            onMacros={(fi, per) => setMacros(mi, fi, per)} />
                        </div>
                      )}

                      {(m.noteProposed || m.parsed.notes || m.parsed.notesOn) && <div className="bg-charcoal rounded-xl p-3">
                        <label className="flex gap-2 items-center text-sm mb-2"><input type="checkbox" checked={!!m.parsed.notesOn} disabled={m.applied || applying}
                          onChange={e => patchParsed(mi, p => ({ ...p, notesOn: e.target.checked }))} /> Daily notes & how you feel</label>
                        <textarea aria-label="Review daily note" value={m.parsed.notes} disabled={m.applied || applying} maxLength={2000}
                          onChange={e => patchParsed(mi, p => ({ ...p, notes: e.target.value }))} className="w-full text-sm rounded-lg p-2" />
                      </div>}
                      {/* 💪 Workouts — now actually saved to the Workout section */}
                      {m.parsed.workouts.length > 0 && (
                        <div>
                          <GroupHeader icon="💪" title="Workouts" count={m.parsed.workouts.filter(w => w.on).length} />
                          <div className="space-y-1.5">
                            {m.parsed.workouts.map((w, wi) => (
                              <button key={wi} onClick={() => toggleListItem(mi, 'workouts', wi)}
                                disabled={m.applied}
                                className={`w-full flex items-center justify-between bg-charcoal border rounded-xl px-3 py-2.5 transition-all ${
                                  w.on ? 'border-white/[0.08]' : 'border-white/[0.04] opacity-40'
                                }`}>
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-tiny flex-shrink-0 ${
                                    w.on ? 'bg-gold text-charcoal' : 'bg-white/[0.08] text-transparent'
                                  }`}>✓</span>
                                  <div className="min-w-0">
                                    <p className={`text-note font-semibold truncate ${w.on ? 'text-white' : 'text-mid line-through'}`}>
                                      {w.name}{w.qty_text ? ` — ${w.qty_text}` : ''}
                                    </p>
                                    {w.sets?.length > 0 && (
                                      <p className="text-eyebrow text-mid truncate">
                                        {w.sets.map((st, si) => `${st.reps}×${st.weight_kg || 'BW'}${st.weight_kg ? 'kg' : ''}`).join(' · ')}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                {w.calories_burned != null && (
                                  <p className="text-caption font-semibold text-gold-light flex-shrink-0">~{w.calories_burned} kcal</p>
                                )}
                              </button>
                            ))}
                            <p className="text-eyebrow text-lo px-1">
                              {m.parsed.workouts.some(w => w.on && w.sets?.length)
                                ? 'Sets and reps are included in this workout review.'
                                : 'Exact sets and reps can be added in the Workout section.'}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* ── Apply / Applied / Undo ── */}
                      {m.editing && !m.applied && (
                        <p className="text-caption text-gold font-medium">
                          ✏️ Editing — that entry has been rolled back. Adjust below and apply again.
                        </p>
                      )}

                      {countIncluded(m.parsed) > 0 && !m.applied && !m.undone && (
                        <button data-testid="ai-card-save" onClick={() => applyAll(mi)} disabled={applying || labBusy || !assistantReady || !!foodReviewError(m.parsed.foods)}
                          style={{ minHeight: 48 }}
                          className="w-full rounded-xl text-sm font-bold bg-gold text-charcoal active:scale-[0.98] disabled:opacity-40 transition-all">
                          {applying ? 'Saving…' : 'Save'} {countIncluded(m.parsed)} {plural(countIncluded(m.parsed), 'item')} to today's log
                        </button>
                      )}

                      {m.saveNotice && <p role="status" className="text-caption text-warn">{m.saveNotice}</p>}
                      <AIReviewSaveStatus card={m} disabled={applying || labBusy || !assistantReady}
                        onRetry={() => applyAll(mi)} onEdit={() => editApplied(mi)} onUndo={() => undo(mi)} onRetryUndo={() => retryUndo(mi)} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="bg-surface border border-hair rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-gold animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gold animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gold animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Suggestion chips ── */}
      {messages.length === 0 && (
        <div className="-mx-4 px-4 mt-3 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }} data-testid="ai-suggestions">
          {SUGGESTION_CHIPS.map((chip, i) => (
            <button key={i} onClick={() => { setInput(chip); inputRef.current?.focus(); }}
              style={{ whiteSpace: 'nowrap', flexShrink: 0, minHeight: 36 }}
              className="text-xs bg-surface border border-white/[0.10] hover:border-gold/40 rounded-full px-3.5 py-1.5 text-mid transition-colors">
              {chip}
            </button>
          ))}
        </div>
      )}

    </section>
  );

  return (<>
    {overlay ? (composerOpen && createPortal(
      <div className="member-assistant-overlay" role="dialog" aria-modal="true" aria-label="FitLife AI daily logging" ref={overlayRef}>
        <div className="member-assistant-head"><div><strong>FitLife AI</strong><p>One place for your whole day.</p></div>
          <button type="button" className="member-theme" onClick={() => useAIChat.getState().closeComposer()} aria-label="Close AI assistant"><Icon name="close" size={19} /></button></div>
        <div className="member-assistant-scroll" style={{ paddingBottom: composerHeight + kbInset }}>
          {thread}
        </div>
      </div>, document.body)) : thread}

    {/* ── Composer — docked above the bottom nav, on every scroll position ──
        Portaled to <body> so no transformed ancestor (Stagger, motion) can
        break `position: fixed`. Rides above the soft keyboard: the viewport
        meta asks Chrome to resize the layout viewport, and useKeyboardInset
        covers iOS, which ignores that and needs the visualViewport delta. */}
    {typeof document !== 'undefined' && composerOpen && createPortal(
      <div data-testid="composer" className={`fixed left-0 right-0 z-[45] pointer-events-none fade-up ${overlay ? 'member-assistant-composer' : ''}`}
        style={{ bottom: `calc(${(overlay ? 8 : composerFocused ? COMPOSER_BOTTOM_FOCUSED_PX : COMPOSER_BOTTOM_PX) + kbInset}px + env(safe-area-inset-bottom))` }}>
      <div className="max-w-md mx-auto px-3 pointer-events-auto">
      <div className="glass glass-solid rounded-2xl shadow-float px-3 pt-2 pb-2" data-testid="composer-bar">
        <UsualMeals active={composerOpen && !messages.some(m => !m.applied && m.parsed?.foods?.length)}
          autoSlot={autoSlot} disabled={!assistantReady || busy || photoBusy || labBusy || applying}
          onChoose={suggestion => { inputRef.current?.blur(); setMessages(m => [...m, usualReview(suggestion, today())]); }} />
        {vc.card}
        {(photoBusy || labBusy) && <p className="text-caption text-gold py-2" role="status">{photoBusy ? 'Analysing your photo and calculating nutrition…' : 'Reading your document…'}</p>}
        {logError && <p className="text-caption text-danger pb-2" role="alert">{logError}</p>}
        {!assistantReady && <p className="text-caption text-warn py-2">{logLoading ? 'Loading your daily log…' : 'Open Today before logging with AI. Your draft is kept.'}</p>}

        {/* Sprint 5b.1: two rows. The text gets the full width and grows to
            five lines (a dictated day is often three), the tools sit
            underneath — so "2 idli, sambar, 100g whey protein 1 scoop, walked
            30 min" is READABLE while you are still typing it. Enter sends;
            Shift+Enter is a new line. */}
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => useAIChat.getState().setComposerFocused(true)}
            onBlur={() => useAIChat.getState().setComposerFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              if (e.key === 'Escape') {
                e.preventDefault();
                if (input.trim()) e.currentTarget.blur();                    // step away, keep the draft
                else useAIChat.getState().closeComposer();                    // nothing typed → put the bar away
              }
            }}
            placeholder="Ask or log anything…"
            aria-label="Tell FitLife about your day"
            data-testid="composer-input"
            style={{ maxHeight: 5 * 22 + 16 }}
            className={`block w-full bg-surface border border-white/[0.10] rounded-2xl pl-3 py-2.5 text-body leading-[22px] text-white placeholder-lo outline-none resize-none focus:border-gold/40 transition-colors ${input ? 'pr-10' : 'pr-3'}`}
          />
          {input && (
            <button type="button" onClick={clearDraft} aria-label="Clear message" data-testid="composer-clear"
              style={{ minWidth: 36, minHeight: 36 }}
              className="absolute top-1 right-1 flex items-center justify-center rounded-full text-lo hover:text-white active:scale-95 transition">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 mt-1.5">
          <AIAttachments galleryRef={galleryRef} labRef={labRef} disabled={labBusy || photoBusy || busy || applying || !assistantReady} />
          <input ref={labRef} type="file" accept="application/pdf,image/*"
            onClick={rememberPicker}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (consumePicker(e.currentTarget) && f) sendLabReport(f); }}
            style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()}
            disabled={photoBusy || busy || labBusy || applying || !assistantReady}
            aria-label="Open camera" title="Snap"
            style={{ minWidth: 40, minHeight: 40 }}
            className={`flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${
              photoBusy ? 'text-lo animate-pulse' : 'text-mid hover:text-gold-light'
            }`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" data-testid="ai-camera-input"
            onClick={rememberPicker}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; acceptPhoto(f, e.currentTarget, sendPhoto); }}
            onCancel={() => { replacingPhoto.current = null; pickerContext.current = null; }}
            style={{ display: 'none' }} />
          <input ref={galleryRef} type="file" accept="image/*" data-testid="ai-gallery-input"
            onClick={rememberPicker}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; acceptPhoto(f, e.currentTarget, sendPhoto); }} style={{ display: 'none' }} />
          {vc.micButton}
          <span className="flex-1" />
          {input.trim() && (
            <span className="hidden sm:block text-tiny text-lo tabular-nums mr-1" aria-hidden="true">{input.trim().length}</span>
          )}
          <button
            onClick={() => send()}
            disabled={!input.trim() || busy || photoBusy || labBusy || applying || !assistantReady}
            aria-label="Send"
            style={{ minWidth: 44, minHeight: 44 }}
            className={`flex items-center justify-center rounded-full transition-all flex-shrink-0 ${
              input.trim() && !busy
                ? 'bg-gold text-charcoal shadow-[0_2px_12px_rgba(212,175,55,0.4)] active:scale-95'
                : 'bg-white/[0.05] text-lo'
            }`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
      </div>
      </div>,
      document.body,
    )}
    </>
  );
}
