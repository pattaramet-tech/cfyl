export interface TournamentLegacyLink {
  href: string;
  label: string;
  badge?: string;
}

export const TOURNAMENT_V2_PUBLIC_LINK: TournamentLegacyLink = {
  href: '/tournament/schedule',
  label: 'ทัวร์นาเมนต์',
};

export const TOURNAMENT_V1_PUBLIC_LINK: TournamentLegacyLink = {
  href: '/tournaments',
  label: 'Tournament V1',
  badge: 'Legacy',
};

export const TOURNAMENT_V1_ADMIN_ROLLBACK_LINKS: TournamentLegacyLink[] = [
  {
    href: '/admin/tournament-groups',
    label: 'Tournament Groups',
    badge: 'Legacy',
  },
  {
    href: '/admin/tournament-fixtures',
    label: 'Tournament Fixtures',
    badge: 'Legacy',
  },
  {
    href: '/admin/tournament-bracket',
    label: 'Tournament Bracket',
    badge: 'Legacy',
  },
];

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function shouldShowTournamentV1Links(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isTruthyFlag(env.NEXT_PUBLIC_SHOW_TOURNAMENT_V1_LINKS);
}

export function buildPublicTournamentNavLinks(
  showLegacyLinks = shouldShowTournamentV1Links(),
): TournamentLegacyLink[] {
  return showLegacyLinks
    ? [TOURNAMENT_V2_PUBLIC_LINK, TOURNAMENT_V1_PUBLIC_LINK]
    : [TOURNAMENT_V2_PUBLIC_LINK];
}

export function buildLegacyAdminRollbackLinks(
  showLegacyLinks = shouldShowTournamentV1Links(),
): TournamentLegacyLink[] {
  return showLegacyLinks ? TOURNAMENT_V1_ADMIN_ROLLBACK_LINKS : [];
}
