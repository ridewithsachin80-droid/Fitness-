import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { usualSuggestions } from '../../utils/usualMeals';

export default function UsualMeals({ active, autoSlot, disabled, onChoose }) {
  const owner = useAuthStore(s => s.user?.id);
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState(false);
  const choosing = useRef(false);
  useEffect(() => {
    setData(null); setError(false); setExpanded(false); choosing.current = false;
    if (!active || !owner) return;
    let live = true;
    Promise.allSettled(['/foods/presets','/logs/recent-foods','/member-foods'].map(url => api.get(url)))
      .then(results => {
        if (!live || useAuthStore.getState().user?.id !== owner) return;
        const values = results.map(r => r.status === 'fulfilled' && Array.isArray(r.value.data) ? r.value.data : []);
        setData({ owner, values }); setError(results.some(r => r.status === 'rejected'));
      });
    return () => { live = false; };
  }, [active, owner, retry]);
  if (!active || !owner || data?.owner !== owner) return null;
  const suggestions = usualSuggestions(...data.values, autoSlot);
  if (!suggestions.length && !error) return null;
  const choose = suggestion => {
    if (disabled || choosing.current) return;
    choosing.current = true;
    onChoose(suggestion); setExpanded(false);
    // The parent hides this block as soon as there is a pending food review.
  };
  return <section className="usual-meals" aria-label="My usual" data-testid="usual-meals">
    {suggestions[0] && <div className="flex items-center gap-2">
      <button type="button" disabled={disabled} className="usual-primary" onClick={() => choose(suggestions[0])}>
        <span className="text-caption text-mid">My usual</span><strong>{suggestions[0].name}</strong>
        <span className="text-caption text-mid">Review & add</span>
      </button>
      {suggestions.length > 1 && <button type="button" className="usual-more" disabled={disabled}
        aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>More</button>}
    </div>}
    {expanded && <div className="usual-list">{suggestions.slice(1).map(s => <button type="button" key={s.key}
      disabled={disabled} onClick={() => choose(s)}><span>{s.name}</span><small>{s.kind}</small></button>)}</div>}
    {error && <p className="text-caption text-mid" role="status">Some usual foods couldn’t load. <button type="button"
      className="text-gold min-h-[44px]" onClick={() => setRetry(n => n + 1)}>Try again</button></p>}
  </section>;
}
