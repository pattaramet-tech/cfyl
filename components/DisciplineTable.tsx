import type { PointSource, SuspensionDetails, SuspendedMatchDetail } from '@/lib/suspension-shared';
import { getCurrentAccumulatedPoints } from '@/lib/suspension-shared';
import { getSuspensionStatus, getBangkokToday } from '@/lib/suspension-status';

interface CardDetail {
  id: string;
  card_type: string;
  minute?: number | null;
  note?: string | null;
  match_id: string;
  match?: {
    matchday: string | number;
    match_date?: string | null;
    match_time?: string | null;
  } | null;
}

export interface Suspension {
  id: string;
  player_id: string;
  full_name: string;
  team_name: string;
  shirt_no?: number;
  total_points: number;
  ban_matches: number;
  suspension_reason: string | null;
  suspension_details?: SuspensionDetails | null;
  point_sources?: PointSource[];
  card_details?: CardDetail[];
}

interface DisciplineTableProps {
  records: Suspension[];
}

function pointColorClass(points: number): string {
  if (points >= 12) return 'bg-red-600';
  if (points >= 6) return 'bg-orange-500';
  if (points > 0) return 'bg-amber-500';
  return 'bg-slate-300';
}

function getCardTypeLabel(cardType: string): string {
  switch (cardType) {
    case 'yellow':
      return 'ใบเหลือง';
    case 'second_yellow':
      return 'ใบเหลืองที่ 2';
    case 'red':
      return 'ใบแดง';
    default:
      return cardType;
  }
}

function getCardPointsValue(cardType: string): number {
  switch (cardType) {
    case 'yellow':
      return 2;
    case 'second_yellow':
      return 4;
    case 'red':
      return 6;
    default:
      return 0;
  }
}

function getCardMatchdayNumber(card: CardDetail): number {
  const raw = card.match?.matchday;
  if (raw == null) return 999;
  if (typeof raw === 'number') return raw;
  const m = String(raw).match(/\d+/);
  return m ? parseInt(m[0], 10) : 999;
}

function PointHistorySection({ pointSources }: { pointSources: PointSource[] }) {
  if (pointSources.length === 0) {
    return (
      <p className="text-xs text-slate-400 italic">ไม่มีประวัติคะแนนสะสมจากใบเหลือง</p>
    );
  }
  return (
    <div className="space-y-1">
      {pointSources.map((src, i) => (
        <div key={i} className="text-xs text-slate-600">
          MD{src.matchday} · {src.reason} · +{src.points} ({src.points_before}→{src.points_after})
        </div>
      ))}
    </div>
  );
}

function NextMatchBadge({ match, is_home }: { match: SuspendedMatchDetail; is_home: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="font-bold text-red-700">MD{match.matchday}</span>
      <span className="text-slate-400">vs</span>
      <span className="font-semibold text-slate-700">{match.opponent_name}</span>
      <span className="text-slate-400">({is_home ? 'เหย้า' : 'เยือน'})</span>
    </span>
  );
}

