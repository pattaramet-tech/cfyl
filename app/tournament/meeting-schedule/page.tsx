'use client';

import { useEffect, useState } from 'react';
import fallbackData from '@/data/tournament-meeting-fallback.json';

interface ScheduleMatch {
  id: string;
  category_code: string;
  venue_code: string;
  date: string;
  time: string;
  home_slot: string;
  away_slot: string;
  home_team?: string;
  away_team?: string;
  court: string | number;
  round: string;
  match_number: string | number;
}

interface ScheduleSource {
  type: string;
  fallback?: boolean;
  note?: string;
}

interface ScheduleResponse {
  tournament_slug: string;
  status: string;
  is_official: boolean;
  source: string | ScheduleSource;
  competition_dates: { start: string | null; end: string | null };
  total_matches: number;
  data: ScheduleMatch[];
}

function sourceType(source: ScheduleResponse['source'] | undefined): string {
  if (!source) return 'unknown';
  return typeof source === 'string' ? source : source.type;
}

function sourceLabel(source: ScheduleResponse['source'] | undefined): string {
  if (!source) return 'unknown';
  if (typeof source === 'string') return source;
  return source.note || source.type;
}

export default function ScheduleDisplayPage() {
  const [matches, setMatches] = useState<ScheduleMatch[]>([]);
  const [scheduleMetadata, setScheduleMetadata] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterVenue, setFilterVenue] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDate, setFilterDate] = useState('');

  useEffect(() => {
    const loadSchedule = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          tournament_slug: fallbackData.tournament.slug,
          ...(filterCategory && { category_code: filterCategory }),
          ...(filterVenue && { venue_code: filterVenue }),
          ...(filterDate && { date: filterDate }),
        });

        const response = await fetch(`/api/tournament/public/schedule?${params.toString()}`, {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Failed to load schedule: ${response.status}`);

        const data: ScheduleResponse = await response.json();
        setMatches(data.data || []);
        setScheduleMetadata(data);
        setError('');
      } catch (reason) {
        console.error('Failed to load schedule:', reason);
        setError(reason instanceof Error ? reason.message : 'Failed to load schedule');
        setMatches([]);
        setScheduleMetadata(null);
      } finally {
        setLoading(false);
      }
    };

    loadSchedule();
  }, [filterVenue, filterCategory, filterDate]);

  const escapeCsvCell = (value: unknown): string => {
    const text = String(value ?? '');
    const escaped = text.replace(/"/g, '""');
    return /[",\r\n]/.test(text) ? `"${escaped}"` : escaped;
  };

  const handleExportCSV = () => {
    const rows: (string | number)[][] = [
      ['Schedule Status', 'Official', 'Source', ''],
      [
        scheduleMetadata?.status || 'unknown',
        scheduleMetadata?.is_official ? 'YES' : 'NO',
        sourceLabel(scheduleMetadata?.source),
        '',
      ],
      [''],
      ['Date', 'Time', 'Category', 'Venue', 'Court', 'Home Team', 'Away Team', 'Round'],
    ];

    matches.forEach((match) => {
      rows.push([
        match.date,
        match.time,
        match.category_code,
        match.venue_code,
        match.court,
        match.home_team || match.home_slot,
        match.away_team || match.away_slot,
        match.round,
      ]);
    });

    const csvContent = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
    const blob = new Blob(['﻿', csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `schedule-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const uniqueDates = Array.from(new Set(matches.map((match) => match.date).filter(Boolean))).sort();
  const currentSourceType = sourceType(scheduleMetadata?.source);
  const isDatabaseSchedule = currentSourceType === 'tournament_database';
  const isFallbackSchedule = !!scheduleMetadata && !isDatabaseSchedule;
  const isValidatedDraft = isDatabaseSchedule && !scheduleMetadata?.is_official;

  const statusBadge = scheduleMetadata?.is_official
    ? { label: 'ตารางทางการ', className: 'bg-emerald-100 text-emerald-800 border-emerald-300' }
    : isValidatedDraft
      ? { label: 'นำเข้าแล้ว · รอ Publish', className: 'bg-blue-100 text-blue-800 border-blue-300' }
      : { label: 'ข้อมูลตัวอย่าง', className: 'bg-amber-100 text-amber-900 border-amber-300' };

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold text-slate-900">ตารางการแข่งขัน</h1>
                {scheduleMetadata && (
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusBadge.className}`}>
                    {statusBadge.label}
                  </span>
                )}
              </div>
              <p className="mt-2 text-slate-600">Chonburi Futsal Youth League · Tournament V2</p>
            </div>
            <a
              href="/tournament/meeting-draw"
              className="no-print rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
            >
              ดูผลจับฉลาก
            </a>
          </div>

          {scheduleMetadata && (
            <div className="mt-5 grid gap-3 border-t border-slate-200 pt-5 sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">ช่วงแข่งขัน</p>
                <p className="mt-1 font-semibold text-slate-800">
                  {scheduleMetadata.competition_dates?.start || '—'} ถึง {scheduleMetadata.competition_dates?.end || '—'}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">จำนวนแมตช์</p>
                <p className="mt-1 font-semibold text-slate-800">{scheduleMetadata.total_matches} นัด</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">แหล่งข้อมูล</p>
                <p className="mt-1 font-semibold text-slate-800">
                  {isDatabaseSchedule ? 'Tournament V2 Database' : 'Fallback Schedule'}
                </p>
              </div>
            </div>
          )}
        </header>

        {isFallbackSchedule && (
          <div className="mt-5 rounded-xl border-l-4 border-amber-500 bg-amber-50 p-5 text-amber-900 print:block print:break-inside-avoid">
            <h2 className="font-bold">ข้อมูลตัวอย่างสำหรับทดสอบระบบ</h2>
            <p className="mt-1 text-sm">ยังไม่มีตารางที่ Import เข้าสู่ Tournament V2 ข้อมูลชุดนี้ยังไม่ใช่โปรแกรมการแข่งขันอย่างเป็นทางการ</p>
          </div>
        )}

        {isValidatedDraft && (
          <div className="mt-5 rounded-xl border-l-4 border-blue-500 bg-blue-50 p-5 text-blue-900 print:block print:break-inside-avoid">
            <h2 className="font-bold">ตารางถูก Import และผ่าน Validation แล้ว</h2>
            <p className="mt-1 text-sm">ข้อมูลมาจาก Tournament V2 Database แต่ยังอยู่ระหว่างตรวจสอบก่อน Publish เป็นตารางทางการ</p>
          </div>
        )}

        <section className="no-print mt-6 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600">ตัวกรอง</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            <select
              value={filterCategory}
              onChange={(event) => setFilterCategory(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm"
            >
              <option value="">ทุกประเภทการแข่งขัน</option>
              {fallbackData.categories.map((category) => (
                <option key={category.slug} value={category.code}>
                  {category.code} - {category.name}
                </option>
              ))}
            </select>

            <select
              value={filterVenue}
              onChange={(event) => setFilterVenue(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm"
            >
              <option value="">ทุกสนาม</option>
              {fallbackData.venues.map((venue) => (
                <option key={venue.id} value={venue.code}>{venue.name}</option>
              ))}
            </select>

            <select
              value={filterDate}
              onChange={(event) => setFilterDate(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm"
            >
              <option value="">ทุกวันแข่งขัน</option>
              {uniqueDates.map((date) => (
                <option key={date} value={date}>
                  {new Date(`${date}T00:00:00`).toLocaleDateString('th-TH', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </option>
              ))}
            </select>
          </div>
        </section>

        {error && (
          <div role="alert" className="mt-6 rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">
            <p className="font-semibold">โหลดตารางแข่งขันไม่สำเร็จ</p>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        )}

        {loading && <div className="mt-8 text-center text-slate-600">กำลังโหลดตารางแข่งขัน...</div>}

        {!loading && !error && matches.length === 0 && (
          <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
            ไม่พบแมตช์ตามตัวกรองที่เลือก
          </div>
        )}

        {!loading && !error && matches.length > 0 && (
          <div className="mt-7 space-y-6">
            {uniqueDates.map((date) => {
              const dateMatches = matches.filter((match) => match.date === date);
              if (dateMatches.length === 0) return null;

              return (
                <section key={date} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                  <div className="border-b border-slate-200 bg-slate-900 px-5 py-4 text-white">
                    <h2 className="font-bold">
                      {new Date(`${date}T00:00:00`).toLocaleDateString('th-TH', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </h2>
                    <p className="mt-1 text-xs text-slate-300">{dateMatches.length} คู่</p>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {dateMatches.map((match) => (
                      <article key={match.id} className="grid gap-4 p-5 sm:grid-cols-[145px_1fr_54px_1fr] sm:items-center">
                        <div className="text-sm text-slate-600">
                          <div className="text-lg font-bold text-slate-900">{match.time || '—'}</div>
                          <div className="mt-1">{match.venue_code}{match.court ? ` · Court ${match.court}` : ''}</div>
                          <div className="mt-1 text-xs">{match.category_code} · {match.round}</div>
                        </div>

                        <div className="sm:text-right">
                          <p className="font-bold text-slate-900">{match.home_team || match.home_slot}</p>
                          {match.home_team && <p className="mt-1 text-xs text-slate-500">{match.home_slot}</p>}
                        </div>

                        <div className="text-center text-sm font-bold text-slate-400">VS</div>

                        <div>
                          <p className="font-bold text-slate-900">{match.away_team || match.away_slot}</p>
                          {match.away_team && <p className="mt-1 text-xs text-slate-500">{match.away_slot}</p>}
                          <p className="mt-1 text-xs text-slate-400">
                            {typeof match.match_number === 'number' ? `Match ${match.match_number}` : match.match_number}
                          </p>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <div className="no-print mt-7 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-slate-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Print / PDF
          </button>
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={matches.length === 0}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Export CSV
          </button>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
        }
      `}</style>
    </div>
  );
}
