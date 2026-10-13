import { useCallback, useEffect, useRef, useState } from 'react';
import { today } from '../constants';
import { useAuthStore } from '../store/authStore';
import { useAIChat } from '../store/aiChatStore';
import { useLogStore } from '../store/logStore';
import { nextRequestId, requestBelongsToChat, requestFailureMessage } from '../utils/aiRequestRecovery';

const MAX_FAILED_PHOTOS = 3;

/** Own the lifetime of in-memory AI retries and native file selections.
 * Every request remains bound to its sign-in, day and conversation. */
export default function useAIRequestRecovery() {
  const setMessages = useAIChat(s => s.setMessages);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [labBusy, setLabBusy] = useState(false);
  const replacingPhoto = useRef(null);
  const pickerContext = useRef(null);
  const photoFlight = useRef(false);
  const parseFlight = useRef(false);
  const labFlight = useRef(false);
  const activeRequests = useRef(new Map());
  const [requestEdit, setRequestEdit] = useState(null);

  const requestCurrent = useCallback(request => useLogStore.getState().date === request?.day
    && requestBelongsToChat(request, useAuthStore.getState(), useAIChat.getState(), today()), []);
  const pickerCurrent = scope => {
    const auth = useAuthStore.getState();
    return !!scope && scope.owner === (auth.user?.id ?? null) && scope.sessionVersion === auth.sessionVersion
      && scope.day === today() && scope.day === useLogStore.getState().date
      && scope.day === useAIChat.getState().dayKey;
  };
  const rememberPicker = event => {
    const auth = useAuthStore.getState();
    pickerContext.current = { owner: auth.user?.id ?? null, sessionVersion: auth.sessionVersion,
      day: today(), input: event.currentTarget };
  };
  const consumePicker = inputElement => {
    const scope = pickerContext.current;
    pickerContext.current = null;
    return scope?.input === inputElement && pickerCurrent(scope);
  };
  const newRequest = (kind, text, { silent = false, payload = null, file = null } = {}) => {
    useAIChat.getState().ensureFreshDay(today());
    const auth = useAuthStore.getState();
    const request = { id: nextRequestId(), kind, day: today(), owner: auth.user?.id ?? null,
      sessionVersion: auth.sessionVersion, payload, file };
    setMessages(previous => {
      if (silent) {
        let lastUser = previous.length - 1;
        while (lastUser >= 0 && previous[lastUser].role !== 'user') lastUser--;
        if (lastUser >= 0) return previous.map((m, i) => i === lastUser
          ? { ...m, requestIds: [...(m.requestIds || []), request.id] } : m);
      }
      return [...previous, { role: 'user', text, requestId: request.id }];
    });
    return request;
  };
  const beginRequest = request => {
    const controller = new AbortController();
    activeRequests.current.set(request.id, { request, controller });
    setMessages(previous => previous.filter(m => m.failedRequest?.id !== request.id));
    return controller;
  };
  const failRequest = (request, error) => {
    if (!requestCurrent(request)) return;
    if (request.kind === 'lab') {
      setMessages(previous => [...previous.filter(m => m.pendingRequest !== request.id),
        { role: 'ai', error: true, text: 'Your document could not be read. Please check your connection and attach it again.' }]);
      return;
    }
    setMessages(previous => {
      const remaining = previous.filter(m => m.failedRequest?.id !== request.id);
      const olderPhotos = remaining.filter(m => m.failedRequest?.kind === 'photo');
      const expired = new Set(request.kind === 'photo'
        ? olderPhotos.slice(0, Math.max(0, olderPhotos.length - MAX_FAILED_PHOTOS + 1)) : []);
      return [...remaining.map(m => {
        if (!expired.has(m)) return m;
        m.failedRequest.file = null; m.failedRequest.payload = null; m.failedRequest.invalidated = true;
        return { ...m, failedRequest: null, text: 'Only your three latest failed photos are kept for retry. Please attach this older photo again.' };
      }), { role: 'ai', error: true, text: requestFailureMessage(error, request.kind), failedRequest: request }];
    });
  };
  const finishRequest = request => activeRequests.current.delete(request.id);

  useEffect(() => {
    const invalidate = (state, previous) => {
      if (!pickerCurrent(pickerContext.current)
        || (state?.messages?.length === 0 && previous?.messages?.length > 0)) pickerContext.current = null;
      const stalePending = new Set();
      for (const [id, entry] of activeRequests.current) {
        if (requestCurrent(entry.request)) continue;
        entry.request.invalidated = true;
        entry.request.file = null;
        entry.request.payload = null;
        entry.controller.abort();
        activeRequests.current.delete(id);
        if (entry.request.kind === 'lab') stalePending.add(id);
        if (photoFlight.current === id) { photoFlight.current = false; setPhotoBusy(false); }
        if (parseFlight.current === id) { parseFlight.current = false; setBusy(false); }
        if (labFlight.current === id) { labFlight.current = false; setLabBusy(false); }
      }
      const stale = useAIChat.getState().messages.filter(m => m.failedRequest && !requestCurrent(m.failedRequest));
      if (stale.length || stalePending.size) {
        for (const m of stale) { m.failedRequest.invalidated = true; m.failedRequest.file = null; m.failedRequest.payload = null; }
        const expired = new Set(stale);
        setMessages(previous => previous.filter(m => !stalePending.has(m.pendingRequest)).map(m => expired.has(m)
          ? { ...m, failedRequest: null, text: 'This request has expired. Return to today and add it again.' } : m));
      }
      if (replacingPhoto.current && !requestCurrent(replacingPhoto.current)) replacingPhoto.current = null;
      setRequestEdit(current => current && requestCurrent(current.request) ? current : null);
    };
    const unsubscribeChat = useAIChat.subscribe(invalidate);
    const unsubscribeAuth = useAuthStore.subscribe(invalidate);
    const unsubscribeLog = useLogStore.subscribe(invalidate);
    return () => {
      unsubscribeChat(); unsubscribeAuth(); unsubscribeLog();
      pickerContext.current = null;
      replacingPhoto.current = null;
      // Leaving Today cancels capture work. A retained failed request still
      // belongs to the store and can be retried when the member comes back.
      for (const { request, controller } of activeRequests.current.values()) {
        controller.abort();
        failRequest(request, { code: 'ECONNABORTED' });
      }
      activeRequests.current.clear();
    };
  }, [requestCurrent]);


  const acceptPhoto = (file, inputElement, onPhoto) => {
    const replaced = replacingPhoto.current;
    replacingPhoto.current = null;
    if (!consumePicker(inputElement) || !file) return;
    if (replaced) {
      replaced.invalidated = true; replaced.file = null; replaced.payload = null;
      setMessages(previous => previous.filter(m => m.failedRequest?.id !== replaced.id));
    }
    onPhoto(file);
  };

  return {
    busy, setBusy, photoBusy, setPhotoBusy, labBusy, setLabBusy,
    replacingPhoto, pickerContext, photoFlight, parseFlight, labFlight,
    requestEdit, setRequestEdit, requestCurrent, rememberPicker, consumePicker, acceptPhoto,
    newRequest, beginRequest, failRequest, finishRequest,
  };
}
