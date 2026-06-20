'use client';

interface Card {
  id: string;
  player_id: string;
  card_type: string;
  player?: {
    full_name: string;
    shirt_no?: number | null;
    team?: { name: string; short_name: string };
  };
}

interface SuspensionImpactPanelProps {
  cards: Card[];
}

const CARD_POINTS: Record<string, number> = {
  yellow: 2,
  second_yellow: 4,
  red: 6,
};

const CARD_LABEL: Record<string, string> = {
  yellow: '🟨 ใบเหลือง',
  second_yellow: '🟨🟥 เหลือง 2',
  red: '🟥 ใบแดง',
};

type PlayerSummary = {
  playerId: string;
  name: string;
  shirtNo: number | null | undefined;
  teamName: string;
  totalPoints: number;
  cardLabels: string[];
};

export function SuspensionImpactPanel({ cards }: SuspensionImpactPanelProps) {
  // Aggregate points per player from this match
  const playerMap: Record<string, PlayerSummary> = {};

  for (const card of cards) {
    if (!playerMap[card.player_id]) {
      playerMap[card.player_id] = {
        playerId: card.player_id,
        name: card.player?.full_name || 'Unknown',
        shirtNo: card.player?.shirt_no,
        teamName:
          card.player?.team?.name || card.player?.team?.short_name || '',
        totalPoints: 0,
        cardLabels: [],
      };
    }
    playerMap[card.player_id].totalPoints += CARD_POINTS[card.card_type] ?? 0;
    playerMap[card.player_id].cardLabels.push(
      CARD_LABEL[card.card_type] || card.card_type
    );
  }

  const players = Object.values(playerMap).sort(
    (a, b) => b.totalPoints - a.totalPoints
  );

  return (
    <div>
      <h3 className="font-semibold text-gray-800 text-base mb-1">
        ⚠️ ผลกระทบโทษแบน (ประเมิน)
      </h3>
      <p className="text-xs text-gray-400 mb-3 leading-relaxed">
        เป็นการประเมินจากใบในแมตช์นี้เท่านั้น — สถานะโทษแบนจริงตรวจสอบที่{' '}
        <a
          href="/admin/suspensions"
          target="_blank"
          className="text-blue-500 hover:underline"
        >
          หน้า Suspensions
        </a>
      </p>

      {players.length === 0 ? (
        <div className="text-center py-4 text-gray-400 text-sm border border-dashed border-gray-200 rounded-lg">
          ยังไม่มีผลกระทบโทษแบนจากแมตช์นี้
        </div>
      ) : (
        <div className="space-y-2">
          {players.map((p) => {
            const mayBan = p.totalPoints >= 6;
            return (
              <div
                key={p.playerId}
                className={`flex items-start justify-between px-3 py-2.5 rounded-lg border text-sm ${
                  mayBan
                    ? 'bg-red-50 border-red-200'
                    : 'bg-yellow-50 border-yellow-200'
                }`}
              >
                <div className="min-w-0 mr-2">
                  <p className="font-semibold text-gray-800 truncate">
                    {p.shirtNo != null ? `#${p.shirtNo} ` : ''}
                    {p.name}
                  </p>
                  {p.teamName && (
                    <p className="text-gray-500 text-xs">{p.teamName}</p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {p.cardLabels.map((label, i) => (
                      <span key={i} className="text-xs text-gray-500">
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span
                    className={`font-bold text-base ${
                      mayBan ? 'text-red-600' : 'text-yellow-700'
                    }`}
                  >
                    +{p.totalPoints} pts
                  </span>
                  {mayBan && (
                    <p className="text-xs text-red-600 font-medium mt-0.5">
                      อาจติดโทษแบน
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
