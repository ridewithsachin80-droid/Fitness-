import { accent, themeColor } from '../../utils/themeColor';
import { Card, SectionTitle } from '../UI';
import { WeightTooltip } from '../../lib/coach/dayMath.jsx';
import {
  LineChart, BarChart, Bar, Cell, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';

/**
 * MemberCharts — the weight trend and the 30-day compliance chart on the
 * coach's member page (Sprint 12b). Moved verbatim from Monitor.jsx.
 * Tapping a compliance bar opens that day (onSelectLog).
 */
export default function MemberCharts({ weightData, complianceData, avg30, profile, setSelectedLog }) {
  return (<>

        {weightData.length > 1 && (
          <Card>
            <SectionTitle icon="📈">Weight Trend</SectionTitle>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={weightData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={themeColor('--fit-ink', 0.05)} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-lo)' }} tickLine={false} axisLine={false} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: 'var(--text-lo)' }} tickLine={false} axisLine={false} />
                <Tooltip content={<WeightTooltip />} />
                {profile.start_weight && (
                  <ReferenceLine y={parseFloat(profile.start_weight)} stroke={accent(0.6)}
                    strokeDasharray="4 4" label={{ value: 'Start', position: 'right', fontSize: 9, fill: 'var(--accent)' }} />
                )}
                {profile.target_weight && (
                  <ReferenceLine y={parseFloat(profile.target_weight)} stroke="rgb(var(--fit-accent) / 0.6)"
                    strokeDasharray="4 4" label={{ value: 'Goal', position: 'right', fontSize: 9, fill: 'rgb(var(--fit-accent) / 0.6)' }} />
                )}
                {/* Sprint 9b.1: the coach's charts speak the app's language —
                    gold for the member's own line, gold-deep for the goal,
                    tinted bars for compliance. Green/red belong to status
                    (good/bad), not to "this is your weight". */}
                <Line type="monotone" dataKey="weight" stroke={accent()} strokeWidth={2.5}
                  dot={{ fill: accent(), r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: accent(0.6) }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Sprint 6: 30-day compliance chart — tap a bar to drill into that day */}

        {complianceData.length > 0 && (
          <Card>
            <div className="flex items-center justify-between mb-2">
              <SectionTitle icon="📊">30-Day Compliance</SectionTitle>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                avg30 >= 75 ? 'bg-gold/[0.13] text-gold-light' :
                avg30 >= 50 ? 'bg-warn/[0.14] text-warn' : 'bg-red-400/[0.08] text-red-400'
              }`}>avg {avg30}%</span>
            </div>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={complianceData} margin={{ top: 2, right: 4, left: -24, bottom: 0 }}
                style={{ cursor: 'pointer' }}>
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: 'var(--text-lo)' }} tickLine={false} axisLine={false}
                  interval={Math.floor(complianceData.length / 5)} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: 'var(--text-lo)' }} tickLine={false} axisLine={false} />
                <Tooltip
                  content={({ active, payload }) => active && payload?.length
                    ? <div className="bg-surface border border-hair rounded-xl px-2 py-1 shadow-sm text-xs">
                        <span className="font-bold text-gold-deep">{payload[0].value}%</span>
                        <span className="text-lo ml-1">{payload[0].payload.date}</span>
                        <span className="text-ghost ml-1">· tap to view</span>
                      </div>
                    : null}
                />
                <Bar dataKey="score" radius={[2, 2, 0, 0]}
                  onClick={(data) => data?.log && setSelectedLog(data.log)}>
                  {complianceData.map((d, i) => (
                    <Cell key={i} fill={(d.score || 0) >= 75 ? accent() : (d.score || 0) >= 50 ? accent(0.55) : accent(0.28)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <label className="block mt-3 text-xs text-lo">
              Review a day
              <select aria-label="Review a day" value="" onChange={event => {
                const selected = complianceData[Number(event.target.value)];
                if (event.target.value !== '' && selected?.log) setSelectedLog(selected.log);
              }} className="mt-1 block w-full min-h-[44px] rounded-xl border border-hair bg-surface px-3 text-sm text-white">
                <option value="" disabled>Choose a logged day</option>
                {complianceData.map((day, index) => day.log && (
                  <option key={String(day.log.log_date)} value={index}>
                    {String(day.log.log_date).slice(0, 10)} · {day.score ?? 0}%
                  </option>
                ))}
              </select>
            </label>
          </Card>
        )}

  </>);
}
