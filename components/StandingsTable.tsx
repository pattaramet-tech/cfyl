import type { Standing } from '@/types/db';

interface StandingsTableProps {
  standings: Standing[];
  /** Only the top division has a provincial representative (rank 1). */
  showProvinceRep?: boolean;
}

// Zone markers (EPL-style left strips). Champions take priority over relegation
// when a division is too small for both zones to fit without overlap.
const CHAMPIONS_COUNT = 4; // top 4 → Champions League (blue)
const RELEGATION_COUNT = 2; // bottom 2 → relegation (red)
const PROVINCE_REP_RANK = 1; // rank 1 → ตัวแทนจังหวัด

export function StandingsTable({ standings, showProvinceRep = false }: StandingsTableProps) {
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
            const isChampion = rank <= CHAMPIONS_COUNT;
            const isRelegation = !isChampion && rank > total - RELEGATION_COUNT;
            const isProvinceRep = showProvinceRep && rank === PROVINCE_REP_RANK;
            const stripClass = isChampion
              ? 'border-blue-600'
              : isRelegation
              ? 'border-red-500'
              : 'border-transparent';
            return (
              <tr
                key={standing.team_id}
                className={`transition hover:bg-slate-50 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
              >
                <td className={`px-3 py-3 text-center border-l-4 ${stripClass}`}>
                  <span
                    className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                      isChampion ? 'bg-blue-900 text-white' : 'text-slate-500'
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
                  <span>{standing.team_name}</span>
                  {isProvinceRep && (
                    <span className="block text-[11px] font-semibold text-amber-600 mt-0.5">
                      🏆 ตัวแทนจังหวัด
                    </span>
                  )}
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-0 pt-3 text-xs text-slate-500">
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-sm bg-blue-600" />
          แชมเปี้ยนส์ลีก (อันดับ 1-{CHAMPIONS_COUNT})
        </span>
        {showProvinceRep && (
          <span className="flex items-center gap-2">
            <span>🏆</span>
            อันดับ 1 = ตัวแทนจังหวัด
          </span>
        )}
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-sm bg-red-500" />
          โซนตกชั้น ({RELEGATION_COUNT} อันดับสุดท้าย)
        </span>
      </div>
    </div>
  );
}
