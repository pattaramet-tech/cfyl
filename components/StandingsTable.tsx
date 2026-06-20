import type { Standing } from '@/types/db';

interface StandingsTableProps {
  standings: Standing[];
}

// Bottom N positions are the relegation zone (red strip, EPL-style)
const RELEGATION_COUNT = 2;

export function StandingsTable({ standings }: StandingsTableProps) {
  if (standings.length === 0) {
    return <div className="cfyl-empty">ไม่มีข้อมูลตารางคะแนน</div>;
  }

  const total = standings.length;

  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="cfyl-table min-w-[520px]">
        <thead>
          <tr>
            <th className="text-center w-10">#</th>
            <th className="text-left sticky left-0 bg-blue-900 z-10">ทีม</th>
            <th className="text-center w-10">แข่ง</th>
            <th className="text-center w-10">ช</th>
            <th className="text-center w-10">ส</th>
            <th className="text-center w-10">พ</th>
            <th className="text-center w-12">+/-</th>
            <th className="text-center w-12">คะแนน</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((standing, index) => {
            const rank = index + 1;
            const top = rank <= 2;
            const relegation = rank > total - RELEGATION_COUNT;
            return (
              <tr
                key={standing.team_id}
                className={`transition hover:bg-slate-50 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
              >
                <td
                  className={`px-3 py-3 text-center border-l-4 ${
                    relegation ? 'border-red-500' : 'border-transparent'
                  }`}
                >
                  <span
                    className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                      top ? 'bg-blue-900 text-white' : 'text-slate-500'
                    }`}
                  >
                    {rank}
                  </span>
                </td>
                <td
                  className={`px-3 py-3 font-semibold text-slate-800 sticky left-0 z-10 ${
                    index % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                  }`}
                >
                  {standing.team_name}
                </td>
                <td className="px-3 py-3 text-center text-slate-600">{standing.played}</td>
                <td className="px-3 py-3 text-center text-slate-700">{standing.wins}</td>
                <td className="px-3 py-3 text-center text-slate-700">{standing.draws}</td>
                <td className="px-3 py-3 text-center text-slate-700">{standing.losses}</td>
                <td className="px-3 py-3 text-center font-medium text-slate-700">
                  {standing.goal_diff > 0 ? '+' : ''}
                  {standing.goal_diff}
                </td>
                <td className="px-3 py-3 text-center">
                  <span className="font-bold text-blue-900 text-base">{standing.points}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex items-center gap-2 px-4 sm:px-0 pt-3 text-xs text-slate-500">
        <span className="inline-block w-3 h-3 rounded-sm bg-red-500" />
        <span>โซนตกชั้น ({RELEGATION_COUNT} อันดับสุดท้าย)</span>
      </div>
    </div>
  );
}
