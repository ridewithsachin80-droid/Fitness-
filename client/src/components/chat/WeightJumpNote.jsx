import { useEffect, useState } from 'react';
import api from '../../api/client';
import { shiftDateKey } from '../../constants';
import { weightJumpNote } from '../../utils/weightCheck';

/**
 * Fixes-3j (UX review finding 7): under the AI preview's weight, a gentle "please check" when it is more than 2 kg away
 * from the day before. Reads that day's log only; never blocks saving.
 */
export default function WeightJumpNote({ weightKg, day }) {
  const [prev, setPrev] = useState(null);
  useEffect(() => {
    let cancelled = false; setPrev(null);
    if (!day) return undefined;
    api.get(`/logs/${shiftDateKey(day, -1)}`).then(({ data }) => { if (!cancelled && data?.weight_kg != null) setPrev(parseFloat(data.weight_kg)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [day]);
  const note = weightJumpNote(weightKg, prev);
  if (!note) return null;
  return <p className="text-caption text-warn mt-1 px-1" role="status" data-testid="weight-jump-note">{note}</p>;
}
