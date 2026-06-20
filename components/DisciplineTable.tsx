import type { SuspensionDetails, SuspendedMatchDetail } from '@/lib/suspension-calc';
import { getSuspensionStatus, getBangkokToday } from '@/lib/suspension-status';

interface Suspension {
  player_id: string;
  full_name: string;
  team_name: string;
  shirt_no?: number;
  total_points: number;
  ban_matches: number;
  suspension_reason: string | null;
  suspension_details?: SuspensionDetails | null;
}

interface DisciplineTableProps {
  records: Suspension[];
}

function NextMatchBadge({ match, is_home }: { match: SuspendedMatchDetail; is_home: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="font-bold text-red-700">MD{match.matchday}</span>
      <span className="text-gray-500">vs</span>
      <span className="font-semibold text-gray-700">{match.opponent_name}</span>
      <span className="text-gray-400">({is_home ? 'เหย้า' : 'เยือน'})</span>
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
      <div className="text-center py-8 text-gray-500">
        ไม่มีผู้เล่นที่ติดโทษแบนหรือสะสมคะแนนอยู่ในขณะนี้
      </div>
    );
  }

  return (
    <div className="overflow-x-auto space-y-4">
      {/* Legend */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-green-400 rounded-full"></span>
          <span>0 คะแนน — ปกติ</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-yellow-400 rounded-full"></span>
          <span>2-4 คะแนน — เฝ้าระวัง</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-red-500 rounded-full"></span>
          <span>6+ คะแนน — ติดโทษแบน</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-gray-300 rounded-full"></span>
          <span>ไม่พบโปรแกรมแข่งขันนัดถัดไป</span>
        </div>
      </div>

      {/* Table */}
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-red-700 text-white text-xs">
            <th className="px-3 py-3 text-left font-semibold">ชื่อนักกีฬา</th>
            <th className="px-3 py-3 text-left font-semibold">ทีม</th>
            <th className="px-3 py-3 text-center font-semibold w-12">เบอร์</th>
            <th className="px-3 py-3 text-center font-semibold">คะแนน</th>
            <th className="px-3 py-3 text-center font-semibold">แบน</th>
            <th className="px-3 py-3 text-left font-semibold">นัดที่ถูกแบน</th>
            <th className="px-3 py-3 text-center font-semibold">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((record, index) => {
            const status = getSuspensionStatus(record, today);
            const suspendedMatches = record.suspension_details?.suspended_matches || [];

            const pointColor =
              record.total_points >= 12 ? 'bg-red-600' :
              record.total_points >= 6  ? 'bg-orange-500' :
              record.total_points > 0   ? 'bg-yellow-500' : 'bg-gray-300';

            return (
              <tr
                key={record.player_id}
                className={`border-b border-gray-200 transition hover:bg-gray-50 ${
                  index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                }`}
              >
                <td className="px-3 py-3 font-semibold text-gray-800">{record.full_name}</td>
                <td className="px-3 py-3 text-gray-600 text-xs">{record.team_name}</td>
                <td className="px-3 py-3 text-center text-gray-500">{record.shirt_no || '—'}</td>
                <td className="px-3 py-3 text-center">
                  <span className={`inline-block ${pointColor} text-white rounded-full px-2.5 py-0.5 font-bold text-xs`}>
                    {record.total_points} pts
                  </span>
                </td>
                <td className="px-3 py-3 text-center">
                  {record.ban_matches > 0 ? (
                    <span className="inline-block bg-red-600 text-white rounded-full px-2.5 py-0.5 font-semibold text-xs">
                      {record.ban_matches} นัด
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  {suspendedMatches.length > 0 ? (
                    <div className="space-y-0.5">
                      {suspendedMatches.map((m) => (
                        <NextMatchBadge key={m.match_id} match={m} is_home={m.is_home} />
                      ))}
                    </div>
                  ) : record.ban_matches > 0 ? (
                    <span className="text-xs text-gray-400 italic">ไม่พบโปรแกรมแข่งขันนัดถัดไป</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${status.color}`}>
                    {status.emoji} {status.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
