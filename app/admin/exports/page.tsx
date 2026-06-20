'use client';

import { useEffect, useState, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Season {
  id: string;
  name: string;
  year: number;
}

interface StandingRow {
  rank: number;
  teamName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
}

interface Group {
  ageGroupName: string;
  divisionName: string;
  label: string;
  standings: StandingRow[];
}

interface ExportsData {
  season: { name: string };
  matchdayFilter: number | null;
  groups: Group[];
}

type Format = 'detailed' | 'compact' | 'tsv';

// ─── Text Formatting ──────────────────────────────────────────────────────────

function formatGD(gd: number): string {
  if (gd > 0) return `+${gd}`;
  return String(gd);
}

function formatDetailed(group: Group, seasonName: string, matchdayFilter: number | null): string {
  const lines: string[] = [];
  lines.push('STANDINGS');
  lines.push(`${seasonName} | ${group.ageGroupName}`);
  lines.push(group.divisionName.toUpperCase().startsWith('DIVISION')
    ? group.divisionName.toUpperCase()
    : `DIVISION ${group.divisionName.toUpperCase()}`);
  if (matchdayFilter !== null) {
    lines.push(`MATCHDAY ${matchdayFilter}`);
  }
  lines.push('');

  for (const s of group.standings) {
    lines.push(`${s.rank}. ${s.teamName}`);
    lines.push(
      `   P ${s.played} | W ${s.wins} | D ${s.draws} | L ${s.losses} | GD ${formatGD(s.goalDiff)} | PTS ${s.points}`
    );
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function formatCompact(group: Group, matchdayFilter: number | null): string {
  const lines: string[] = [];
  const header = matchdayFilter !== null
    ? `${group.label} | MATCHDAY ${matchdayFilter}`
    : group.label;
  lines.push(header);
  lines.push('');

  for (const s of group.standings) {
    lines.push(
      `${s.rank}. ${s.teamName} — P${s.played} W${s.wins} D${s.draws} L${s.losses} GD${formatGD(s.goalDiff)} PTS${s.points}`
    );
  }

  return lines.join('\n');
}

// Table / TSV — tab-separated, data rows only (no header, no rank, no labels).
// Columns: Team Name, P, W, D, L, +/- (GD, plain signed), PTS
function formatTSV(group: Group): string {
  return group.standings
    .map((s) =>
      [s.teamName, s.played, s.wins, s.draws, s.losses, s.goalDiff, s.points].join('\t')
    )
    .join('\n');
}

function formatGroup(group: Group, format: Format, seasonName: string, matchdayFilter: number | null): string {
  if (format === 'tsv') return formatTSV(group);
  return format === 'detailed'
    ? formatDetailed(group, seasonName, matchdayFilter)
    : formatCompact(group, matchdayFilter);
}

function formatAll(groups: Group[], format: Format, seasonName: string, matchdayFilter: number | null): string {
  if (format === 'tsv') {
    // Each table separated by a blank line, prefixed with its label heading
    return groups
      .map((g) => `${g.label}\n${formatTSV(g)}`)
      .join('\n\n');
  }
  const divider = '\n──────────────────────────\n';
  return groups
    .map((g) => formatGroup(g, format, seasonName, matchdayFilter))
    .join(divider);
}

// ─── Copy Button ──────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setState('copied');
      } else {
        // Fallback: select textarea
        setState('error');
      }
    } catch {
      setState('error');
    }
    setTimeout(() => setState('idle'), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      disabled={!text}
      className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2 disabled:opacity-40 ${
        state === 'copied'
          ? 'bg-green-600 text-white'
          : state === 'error'
          ? 'bg-red-500 text-white'
          : 'bg-blue-600 hover:bg-blue-700 text-white'
      }`}
    >
      {state === 'copied' ? '✓ Copied!' : state === 'error' ? '⚠ Select manually' : `📋 ${label}`}
    </button>
  );
}

// ─── Preview Card ─────────────────────────────────────────────────────────────

function PreviewCard({
  group,
  text,
}: {
  group: Group;
  text: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-bold text-gray-800">{group.label}</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{group.standings.length} ทีม</span>
          <CopyButton text={text} label="Copy" />
        </div>
      </div>
      <textarea
        readOnly
        value={text}
        rows={Math.min(Math.max(text.split('\n').length, 3), 24)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono bg-gray-50 text-gray-700 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300 whitespace-pre overflow-x-auto"
      />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ExportsPage() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeason, setSelectedSeason] = useState('');
  const [matchdayInput, setMatchdayInput] = useState('');
  const [format, setFormat] = useState<Format>('detailed');

  const [data, setData] = useState<ExportsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load seasons on mount
  useEffect(() => {
    fetch('/api/public/seasons')
      .then((r) => r.ok ? r.json() : [])
      .then((list: Season[]) => {
        setSeasons(list);
        if (list.length > 0) setSelectedSeason(list[0].id);
      });
  }, []);

  // Fetch standings from admin API
  const fetchStandings = useCallback(async () => {
    if (!selectedSeason) return;
    setIsLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('admin_token');
      const mdParam = matchdayInput.trim() !== '' ? `&matchday=${matchdayInput.trim()}` : '';
      const res = await fetch(
        `/api/admin/exports/standings?seasonId=${selectedSeason}${mdParam}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!res.ok) {
        const body = await res.json();
        setError(body.error || 'โหลดข้อมูลไม่สำเร็จ');
        return;
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setIsLoading(false);
    }
  }, [selectedSeason, matchdayInput]);

  // Auto-fetch when season changes
  useEffect(() => {
    if (selectedSeason) fetchStandings();
  }, [selectedSeason]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived: formatted texts (client-side, no refetch on format change)
  const seasonName = data?.season.name ?? '';
  const matchdayFilter = data?.matchdayFilter ?? null;
  const groups = data?.groups ?? [];

  const groupTexts = groups.map((g) =>
    formatGroup(g, format, seasonName, matchdayFilter)
  );
  const allText = groups.length > 0
    ? formatAll(groups, format, seasonName, matchdayFilter)
    : '';

  const selectClass =
    'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-800">📋 Exports</h1>
        <p className="text-gray-600 mt-1">Copy ตารางคะแนนสำหรับ Canva</p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Season */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Season</label>
            <select
              value={selectedSeason}
              onChange={(e) => setSelectedSeason(e.target.value)}
              className={selectClass}
            >
              <option value="">เลือก Season...</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Matchday */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              MatchDay <span className="text-gray-400 font-normal">(ถ้าไม่ใส่ = ทั้งหมด)</span>
            </label>
            <input
              type="number"
              min={1}
              max={99}
              value={matchdayInput}
              onChange={(e) => setMatchdayInput(e.target.value)}
              placeholder="เช่น 3"
              className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Load button */}
          <button
            onClick={fetchStandings}
            disabled={!selectedSeason || isLoading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-sm font-semibold transition"
          >
            {isLoading ? '⏳ กำลังโหลด...' : '🔄 โหลดข้อมูล'}
          </button>

          {/* Format toggle */}
          <div className="ml-auto flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
            {([
              ['detailed', 'Detailed'],
              ['compact', 'Compact'],
              ['tsv', 'Table / TSV'],
            ] as const).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                  format === f
                    ? 'bg-white shadow text-blue-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          ❌ {error}
        </div>
      )}

      {/* Copy All */}
      {groups.length > 0 && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
          <div>
            <span className="font-semibold text-blue-800">Copy All Standings</span>
            <span className="text-blue-600 text-sm ml-2">
              ({groups.length} ตาราง
              {matchdayFilter !== null ? ` — MD ${matchdayFilter}` : ''})
            </span>
            {format === 'tsv' && (
              <p className="text-xs text-blue-500 mt-0.5">
                โหมด Table / TSV: แนะนำให้ Copy รายตารางทีละอัน แล้ววางใน Canva Table / Google Sheets
              </p>
            )}
          </div>
          <CopyButton text={allText} label="Copy All Standings" />
        </div>
      )}

      {/* Per-division preview cards */}
      {groups.length > 0 ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {groups.map((group, i) => (
            <PreviewCard key={group.label} group={group} text={groupTexts[i]} />
          ))}
        </div>
      ) : !isLoading && data && (
        <div className="text-center py-12 text-gray-400 text-sm border border-dashed border-gray-200 rounded-lg">
          ไม่พบข้อมูลตารางคะแนนสำหรับ Season นี้
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 py-8 text-gray-500 text-sm justify-center">
          <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
          กำลังคำนวณตารางคะแนน...
        </div>
      )}
    </div>
  );
}
