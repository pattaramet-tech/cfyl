export type PlayerCardType = 'yellow' | 'red' | 'second_yellow';

export interface PlayerCardBreakdown {
  yellow: number;
  red: number;
  second_yellow: number;
}

export interface PlayerCardBadge {
  cardType: PlayerCardType;
  icon: string;
  count: number;
}

const EMPTY_PLAYER_CARD_BREAKDOWN: PlayerCardBreakdown = {
  yellow: 0,
  red: 0,
  second_yellow: 0,
};

export function createEmptyPlayerCardBreakdown(): PlayerCardBreakdown {
  return { ...EMPTY_PLAYER_CARD_BREAKDOWN };
}

export function buildPlayerCardBreakdown(
  cards: Array<{ player_id: string; card_type: string }>
): Map<string, PlayerCardBreakdown> {
  const byPlayer = new Map<string, PlayerCardBreakdown>();

  for (const card of cards) {
    if (!['yellow', 'red', 'second_yellow'].includes(card.card_type)) continue;

    const breakdown = byPlayer.get(card.player_id) ?? createEmptyPlayerCardBreakdown();
    breakdown[card.card_type as PlayerCardType] += 1;
    byPlayer.set(card.player_id, breakdown);
  }

  return byPlayer;
}

export function getVisiblePlayerCardBadges(
  breakdown: PlayerCardBreakdown
): PlayerCardBadge[] {
  return [
    { cardType: 'yellow', icon: '🟨', count: breakdown.yellow },
    { cardType: 'red', icon: '🟥', count: breakdown.red },
    { cardType: 'second_yellow', icon: '🟨🟨', count: breakdown.second_yellow },
  ].filter((badge) => badge.count > 0) as PlayerCardBadge[];
}
