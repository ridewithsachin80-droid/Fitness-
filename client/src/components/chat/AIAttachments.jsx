import { useEffect, useRef, useState } from 'react';
import { Icon } from '../primitives';

/** Secondary inputs stay discoverable without filling the main composer. */
export default function AIAttachments({ galleryRef, labRef, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    const outside = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const choose = input => { input.current?.click(); setOpen(false); trigger.current?.focus(); };
  return <div className="member-attachments" ref={ref} onKeyDown={e => {
    if (open && e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button type="button" ref={trigger} disabled={disabled} aria-label="More attachments" aria-expanded={open}
      aria-controls="ai-attachment-options" onClick={() => setOpen(v => !v)}><Icon name="plus" size={21} /></button>
    {open && <div id="ai-attachment-options" className="member-attachment-menu" role="group" aria-label="Attachment options">
      <button type="button" disabled={disabled} onClick={() => choose(galleryRef)} aria-label="Choose photo from gallery"><Icon name="camera" size={18} /> Photo library</button>
      <button type="button" disabled={disabled} onClick={() => choose(labRef)} aria-label="Upload a lab report"><Icon name="note" size={18} /> Lab report or PDF</button>
    </div>}
  </div>;
}
