import { TournamentLegacyNotice } from '@/components/tournament/TournamentLegacyNotice';

export default function TournamentsLegacyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <TournamentLegacyNotice actionHref="/tournament/schedule" />
      {children}
    </div>
  );
}
