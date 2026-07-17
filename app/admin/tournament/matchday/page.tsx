'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface TournamentOption {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface VenueOption {
  id: string;
  name: string;
  code: string;
}

function getToken(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem('admin_token');
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return {
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function MatchdaySelectorPage() {
  const router = useRouter();
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [tournamentSlug, setTournamentSlug] = useState('');
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [venueId, setVenueId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) {
      window.location.href = '/admin/login';
      return;
    }

    fetch('/api/tournament/admin/matchday/tournaments', { headers: authHeaders(), cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 403) throw new Error('ไม่มีสิทธิ์ใช้งานหน้านี้');
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || 'โหลด Tournament ไม่สำเร็จ');
        }
        return response.json();
      })
      .then((payload) => {
        const options = (payload.data || []) as TournamentOption[];
        setTournaments(options);
        if (options.length > 0) setTournamentSlug(options[0].slug);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'โหลด Tournament ไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!tournamentSlug) return;

    fetch(`/api/tournament/admin/matchday/venues?tournament_slug=${tournamentSlug}`, {
      headers: authHeaders(),
      cache: 'no-store',
    })
      .then((response) => response.json())
      .then((payload) => {
        const options = (payload.data || []) as VenueOption[];
        setVenues(options);
        if (options.length > 0) setVenueId(options[0].id);
      })
      .catch(() => setVenues([]));
  }, [tournamentSlug]);

  const onSelectTournament = (slug: string) => {
    setTournamentSlug(slug);
    setVenues([]);
    setVenueId('');
  };

  const goToVenue = () => {
    if (!venueId || !date || !tournamentSlug) return;
    const params = new URLSearchParams({ tournament_slug: tournamentSlug, date });
    router.push(`/admin/tournament/venues/${venueId}/matchday?${params.toString()}`);
  };

  if (loading) {
    return <div className="rounded-xl bg-white p-8 shadow-sm">กำลังโหลด...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">TOURNAMENT V2</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">Matchday</span>
        </div>
        <h1 className="mt-3 text-3xl font-bold text-slate-900">ศูนย์ผลการแข่งขัน</h1>
        <p className="mt-2 text-slate-600">เลือก Tournament, สนาม และวันที่ เพื่อเริ่มบันทึกผลด่วน</p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      <section className="space-y-5 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">Tournament</span>
          <select
            value={tournamentSlug}
            onChange={(event) => onSelectTournament(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base"
          >
            {tournaments.length === 0 && <option value="">ไม่มี Tournament ที่มีสิทธิ์เข้าถึง</option>}
            {tournaments.map((tournament) => (
              <option key={tournament.id} value={tournament.slug}>
                {tournament.name} ({tournament.status})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">สนาม</span>
          <select
            value={venueId}
            onChange={(event) => setVenueId(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base"
          >
            {venues.length === 0 && <option value="">ไม่มีสนาม</option>}
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name} ({venue.code})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">วันที่</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base"
          />
        </label>

        <button
          type="button"
          onClick={goToVenue}
          disabled={!venueId || !date}
          className="w-full rounded-lg bg-blue-600 px-5 py-3.5 text-base font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          ไปหน้าสนาม
        </button>
      </section>
    </div>
  );
}
