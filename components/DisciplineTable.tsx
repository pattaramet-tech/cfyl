interface DisciplineRecord {
  player_id: string;
  full_name: string;
  team_name: string;
  shirt_no?: number;
  yellow_cards: number;
  red_cards: number;
  total_cards: number;
  matches_banned: number;
}

interface DisciplineTableProps {
  records: DisciplineRecord[];
}

export function DisciplineTable({ records }: DisciplineTableProps) {
  if (records.length === 0) {
    return <div className="text-center py-8 text-gray-500">ไม่มีข้อมูลใบเหลืองใบแดง</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-red-600 text-white">
            <th className="px-4 py-3 text-left font-semibold">ชื่อนักกีฬา</th>
            <th className="px-4 py-3 text-left font-semibold">ทีม</th>
            <th className="px-4 py-3 text-center font-semibold w-16">เบอร์</th>
            <th className="px-4 py-3 text-center font-semibold w-20">เหลือง</th>
            <th className="px-4 py-3 text-center font-semibold w-20">แดง</th>
            <th className="px-4 py-3 text-center font-semibold w-20">รวม</th>
            <th className="px-4 py-3 text-center font-semibold w-20">แบนจำนวน</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => (
            <tr
              key={record.player_id}
              className={`border-b border-gray-200 ${
                index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
              } hover:bg-gray-100 transition`}
            >
              <td className="px-4 py-3 font-semibold text-gray-800">{record.full_name}</td>
              <td className="px-4 py-3 text-gray-700">{record.team_name}</td>
              <td className="px-4 py-3 text-center text-gray-600">{record.shirt_no || '-'}</td>
              <td className="px-4 py-3 text-center">
                <span className="inline-block bg-yellow-300 text-yellow-900 rounded-full px-3 py-1 font-semibold">
                  {record.yellow_cards}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                <span className="inline-block bg-red-400 text-white rounded-full px-3 py-1 font-semibold">
                  {record.red_cards}
                </span>
              </td>
              <td className="px-4 py-3 text-center font-semibold text-gray-800">
                {record.total_cards}
              </td>
              <td className="px-4 py-3 text-center">
                {record.matches_banned > 0 ? (
                  <span className="inline-block bg-red-600 text-white rounded-full px-3 py-1 font-semibold text-xs">
                    {record.matches_banned} นัด
                  </span>
                ) : (
                  <span className="text-gray-400">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
