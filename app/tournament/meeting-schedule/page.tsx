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
  court: number;
  round: string;
  match_number: string | number;
}

interface ScheduleResponse {
  tournament_slug: string;
  status: string;
  is_official: boolean;
  source: string;
  competition_dates: { start: string; end: string };
  total_matches: number;
  data: ScheduleMatch[];
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
      try {
        const params = new URLSearchParams({
          tournament_slug: fallbackData.tournament.slug,
          ...(filterCategory && { category_code: filterCategory }),
          ...(filterVenue && { venue_code: filterVenue }),
          ...(filterDate && { date: filterDate }),
        });

        const res = await fetch(`/api/tournament/public/schedule?${params.toString()}`);

        if (!res.ok) {
          throw new Error(`Failed to load schedule: ${res.status}`);
        }

        const data: ScheduleResponse = await res.json();
        setMatches(data.data || []);
        setScheduleMetadata(data);
        setError('');
      } catch (err) {
        console.error('Failed to load schedule:', err);
        setError(err instanceof Error ? err.message : 'Failed to load schedule');
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
      [scheduleMetadata?.status || 'unknown', scheduleMetadata?.is_official ? 'YES' : 'NO', scheduleMetadata?.source || 'unknown', ''],
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

    const csvContent = rows
      .map((row) => row.map(escapeCsvCell).join(','))
      .join('\r\n');

    const blob = new Blob(['﻿', csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `schedule-${new Date().toISOString().slice(0, 10)}.csv`);
    link.click();
  };

  const getTeamDisplay = (teamName: string | undefined, slotCode: string): string => {
    return teamName || slotCode;
  };

  const uniqueDates = Array.from(new Set(matches.map((m) => m.date))).sort();

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold text-gray-900">Match Schedule</h1>
          {scheduleMetadata && !scheduleMetadata.is_official && (
            <span className="inline-block bg-yellow-400 text-yellow-900 px-3 py-1 rounded font-bold text-sm border-2 border-yellow-600">
              ร่างโปรแกรม
            </span>
          )}
        </div>

        {scheduleMetadata && !scheduleMetadata.is_official && (
          <div className="mt-4 rounded-lg bg-yellow-50 border-4 border-yellow-500 p-6 print:block print:break-inside-avoid">
            <div className="flex gap-4 items-start">
              <div className="text-4xl">⚠️</div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-yellow-900">
                  ร่างโปรแกรมแข่งขัน — ข้อมูลตัวอย่างสำหรับทดสอบระบบ
                </h2>
                <p className="text-yellow-800 font-semibold mt-2">
                  Draft / Placeholder Schedule — Sample data for system testing only
                </p>
                <p className="mt-3 text-yellow-900 text-sm">
                  ยังไม่ใช่โปรแกรมการแข่งขันอย่างเป็นทางการ • Not the official competition schedule
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-lg bg-blue-50 border-2 border-blue-300 p-6">
          <h2 className="text-xl font-bold text-blue-900">📅 Competition Schedule</h2>
          <p className="mt-2 text-blue-800">
            <strong>Draw Meeting:</strong> 16 July 2026, 11:00 (Freeze: 09:30)
          </p>
          <p className="mt-2 text-blue-800">
            <strong>Competition Dates:</strong> 1–11 August 2026
          </p>
          <p className="mt-3 text-blue-700 text-sm">
            {scheduleMetadata && !scheduleMetadata.is_official ? (
              <>
                <strong>กำลังแสดงข้อมูลตัวอย่างจากระบบสำรอง</strong> — Teams are resolved from current draw assignments.
              </>
            ) : (
              <>
                <strong>Official Schedule:</strong> Teams are resolved from current draw assignments.
              </>
            )}
          </p>
        </div>

        <div className="mt-8">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Filters</h3>
          <div className="flex gap-4 flex-wrap no-print">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="rounded border border-gray-300 px-4 py-2"
            >
              <option value="">All Categories</option>
              {fallbackData.categories.map((c) => (
                <option key={c.slug} value={c.code}>
                  {c.code} - {c.name}
                </option>
              ))}
            </select>

            <select
              value={filterVenue}
              onChange={(e) => setFilterVenue(e.target.value)}
              className="rounded border border-gray-300 px-4 py-2"
            >
              <option value="">All Venues</option>
              {fallbackData.venues.map((v) => (
                <option key={v.id} value={v.code}>
                  {v.name}
                </option>
              ))}
            </select>

            <select
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="rounded border border-gray-300 px-4 py-2"
            >
              <option value="">All Dates</option>
              {uniqueDates.map((d) => (
                <option key={d} value={d}>
                  {new Date(d).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="mt-8 rounded-lg bg-red-50 border border-red-300 p-4 text-red-700">
            <p className="font-semibold">Error loading schedule:</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {loading && (
          <div className="mt-8 text-center text-gray-600">
            <p>Loading schedule...</p>
          </div>
        )}

        {!loading && !error && matches.length === 0 && (
          <div className="mt-8 rounded-lg bg-gray-100 border border-gray-300 p-6 text-center">
            <p className="text-gray-700 font-semibold">No matches found</p>
            <p className="mt-2 text-gray-600 text-sm">Try adjusting your filters or check back later.</p>
          </div>
        )}

        {!loading && !error && matches.length > 0 && (
          <div className="mt-8 space-y-6">
            {uniqueDates.map((date) => {
              const dateMatches = matches.filter((m) => m.date === date);
              if (dateMatches.length === 0) return null;

              return (
                <div key={date} className="rounded-lg bg-white p-6 shadow">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">
                    {new Date(date).toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </h3>

                  <div className="space-y-3">
                    {dateMatches.map((match) => (
                      <div
                        key={match.id}
                        className="border border-gray-200 rounded p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                          <div className="flex-1">
                            <div className="text-sm text-gray-500 mb-2">
                              {match.time} | {match.venue_code} Court {match.court} | {match.category_code}
                            </div>
                            <div className="text-lg font-semibold text-gray-900">
                              {getTeamDisplay(match.home_team, match.home_slot)}
                            </div>
                          </div>

                          <div className="text-center text-gray-400 font-semibold">vs</div>

                          <div className="flex-1 text-right">
                            <div className="text-lg font-semibold text-gray-900">
                              {getTeamDisplay(match.away_team, match.away_slot)}
                            </div>
                            <div className="text-sm text-gray-500 mt-2">
                              {match.round}
                              {typeof match.match_number === 'string'
                                ? ` ${match.match_number}`
                                : ` M${match.match_number}`}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-8 flex gap-4 flex-wrap no-print">
          <button
            onClick={() => window.print()}
            className="rounded bg-gray-600 px-6 py-3 font-semibold text-white hover:bg-gray-700 transition-colors"
          >
            Print / PDF
          </button>
          <button
            onClick={handleExportCSV}
            disabled={matches.length === 0}
            className="rounded bg-green-600 px-6 py-3 font-semibold text-white hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            Export CSV
          </button>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print {
            display: none;
          }
          body {
            background: white;
          }
          .bg-gray-50,
          .bg-gray-100 {
            background: white;
            border: 1px solid #e5e7eb;
          }
          .bg-yellow-50 {
            background: #fef3c7 !important;
            border-color: #d97706 !important;
          }
          .text-yellow-900 {
            color: #78350f !important;
          }
          .text-yellow-800 {
            color: #92400e !important;
          }
          .border-yellow-500 {
            border-color: #eab308 !important;
          }
        }
      `}</style>
    </div>
  );
}
