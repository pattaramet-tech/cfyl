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
    return <div className="cfyl-empty">ไม่มีข้อมูลดาวซัลโว</div>;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {scorers.map((scorer, index) => {
        const rank = index + 1;
        const top = rank <= 3;
        return (
          <li key={scorer.player_id} className="flex items-center gap-3 py-3">
            <span
              className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                top ? 'bg-blue-900 text-white' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {rank}
            </span>

            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-800 truncate">
                {scorer.full_name}
                {scorer.shirt_no ? (
                  <span className="ml-1.5 text-xs text-slate-400 font-normal">#{scorer.shirt_no}</span>
                ) : null}
              </p>
              <p className="text-xs text-slate-500 truncate">{scorer.team_name}</p>
            </div>

            <div className="shrink-0 flex items-baseline gap-1">
              <span className="text-xl font-bold text-blue-900">{scorer.total_goals}</span>
              <span className="text-xs text-slate-400">ประตู</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
