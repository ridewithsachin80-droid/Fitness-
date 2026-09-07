import Icon from './Icon';
import Pressable from './Pressable';

/**
 * EmptyState — what a card says when there is nothing in it yet.
 *
 * "— none" is a shrug. An empty state is an invitation: it names what will
 * appear here and, when there is one, offers the next step.
 *
 *   <EmptyState icon="food" title="Nothing logged yet"
 *     body="Tell me about breakfast and I'll fill this in."
 *     action={{ label: 'Log with AI', onPress: openChat }} />
 *
 * Copy rule: warm, direct, second person, one sentence for the body.
 * Hinglish variants are fine when the member chose them.
 */
export default function EmptyState({ icon, title, body, action, compact = false, className = '' }) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'py-4 px-3' : 'py-8 px-5'} ${className}`}>
      {icon && (
        <div className={`${compact ? 'w-9 h-9 mb-2' : 'w-12 h-12 mb-3'} rounded-full bg-gold/[0.08] text-gold-deep flex items-center justify-center`}>
          <Icon name={icon} size={compact ? 18 : 22} />
        </div>
      )}
      {title && <p className={`font-display font-medium text-white ${compact ? 'text-base' : 'text-lg'} leading-tight`}>{title}</p>}
      {body  && <p className={`text-mid ${compact ? 'text-note mt-1' : 'text-sm mt-1.5'} leading-relaxed max-w-[26ch]`}>{body}</p>}
      {action && (
        <Pressable variant="primary" onPress={action.onPress} className={`${compact ? 'mt-3' : 'mt-4'} text-sm`}>
          {action.label}
        </Pressable>
      )}
    </div>
  );
}
