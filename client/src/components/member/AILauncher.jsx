import { Icon } from '../primitives';
import { useAIChat } from '../../store/aiChatStore';

export default function AILauncher({ compact = false }) {
  const openChat = useAIChat(s => s.openChat);
  return <section className={compact ? 'member-ai-launch compact' : 'member-ai-launch'} data-testid="ai-launcher">
    <div className="member-ai-eyebrow"><Icon name="spark" size={17} /> FITLIFE INTELLIGENCE</div>
    {!compact && <><h2>Your day.<br />All in one place.</h2>
      <p>Log anything. Let AI take care of the details.</p></>}
    <div className="member-ai-actions">
      <button type="button" data-testid="ai-speak" onClick={() => openChat('voice')}><Icon name="mic" size={21} /><span>Speak</span></button>
      <button type="button" data-testid="ai-snap" onClick={() => openChat('photo')}><Icon name="camera" size={21} /><span>Snap</span></button>
      <button type="button" data-testid="ai-type" onClick={() => openChat('text')}><Icon name="chat" size={21} /><span>Type</span></button>
    </div>
  </section>;
}
