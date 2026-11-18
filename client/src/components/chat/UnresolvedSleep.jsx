import { sleepClarificationText } from '../../utils/sleepClarification';

export default function UnresolvedSleep({ value }) {
  const text = sleepClarificationText(value);
  return text ? <p className="mt-3 text-caption text-warn" role="status" data-testid="ai-sleep-clarification">{text}</p> : null;
}
