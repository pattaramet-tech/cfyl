interface TopScorer {
  player_id: string;
  player_code: string;
  full_name: string;
  team_name: string;
  total_goals: number;
  shirt_no?: number;
}

interface TopScorersTableProps {
  scorers: TopScorer[];
}

export function TopScorersTable({ scorers }: TopScorersTableProps) {
  if (scorers.length === 0) {
    return <div className="text-center py-8 text-gray-500">ไม่มีข้อมูลดาวซัลโว</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-orange-600 text-white">
            <th className="px-4 py-3 text-left font-semibold">อันดับ</th>
            <th className="px-4 py-3 text-left font-semibold">ชื่อนักกีฬา</th>
            <th className="px-4 py-3 text-left font-semibold">ทีม</th>
            <th className="px-4 py-3 text-center font-semibold w-20">เบอร์</th>
            <th className="px-4 py-3 text-center font-semibold w-20">ประตู</th>
          </tr>
        </thead>
        <tbody>
          {scorers.map((scorer, index) => (
            <tr
              key={scorer.player_id}
              className={`border-b border-gray-200 ${
                index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
              } hover:bg-gray-100 transition`}
            >
              <td className="px-4 py-3 font-bold text-orange-600 text-lg">{index + 1}</td>
              <td className="px-4 py-3 font-semibold text-gray-800">{scorer.full_name}</td>
              <td className="px-4 py-3 text-gray-700">{scorer.team_name}</td>
              <td className="px-4 py-3 text-center text-gray-600">{scorer.shirt_no || '-'}</td>
              <td className="px-4 py-3 text-center font-bold text-orange-600 text-lg">
                {scorer.total_goals}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
