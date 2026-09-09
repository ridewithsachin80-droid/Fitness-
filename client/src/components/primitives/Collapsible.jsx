import { useState } from 'react';
import Icon from './Icon';
import { haptic } from '../../store/settingsStore';

/**
 * Collapsible — a row that opens into detail.
 *
 *   <Collapsible title="Body Mass Index" summary="27.9 · Over" testId="bmi">
 *     …the full card…
 *   </Collapsible>
 *
 * The summary line is the whole point: closed, a member still sees the one
 * number that matters; open, the full detail. Used on My Health (Sprint 7b)
 * to keep BMI, TDEE, metabolism, labs and portions to one line each.
 */
export default function Collapsible({ title, summary, defaultOpen = false, children, testId, icon }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-hair last:border-b-0" data-testid={testId} data-open={open ? '1' : '0'}>
      <button type="button" onClick={() => { haptic(8); setOpen(v => !v); }} aria-expanded={open}
        style={{ minHeight: 48 }}
        className="w-full flex items-center gap-3 text-left py-2.5">
        {icon && <span className="w-8 h-8 rounded-full bg-white/[0.05] text-mid flex items-center justify-center flex-shrink-0"><Icon name={icon} size={15} /></span>}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-white">{title}</span>
          {summary && !open && <span className="block text-caption text-mid truncate">{summary}</span>}
        </span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} className="text-lo flex-shrink-0" />
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}