export function DisciplineTable({ records }: DisciplineTableProps) {
  const today = getBangkokToday();

  // Public view: emphasise players still relevant — hide served & normal (0 pts)
  const visible = records.filter((r) => {
    const key = getSuspensionStatus(r, today).key;
    return key !== 'served' && key !== 'normal';
  });

  if (visible.length === 0) {
    return (
      <div className="cfyl-empty">ไม่มีผู้เล่นที่ติดโทษแบนหรือสะสมคะแนนอยู่ในขณะนี้</div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-amber-400 rounded-full" />
          <span>2-4 คะแนน — เฝ้าระวัง</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-red-500 rounded-full" />
          <span>6+ คะแนน — ติดโทษแบน</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-slate-300 rounded-full" />
          <span>ไม่พบโปรแกรมนัดถัดไป</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-blue-300 rounded-full" />
          <span>วันนี้ = นัดที่ถูกแบน</span>
        </div>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {visible.map((record) => {
          const status = getSuspensionStatus(record, today);
          const suspendedMatches = record.suspension_details?.suspended_matches || [];
          const cardDetails = record.card_details || [];
          const currentPoints = getCurrentAccumulatedPoints(record);
          return (
            <div key={record.id} className="cfyl-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800">
                    {record.full_name}
                    {record.shirt_no ? (
                      <span className="ml-1.5 text-xs text-slate-400 font-normal">#{record.shirt_no}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{record.team_name}</p>
                </div>
                <span className={`shrink-0 ${pointColorClass(currentPoints)} text-white rounded-full px-2.5 py-0.5 font-bold text-xs`}>
                  {currentPoints} pts
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`cfyl-badge ${status.color}`}>
                  {status.emoji} {status.label}
                </span>
                {record.ban_matches > 0 && (
                  <span className="cfyl-badge bg-red-50 text-red-700">แบน {record.ban_matches} นัด</span>
                )}
              </div>

              {record.ban_matches > 0 && cardDetails.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                  <p className="text-xs font-semibold text-slate-600 mb-1">สาเหตุโทษแบน:</p>
                  {(() => {
                    const sortedCardDetails = [...cardDetails].sort((a, b) => {
                      const mdDiff = getCardMatchdayNumber(a) - getCardMatchdayNumber(b);
                      if (mdDiff !== 0) return mdDiff;
                      return (a.minute ?? 999) - (b.minute ?? 999);
                    });
                    return sortedCardDetails.map((card) => {
                      const matchdayNum = typeof card.match?.matchday === 'string'
                        ? card.match.matchday.replace(/\D/g, '')
                        : card.match?.matchday;
                      const minuteText = card.minute ? `นาที ${card.minute}` : 'ไม่ระบุนาที';
                      const pointsValue = getCardPointsValue(card.card_type);
                      return (
                        <div key={card.id} className="text-xs text-slate-600">
                          MD{matchdayNum} · {getCardTypeLabel(card.card_type)} · {minuteText} · +{pointsValue}
                        </div>
                      );
                    });
                  })()}
                </div>
              )}

              {suspendedMatches.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                  <p className="text-xs font-semibold text-slate-600 mb-1">นัดที่ถูกแบน:</p>
                  {suspendedMatches.map((m) => (
                    <NextMatchBadge key={m.match_id} match={m} is_home={m.is_home} />
                  ))}
                </div>
              )}

              {record.ban_matches > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-xs font-semibold text-slate-600 mb-1">ประวัติคะแนนสะสม:</p>
                  <PointHistorySection pointSources={record.point_sources || []} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="cfyl-table">
          <thead>
            <tr>
              <th className="text-left">ชื่อนักกีฬา</th>
              <th className="text-left">ทีม</th>
              <th className="text-center w-12">เบอร์</th>
              <th className="text-center">คะแนน</th>
              <th className="text-center">แบน</th>
              <th className="text-left">นัดที่ถูกแบน</th>
              <th className="text-center">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((record, index) => {
              const status = getSuspensionStatus(record, today);
              const suspendedMatches = record.suspension_details?.suspended_matches || [];
              const cardDetails = record.card_details || [];
              const isEvenRow = index % 2 === 0;
              const hasCardDetails = record.ban_matches > 0 && cardDetails.length > 0;
              const currentPoints = getCurrentAccumulatedPoints(record);
              return (
                <tr
                  key={record.id}
                  className={`transition hover:bg-slate-50 ${isEvenRow ? 'bg-white' : 'bg-slate-50/50'}`}
                >
                  <td className="px-3 py-3 font-semibold text-slate-800">{record.full_name}</td>
                  <td className="px-3 py-3 text-slate-600 text-xs">{record.team_name}</td>
                  <td className="px-3 py-3 text-center text-slate-500">{record.shirt_no || '—'}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`inline-block ${pointColorClass(currentPoints)} text-white rounded-full px-2.5 py-0.5 font-bold text-xs`}>
                      {currentPoints} pts
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {record.ban_matches > 0 ? (
                      <span className="inline-block bg-red-600 text-white rounded-full px-2.5 py-0.5 font-semibold text-xs">
                        {record.ban_matches} นัด
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="space-y-1.5">
                      {hasCardDetails && (
                        <div className="mb-2 pb-2 border-b border-slate-200">
                          <p className="text-xs font-semibold text-slate-600 mb-1">สาเหตุโทษแบน:</p>
                          {(() => {
                            const sortedCardDetails = [...cardDetails].sort((a, b) => {
                              const mdDiff = getCardMatchdayNumber(a) - getCardMatchdayNumber(b);
                              if (mdDiff !== 0) return mdDiff;
                              return (a.minute ?? 999) - (b.minute ?? 999);
                            });
                            return sortedCardDetails.map((card) => {
                              const matchdayNum = typeof card.match?.matchday === 'string'
                                ? card.match.matchday.replace(/\D/g, '')
                                : card.match?.matchday;
                              const minuteText = card.minute ? `นาที ${card.minute}` : 'ไม่ระบุ';
                              const pointsValue = getCardPointsValue(card.card_type);
                              return (
                                <div key={card.id} className="text-xs text-slate-600">
                                  MD{matchdayNum} · {getCardTypeLabel(card.card_type)} · {minuteText} · +{pointsValue}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      )}
                      {suspendedMatches.length > 0 ? (
                        <div className="space-y-0.5">
                          {suspendedMatches.map((m) => (
                            <NextMatchBadge key={m.match_id} match={m} is_home={m.is_home} />
                          ))}
                        </div>
                      ) : record.ban_matches > 0 ? (
                        <span className="text-xs text-slate-400 italic">ไม่พบโปรแกรมแข่งขันนัดถัดไป</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                      {record.ban_matches > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100">
                          <p className="text-xs font-semibold text-slate-600 mb-1">ประวัติคะแนนสะสม:</p>
                          <PointHistorySection pointSources={record.point_sources || []} />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`cfyl-badge ${status.color}`}>
                      {status.emoji} {status.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
