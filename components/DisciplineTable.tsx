interface PointSource {
  match_id: string;
  points: number;
  reason: string;
}

interface Suspension {
  player_id: string;
  full_name: string;
  team_name: string;
  shirt_no?: number;
  total_points: number;
  ban_matches: number;
  point_sources: PointSource[];
  suspension_reason: string | null;
}

interface DisciplineTableProps {
  records: Suspension[];
}

export function DisciplineTable({ records }: DisciplineTableProps) {
  if (records.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        ไม่มีข้อมูลใบเหลืองใบแดง
      </div>
    );
  }

  return (
    <div className="overflow-x-auto space-y-6">
      {/* Legend */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block w-4 h-4 bg-green-200 rounded"></span>
          <span>0-5 คะแนน</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-4 h-4 bg-yellow-200 rounded"></span>
          <span>6-11 คะแนน (แบน 1 นัด)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-4 h-4 bg-orange-300 rounded"></span>
          <span>12+ คะแนน (แบน 2 นัด)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-4 h-4 bg-red-500 rounded"></span>
          <span>ไม่พบแมตช์ถัดไป</span>
        </div>
      </div>

      {/* Table */}
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-red-600 text-white">
            <th className="px-4 py-3 text-left font-semibold">ชื่อนักกีฬา</th>
            <th className="px-4 py-3 text-left font-semibold">ทีม</th>
            <th className="px-4 py-3 text-center font-semibold w-16">เบอร์</th>
            <th className="px-4 py-3 text-center font-semibold">คะแนนโทษ</th>
            <th className="px-4 py-3 text-center font-semibold">แบน (นัด)</th>
            <th className="px-4 py-3 text-left font-semibold">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => {
            let bgColor = 'bg-white';
            if (record.ban_matches === 0) {
              bgColor = 'bg-green-50';
            } else if (record.ban_matches === 1) {
              bgColor = 'bg-yellow-50';
            } else if (record.total_points >= 12) {
              bgColor = 'bg-orange-50';
            }

            const statusBgColor =
              record.total_points >= 24
                ? 'bg-red-500'
                : record.total_points >= 12
                  ? 'bg-orange-400'
                  : record.total_points >= 6
                    ? 'bg-yellow-400'
                    : 'bg-green-400';

            return (
              <tr
                key={record.player_id}
                className={`border-b border-gray-200 ${
                  index % 2 === 0 ? bgColor : 'bg-gray-50'
                } hover:bg-gray-100 transition`}
              >
                <td className="px-4 py-3 font-semibold text-gray-800">
                  {record.full_name}
                </td>
                <td className="px-4 py-3 text-gray-700">{record.team_name}</td>
                <td className="px-4 py-3 text-center text-gray-600">
                  {record.shirt_no || '-'}
                </td>
                <td className="px-4 py-3 text-center">
                  <span
                    className={`inline-block ${statusBgColor} text-white rounded-full px-3 py-1 font-bold text-sm`}
                  >
                    {record.total_points} pts
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {record.ban_matches > 0 ? (
                    <span className="inline-block bg-red-600 text-white rounded-full px-3 py-1 font-semibold text-xs">
                      {record.ban_matches} นัด
                    </span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm">
                  {record.suspension_reason ? (
                    <span className="text-gray-700">
                      {record.suspension_reason}
                    </span>
                  ) : (
                    <span className="text-gray-400">ปกติ</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
