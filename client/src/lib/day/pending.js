/**
 * lib/day/pending.js — what is still left to do today, as short labels.
 *
 * Feeds "Today's read" (utils/dailyRead.js) and, from Sprint 3, the
 * protocol dots on the new Today screen. One definition of "pending" so the
 * read and the dots can never disagree.
 */
import { plural } from '../../constants';

/**
 * @param {object} p
 * @param {Array}  p.activeActivities   protocol activities in force today
 * @param {Array}  p.activeACV
 * @param {Array}  p.activeSupplements
 * @param {object} p.log                today's log (activities / acv / supplements / sleep maps)
 * @param {string} p.activitiesLabel    the member's term for activities ("Activities", "Habits"…)
 * @returns {string[]} e.g. ['2 activities', '1 ACV dose', 'sleep times']
 */
export function pendingLabels({ activeActivities = [], activeACV = [], activeSupplements = [], log = {}, activitiesLabel = 'activities' }) {
  const pending = [];
  const actLeft = activeActivities.filter(a => !log.activities?.[a.id]).length;
  const acvLeft = activeACV.filter(a => !log.acv?.[a.id]).length;
  const supLeft = activeSupplements.filter(x => !log.supplements?.[x.id]).length;
  const actLabel = String(activitiesLabel).toLowerCase();
  if (actLeft) pending.push(
    `${actLeft} ${/s$/i.test(actLabel) ? actLabel : plural(actLeft, actLabel)}`);
  if (acvLeft) pending.push(`${acvLeft} ${plural(acvLeft, 'ACV dose')}`);
  if (supLeft) pending.push(`${supLeft} ${plural(supLeft, 'supplement')}`);
  if (!log.sleep?.bedtime || !log.sleep?.waketime) pending.push('sleep times');
  return pending;
}
