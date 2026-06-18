import type { Standing } from '@/types/db';

interface StandingsTableProps {
  standings: Standing[];
}

export function StandingsTable({ standings }: StandingsTableProps) {
  if (standings.length === 0) {
    return <div className="text-center py-8 text-gray-500">ไม่มีข้อมูลตารางคะแนน</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-blue-600 text-white">
            <th className="px-4 py-3 text-left font-semibold">อันดับ</th>
            <th className="px-4 py-3 text-left font-semibold">ทีม</th>
            <th className="px-4 py-3 text-center font-semibold w-12">แข่ง</th>
            <th className="px-4 py-3 text-center font-semibold w-12">ชนะ</th>
            <th className="px-4 py-3 text-center font-semibold w-12">เสมอ</th>
            <th className="px-4 py-3 text-center font-semibold w-12">แพ้</th>
            <th className="px-4 py-3 text-center font-semibold w-12">ได้</th>
            <th className="px-4 py-3 text-center font-semibold w-12">เสีย</th>
            <th className="px-4 py-3 text-center font-semibold w-12">ผลต่าง</th>
            <th className="px-4 py-3 text-center font-semibold w-12">คะแนน</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((standing, index) => (
            <tr
              key={standing.team_id}
              className={`border-b border-gray-200 ${
                index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
              } hover:bg-gray-100 transition`}
            >
              <td className="px-4 py-3 font-bold text-blue-600">{index + 1}</td>
              <td className="px-4 py-3 font-semibold text-gray-800">{standing.team_name}</td>
              <td className="px-4 py-3 text-center">{standing.played}</td>
              <td className="px-4 py-3 text-center text-green-600 font-semibold">
                {standing.wins}
              </td>
              <td className="px-4 py-3 text-center text-yellow-600 font-semibold">
                {standing.draws}
              </td>
              <td className="px-4 py-3 text-center text-red-600 font-semibold">
                {standing.losses}
              </td>
              <td className="px-4 py-3 text-center">{standing.goals_for}</td>
              <td className="px-4 py-3 text-center">{standing.goals_against}</td>
              <td className="px-4 py-3 text-center font-semibold text-blue-600">
                {standing.goal_diff > 0 ? '+' : ''}
                {standing.goal_diff}
              </td>
              <td className="px-4 py-3 text-center font-bold text-blue-600 text-lg">
                {standing.points}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
