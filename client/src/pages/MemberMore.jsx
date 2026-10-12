import { Link } from 'react-router-dom';
import { MemberBottomNav } from '../components/UI';
import { Icon } from '../components/primitives';
import ThemeToggle from '../components/member/ThemeToggle';

const groups = [
  ['Your daily tools', [
    ['calendar', 'Your complete plan', 'Meals, training and recovery', '/plan'],
    ['food', 'Food & saved meals', 'Search, repeat meals, portions and barcode', '/?open=food'],
    ['check', 'Daily checklist', 'Supplements and prescribed habits', '/?open=protocol'],
    ['pill', 'Nutrition details', 'Macros, vitamins and minerals', '/?open=nutrition'],
    ['spark', 'Meal ideas', 'Suggestions that fit your plan', '/?open=mealidea'],
    ['note', 'Your daily entries', 'Review, correct or add a note', '/?section=log'],
  ]],
  ['Your care', [
    ['chat', 'Coach & check-ins', 'Messages, recovery, photos and voice check-ins', '/?section=insights'],
    ['user', 'Profile & health', 'Your details, targets, reports and portion memory', '/profile'],
    ['trend', 'Progress', 'Trends, weekly reports and your journey', '/progress'],
    ['refresh', 'Connected devices', 'Sync supported devices and view status', '/devices'],
    ['gear', 'Preferences', 'Appearance, text size, voice and reminders', '/settings'],
  ]],
];

/** All existing member routes remain reachable from a calm, labelled directory. */
export default function MemberMore() {
  return <div className="member-more min-h-screen">
    <header className="member-more-header"><div><span className="member-wordmark">fitlife</span><h1>More, when you need it.</h1></div><ThemeToggle /></header>
    <main>{groups.map(([title, links]) => <section key={title} aria-label={title}>
      <h2>{title}</h2>
      {links.map(([icon, label, hint, to]) => <Link className="member-more-link" key={to} to={to}>
        <Icon name={icon} size={20} /><span><strong>{label}</strong><small>{hint}</small></span><Icon name="chevron-right" size={16} />
      </Link>)}
    </section>)}</main>
    <MemberBottomNav />
  </div>;
}
