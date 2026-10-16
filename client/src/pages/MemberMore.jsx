import { Link } from 'react-router-dom';
import { MemberBottomNav } from '../components/UI';
import { Icon } from '../components/primitives';
import ThemeToggle from '../components/member/ThemeToggle';

// 16 Oct 2026: 11 rows → 7. Plan and Progress are tabs; the daily checklist
// and the day's entries are on Today.
const groups = [
  ['Every day', [
    ['food', 'Food & saved meals', 'Search, repeat meals, portions and barcode', '/?open=food'],
    ['pill', 'Nutrition details', 'Macros, vitamins and minerals', '/?open=nutrition'],
    ['spark', 'Meal ideas', 'Suggestions that fit your plan', '/?open=mealidea'],
    ['chat', 'Coach & check-ins', 'Messages, recovery, photos and voice check-ins', '/?section=insights'],
  ]],
  ['Account', [
    ['user', 'Profile & health', 'Your details, targets, reports and portion memory', '/profile'],
    ['refresh', 'Connected devices', 'Fitbit, WHOOP and Polar', '/devices'],
    ['gear', 'Settings', 'Appearance, text size, voice and reminders', '/settings'],
  ]],
];

/** All existing member routes remain reachable from a calm, labelled directory. */
export default function MemberMore() {
  return <div className="member-more min-h-screen">
    <header className="member-more-header"><div><span className="member-wordmark">fitlife</span><h1>More</h1></div><ThemeToggle /></header>
    <main>{groups.map(([title, links]) => <section key={title} aria-label={title}>
      <h2>{title}</h2>
      {links.map(([icon, label, hint, to]) => <Link className="member-more-link" key={to} to={to}>
        <Icon name={icon} size={20} /><span><strong>{label}</strong><small>{hint}</small></span><Icon name="chevron-right" size={16} />
      </Link>)}
    </section>)}</main>
    <MemberBottomNav />
  </div>;
}
