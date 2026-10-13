import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuthStore } from '../store/authStore';

export default function usePortionMemory(enabled) {
  const owner = useAuthStore(s => s.user?.id);
  const [state, setState] = useState({ owner:null, portions:[], error:false });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ owner, portions:[], error:false });
    if (enabled && owner) api.get('/ai-chat/portions').then(({ data }) => {
      if (live) setState({ owner, portions:Array.isArray(data.portions) ? data.portions : [], error:false });
    }).catch(() => { if (live) setState({ owner, portions:[], error:true }); });
    return () => { live = false; };
  }, [enabled, owner, retry]);
  return { portions:state.owner === owner ? state.portions : [], error:state.owner === owner && state.error,
    retry:() => setRetry(n => n + 1),
    forget:async phrase => {
      if (!owner || useAuthStore.getState().user?.id !== owner) throw new Error('Account changed');
      await api.delete('/ai-chat/portions', { data:{ phrase } });
      if (useAuthStore.getState().user?.id !== owner) throw new Error('Account changed');
      setState(s => ({ ...s, portions:s.portions.filter(p => p.phrase !== phrase) }));
    } };
}
