'use client';

import { useState } from 'react';
import fallbackData from '@/data/tournament-meeting-fallback.json';

export default function ScheduleDisplayPage() {
  const [filterVenue, setFilterVenue] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDate, setFilterDate] = useState('');

  const escapeCsvCell = (value: unknown): string => {
    const text = String(value ?? '');
    const escaped = text.replace(/"/g, '""');
    return /[",\r\n]/.test(text) ? `"${escaped}"` : escaped;
  };

  const handleExportCSV = () => {
    const rows: (string | number)[][] = [
      ['Status', 'Note'],
      [
        'PLACEHOLDER',
        'Schedule data not yet imported. Competition dates: 1-11 August 2026. Import from real schedule source.',
      ],
    ];

    const csvContent = rows
      .map((row) => row.map(escapeCsvCell).join(','))
      .join('\r\n');

    const blob = new Blob(['﻿', csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `schedule-placeholder-${new Date().toISOString().slice(0, 10)}.csv`);
    link.click();
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold text-gray-900">Match Schedule</h1>

        <div className="mt-4 rounded-lg bg-orange-50 border-2 border-orange-300 p-6">
          <h2 className="text-xl font-bold text-orange-900">📋 Schedule Status: DRAFT/PLACEHOLDER</h2>
          <p className="mt-2 text-orange-800">
            <strong>Draw Meeting:</strong> 16 July 2026, 11:00 (Freeze: 09:30)
          </p>
          <p className="mt-2 text-orange-800">
            <strong>Competition Dates:</strong> 1–11 August 2026
          </p>
          <p className="mt-3 text-orange-700">
            Real match schedule has not been imported yet. Once imported from the official venue schedule, dates, times, courts, and groups will be displayed here.
          </p>
        </div>

        <div className="mt-8 rounded-lg bg-gray-100 border border-gray-300 p-6 text-center">
          <p className="text-gray-700 font-semibold">No matches to display</p>
          <p className="mt-2 text-gray-600 text-sm">
            Check back after the official schedule is imported (expected after 16 July 2026 draw meeting).
          </p>
        </div>

        <div className="mt-8">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Filters (for imported schedule)</h3>
          <div className="flex gap-4 flex-wrap">
            <select
              value={filterVenue}
              onChange={(e) => setFilterVenue(e.target.value)}
              disabled
              className="rounded border border-gray-300 px-4 py-2 bg-gray-200 text-gray-500 cursor-not-allowed"
            >
              <option value="">All Venues</option>
              {fallbackData.venues.map((v) => (
                <option key={v.id} value={v.code}>
                  {v.name}
                </option>
              ))}
            </select>

            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              disabled
              className="rounded border border-gray-300 px-4 py-2 bg-gray-200 text-gray-500 cursor-not-allowed"
            >
              <option value="">All Categories</option>
              {fallbackData.categories.map((c) => (
                <option key={c.slug} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              disabled
              className="rounded border border-gray-300 px-4 py-2 bg-gray-200 text-gray-500 cursor-not-allowed"
            />
          </div>
        </div>

        <div className="mt-8 flex gap-4 flex-wrap no-print">
          <button
            onClick={() => window.print()}
            disabled
            className="rounded bg-gray-400 px-6 py-3 font-semibold text-white cursor-not-allowed"
            title="Enable after schedule import"
          >
            Print / PDF (disabled)
          </button>
          <button
            onClick={handleExportCSV}
            className="rounded bg-orange-600 px-6 py-3 font-semibold text-white hover:bg-orange-700 transition-colors"
          >
            Export Placeholder Note
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
        }
      `}</style>
    </div>
  );
}
