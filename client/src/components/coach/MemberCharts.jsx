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
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#7E8596' }} tickLine={false} axisLine={false} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: '#7E8596' }} tickLine={false} axisLine={false} />
                <Tooltip content={<WeightTooltip />} />
                {profile.start_weight && (
                  <ReferenceLine y={parseFloat(profile.start_weight)} stroke="#8C6D37"
                    strokeDasharray="4 4" label={{ value: 'Start', position: 'right', fontSize: 9, fill: '#C5A059' }} />
                )}
                {profile.target_weight && (
                  <ReferenceLine y={parseFloat(profile.target_weight)} stroke="#F0E2B6"
                    strokeDasharray="4 4" label={{ value: 'Goal', position: 'right', fontSize: 9, fill: '#F0E2B6' }} />
                )}
                {/* Sprint 9b.1: the coach's charts speak the app's language —
                    gold for the member's own line, gold-deep for the goal,
                    tinted bars for compliance. Green/red belong to status
                    (good/bad), not to "this is your weight". */}
                <Line type="monotone" dataKey="weight" stroke="#D4AF37" strokeWidth={2.5}
                  dot={{ fill: '#D4AF37', r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: '#F0E2B6' }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Sprint 6: 30-day compliance chart — tap a bar to drill into that day */}

        {complianceData.length > 1 && (
          <Card>
            <div className="flex items-center justify-between mb-2">
              <SectionTitle icon="📊">30-Day Compliance</SectionTitle>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                avg30 >= 75 ? 'bg-gold/[0.13] text-gold-light' :
                avg30 >= 50 ? 'bg-amber-400/[0.14] text-amber-400' : 'bg-red-400/[0.08] text-red-400'
              }`}>avg {avg30}%</span>
            </div>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={complianceData} margin={{ top: 2, right: 4, left: -24, bottom: 0 }}
                style={{ cursor: 'pointer' }}>
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#7E8596' }} tickLine={false} axisLine={false}
                  interval={Math.floor(complianceData.length / 5)} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: '#7E8596' }} tickLine={false} axisLine={false} />
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
                    <Cell key={i} fill={(d.score || 0) >= 75 ? '#D4AF37' : (d.score || 0) >= 50 ? 'rgba(212,175,55,0.55)' : 'rgba(212,175,55,0.28)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-eyebrow text-lo mt-1.5 text-center">Tap any bar to see what they logged that day</p>
          </Card>
        )}

  </>);
}
