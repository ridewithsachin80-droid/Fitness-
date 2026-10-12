import { Icon } from '../primitives';
import { useAIChat } from '../../store/aiChatStore';

export default function AILauncher({ compact = false }) {
  const openChat = useAIChat(s => s.openChat);
  return <section className={compact ? 'member-ai-launch compact' : 'member-ai-launch'} data-testid="ai-launcher">
    <div className="member-ai-eyebrow"><Icon name="spark" size={17} /> FITLIFE INTELLIGENCE</div>
    {!compact && <><h2>Your day.<br />All in one place.</h2>
      <p>Meals, movement, water, sleep and more.<br />Speak it, snap it or tell us.</p></>}
    <div className="member-ai-actions">
      <button type="button" onClick={() => openChat('voice')}><Icon name="mic" size={21} /><span>Speak</span></button>
      <button type="button" onClick={() => openChat('photo')}><Icon name="camera" size={21} /><span>Snap a meal</span></button>
      <button type="button" onClick={() => openChat('text')}><Icon name="chat" size={21} /><span>Type anything</span></button>
    </div>
    {!compact && <div className="member-ai-note"><Icon name="check" size={13} /> AI calculates. You review. Then save.</div>}
  </section>;
}
