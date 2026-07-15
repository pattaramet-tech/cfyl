import { TournamentLegacyNotice } from '@/components/tournament/TournamentLegacyNotice';

export const dynamic = 'force-dynamic';

export default function TournamentFixturesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <TournamentLegacyNotice actionHref="/admin/tournament" />
      {children}
    </div>
  );
}
