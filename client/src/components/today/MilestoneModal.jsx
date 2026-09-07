import { Pressable } from '../primitives';

/**
 * MilestoneModal — the celebration shown once per milestone after a save
 * (kg lost, streak, personal best). Detection lives in useTodayModel; this is
 * only the screen. Gold line-icon, never an emoji: the single largest thing on
 * the most emotionally loaded screen should be in the brand's own metal.
 */
export default function MilestoneModal({ milestone, onClose }) {
  if (!milestone) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-[85] flex items-center justify-center p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label="Milestone" data-testid="milestone">
      <div className="bg-surface rounded-3xl border border-white/[0.08] p-8 max-w-xs w-full text-center shadow-float" onClick={e => e.stopPropagation()}>
        <div className="flex justify-center mb-4">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-gold"
            strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {milestone.icon === 'flame' && <path d="M12 3s5 4 5 9a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3s1-5 1-8z" />}
            {milestone.icon === 'arm'   && <path d="M4 14a5 5 0 015-5h4l4 4v4H8a4 4 0 01-4-3z" />}
            {(milestone.icon === 'trophy' || !['flame', 'arm'].includes(milestone.icon)) && (
              <>
                <path d="M7 4h10v5a5 5 0 01-10 0V4z" />
                <path d="M7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3" />
                <path d="M12 14v4M9 21h6M10 18h4" />
              </>
            )}
          </svg>
        </div>
        <h2 className="font-display text-2xl font-medium text-white mb-2">{milestone.title}</h2>
        <p className="text-sm text-mid leading-relaxed mb-6">{milestone.body}</p>
        <Pressable variant="primary" className="w-full" onPress={onClose}>Let's keep going.</Pressable>
      </div>
    </div>
  );
}
