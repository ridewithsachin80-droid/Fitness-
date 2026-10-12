import { Icon } from '../primitives';
import { useAIChat } from '../../store/aiChatStore';

/** Each control starts its input from the original tap; no intermediary menu. */
export default function AILauncher() {
  const openChat = useAIChat(s => s.openChat);
  return <section className="member-ai-launch" data-testid="ai-launcher" aria-label="Log anything with AI">
    <div className="member-ai-actions">
      <button type="button" data-testid="ai-speak" onClick={() => openChat('voice')} aria-label="Speak to log with AI"><Icon name="mic" size={22} /><span>Speak</span></button>
      <button type="button" data-testid="ai-snap" onClick={() => openChat('photo')} aria-label="Snap with camera"><Icon name="camera" size={22} /><span>Snap</span></button>
      <button type="button" data-testid="ai-type" onClick={() => openChat('text')} aria-label="Type to log with AI"><Icon name="keyboard" size={22} /><span>Type</span></button>
    </div>
  </section>;
}
