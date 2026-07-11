'use client';

import { useEffect, useState } from 'react';
import type { SuspensionDetails, SuspendedMatchDetail } from '@/lib/suspension-calc';
import { getSuspensionStatus, getBangkokToday, type SuspensionStatusKey } from '@/lib/suspension-status';

interface SuspensionRecord {
  id: string;
  player_id: string;
  team_id: string;
  total_points: number;
  ban_matches: number;
  suspension_type: string | null;
  serving_match_ids: string[] | null;
  served_completed_at: string | null;
  suspended_from_match_id: string | null;
  suspension_reason: string | null;
  suspension_details: SuspensionDetails | null;
  point_sources: Array<{
    match_id: string;
    matchday: number;
    points: number;
    reason: string;
    points_before: number;
    points_after: number;
  }>;
  updated_at: string;
  player: { id: string; full_name: string; shirt_no: number | null; player_code: string };
  team: { id: string; name: string; short_name: string };
  /** True when this legacy record is superseded by an event-based record for the same player+team */
  _superseded?: boolean;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function SuspendedMatchRow({ match, index }: { match: SuspendedMatchDetail; index: number }) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1 text-sm py-2 border-b border-red-100 last:border-0">
      <span className="font-semibold text-red-700 min-w-[60px]">นัด {index + 1}</span>
      <span className="font-bold text-gray-800">MD{match.matchday}</span>
      <span className="text-gray-600">{formatDate(match.match_date)}</span>
      {match.match_time && <span className="text-gray-600">{match.match_time.substring(0, 5)} น.</span>}
      <span className="text-gray-700">
        {match.is_home ? 'เหย้า' : 'เยือน'} vs{' '}
        <span className="font-semibold">{match.opponent_name}</span>
      </span>
      <span className="text-xs text-gray-400">[{match.match_code}]</span>
      <span className={`text-xs px-2 py-0.5 rounded-full ${
        match.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
        match.status === 'finished' ? 'bg-gray-100 text-gray-600' : 'bg-yellow-100 text-yellow-700'
      }`}>
        {match.status === 'scheduled' ? 'กำหนดการ' : match.status === 'finished' ? 'จบแล้ว' : match.status}
      </span>
    </div>
  );
}

function SuspensionDetailPanel({ record }: { record: SuspensionRecord }) {
  const d = record.suspension_details;
  if (!d) {
    return (
      <div className="p-4 bg-gray-50 rounded-lg text-sm text-gray-500">
        ไม่มีข้อมูลรายละเอียด (อาจยังไม่ได้รัน migration หรือยังไม่มีการโดนใบ)
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Trigger Info */}
      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
        <h4 className="font-semibold text-orange-800 mb-3">⚡ เหตุการณ์ที่ทำให้ถึงเกณฑ์แบน</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-gray-500 text-xs">นัดที่เกิดเหตุ</p>
            <p className="font-bold text-gray-800">MD{d.trigger_matchday}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">เหตุการณ์</p>
            <p className="font-semibold text-orange-700">{d.trigger_event}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">ครบเกณฑ์</p>
            <p className="font-bold text-red-700">{d.threshold_crossed} คะแนน → แบน {d.ban_matches_count} นัด</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">คะแนนก่อนนัดนั้น</p>
            <p className="font-semibold text-gray-700">{d.points_before} คะแนน</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">คะแนนที่เพิ่ม</p>
            <p className="font-semibold text-orange-700">+{d.points_added} คะแนน</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">คะแนนสะสมหลังนัดนั้น</p>
            <p className="font-bold text-red-700">{d.points_after} คะแนน</p>
          </div>
        </div>
      </div>

      {/* Suspended Matches */}
      {(() => {
        const servedSlots = d.suspended_matches.filter((m) => m.status === 'finished').length;
        const remainingSlots = d.suspended_matches.filter((m) => m.status === 'scheduled').length;
        const allServed = d.suspended_matches.length > 0 && servedSlots >= d.ban_matches_count;
        return (
          <div className={`border rounded-lg p-4 ${allServed ? 'bg-slate-50 border-slate-200' : 'bg-red-50 border-red-200'}`}>
            <h4 className={`font-semibold mb-2 ${allServed ? 'text-slate-600' : 'text-red-800'}`}>
              {allServed ? '✅ นัดใช้โทษ' : '🚫 นัดที่ถูกระงับการแข่งขัน'}{' '}
              <span className="text-xs font-normal">
                (ใช้โทษแล้ว {servedSlots}/{d.ban_matches_count} นัด{remainingSlots > 0 ? ` · เหลือ ${remainingSlots} นัด` : ''})
              </span>
            </h4>
            {d.suspended_matches.length > 0 ? (
              <div>
                {d.suspended_matches.map((m, i) => (
                  <SuspendedMatchRow key={m.match_id} match={m} index={i} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">ไม่พบโปรแกรมแข่งขันนัดถัดไปของทีม</p>
            )}
          </div>
        );
      })()}

      {/* Point Sources */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h4 className="font-semibold text-gray-700 mb-3">📊 ประวัติคะแนนสะสม</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-gray-500 border-b border-gray-200">
                <th className="pb-2 pr-4">MD</th>
                <th className="pb-2 pr-4">เหตุการณ์</th>
                <th className="pb-2 pr-4 text-center">คะแนนที่เพิ่ม</th>
                <th className="pb-2 pr-4 text-center">คะแนนก่อน</th>
                <th className="pb-2 text-center">คะแนนหลัง</th>
              </tr>
            </thead>
            <tbody>
              {record.point_sources.map((src, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-100">
                  <td className="py-1.5 pr-4 font-semibold text-gray-700">MD{src.matchday}</td>
                  <td className="py-1.5 pr-4 text-gray-600">{src.reason}</td>
                  <td className="py-1.5 pr-4 text-center font-bold text-orange-600">+{src.points}</td>
                  <td className="py-1.5 pr-4 text-center text-gray-500">{src.points_before}</td>
                  <td className="py-1.5 text-center font-semibold text-gray-800">{src.points_after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function AdminSuspensionsPage() {
  const [seasons, setSeasons] = useState<any[]>([]);
  const [ageGroups, setAgeGroups] = useState<any[]>([]);
  const [suspensions, setSuspensions] = useState<SuspensionRecord[]>([]);

  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedAgeGroup, setSelectedAgeGroup] = useState('');

  const [isLoadingSeasons, setIsLoadingSeasons] = useState(true);
  const [isLoadingAgeGroups, setIsLoadingAgeGroups] = useState(false);
  const [isLoadingSuspensions, setIsLoadingSuspensions] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<SuspensionStatusKey | 'all'>('all');

  // Discord alert modal
  const [discordOpen, setDiscordOpen] = useState(false);
  const [discordAge, setDiscordAge] = useState<string>('all');
  const [discordStatus, setDiscordStatus] = useState<'all' | 'pending' | 'active' | 'no_next_match'>('all');
  const [discordSending, setDiscordSending] = useState(false);
  const [discordResult, setDiscordResult] = useState<string | null>(null);

  // Load seasons
  useEffect(() => {
    fetch('/api/public/seasons')
      .then((r) => r.json())
      .then((data) => {
        setSeasons(data);
        if (data.length > 0) setSelectedSeason(data[0].id);
      })
      .catch(() => setError('Failed to load seasons'))
      .finally(() => setIsLoadingSeasons(false));
  }, []);

  // Load age groups
  useEffect(() => {
    if (!selectedSeason) return;
    setIsLoadingAgeGroups(true);
    setSelectedAgeGroup('');
    setSuspensions([]);

    fetch(`/api/public/age-groups?seasonId=${selectedSeason}`)
      .then((r) => r.json())
      .then((data) => {
        setAgeGroups(data);
        if (data.length > 0) setSelectedAgeGroup(data[0].id);
      })
      .catch(() => setError('Failed to load age groups'))
      .finally(() => setIsLoadingAgeGroups(false));
  }, [selectedSeason]);

  // Load suspensions
  useEffect(() => {
    if (!selectedSeason || !selectedAgeGroup) return;
    setIsLoadingSuspensions(true);
    setError(null);

    const token = localStorage.getItem('admin_token');
    fetch(
      `/api/admin/suspensions?seasonId=${selectedSeason}&ageGroupId=${selectedAgeGroup}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    )
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load suspensions');
        return r.json();
      })
      .then((data) => setSuspensions(data))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoadingSuspensions(false));
  }, [selectedSeason, selectedAgeGroup]);

  const recalculateAll = async () => {
    if (!selectedSeason || !selectedAgeGroup) return;
    setIsRecalculating(true);
    setRecalcMessage(null);
    setError(null);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/suspensions/recalculate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ seasonId: selectedSeason, ageGroupId: selectedAgeGroup }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Recalculate failed');
      setRecalcMessage(data.message);
      // Reload suspensions after recalculate
      const token2 = localStorage.getItem('admin_token');
      const res2 = await fetch(
        `/api/admin/suspensions?seasonId=${selectedSeason}&ageGroupId=${selectedAgeGroup}`,
        { headers: token2 ? { Authorization: `Bearer ${token2}` } : {} }
      );
      if (res2.ok) setSuspensions(await res2.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recalculate failed');
    } finally {
      setIsRecalculating(false);
    }
  };

  const sendDiscord = async () => {
    setDiscordSending(true);
    setDiscordResult(null);
    setError(null);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/notifications/discord/suspensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ seasonId: selectedSeason, ageGroupId: discordAge, statusFilter: discordStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ส่ง Discord ไม่สำเร็จ');
      setDiscordResult(
        data.empty
          ? 'ไม่มีนักกีฬาติดโทษแบนในรายการที่เลือก — ส่งข้อความแจ้งแล้ว'
          : `ส่ง Discord สำเร็จ · ผู้เล่น ${data.players} คน · ${data.messageParts} message`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ส่ง Discord ไม่สำเร็จ');
      setDiscordOpen(false);
    } finally {
      setDiscordSending(false);
    }
  };

  const today = getBangkokToday();
  const statusOf = (s: SuspensionRecord) => getSuspensionStatus(s, today).key;

  // Separate active event-based records from superseded legacy records.
  // Legacy records marked _superseded must not appear in the main active list —
  // their suspended_from_match_id may be stale (points accumulated beyond the
  // already-served threshold do NOT create a new ban).
  const activeSuspensions = suspensions.filter((s) => !s._superseded);
  const legacyHistoryRecords = suspensions.filter((s) => s._superseded);

  const SENDABLE = ['pending', 'active', 'no_next_match'];
  const discordPreviewCount = activeSuspensions.filter((s) => {
    const k = statusOf(s);
    if (!SENDABLE.includes(k)) return false;
    return discordStatus === 'all' ? true : k === discordStatus;
  }).length;

  const counts = activeSuspensions.reduce(
    (acc, s) => {
      acc[statusOf(s)] = (acc[statusOf(s)] || 0) + 1;
      return acc;
    },
    {} as Record<SuspensionStatusKey, number>
  );
  const activeCount = (counts.pending || 0) + (counts.active || 0);
  const servedCount = counts.served || 0;
  const warningCount = counts.warning || 0;
  const noScheduleCount = counts.no_next_match || 0;

  const filteredSuspensions =
    statusFilter === 'all'
      ? activeSuspensions
      : statusFilter === 'active'
      ? activeSuspensions.filter((s) => statusOf(s) === 'pending' || statusOf(s) === 'active')
      : activeSuspensions.filter((s) => statusOf(s) === statusFilter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800">🚨 Suspension Management</h1>
          <p className="text-gray-600 mt-1 text-sm">ระบบคำนวณอัตโนมัติ — Admin ดูข้อมูลได้เท่านั้น ไม่สามารถแก้ไขได้</p>
        </div>
        {selectedSeason && selectedAgeGroup && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { setDiscordResult(null); setDiscordAge('all'); setDiscordStatus('all'); setDiscordOpen(true); }}
              disabled={isLoadingSuspensions}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg font-semibold text-sm transition"
            >
              📣 Send Discord Alert
            </button>
            <button
              onClick={recalculateAll}
              disabled={isRecalculating || isLoadingSuspensions}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-semibold text-sm transition"
            >
              {isRecalculating ? (
                <>
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                  กำลังคำนวณ...
                </>
              ) : (
                '🔄 คำนวณใหม่ทั้งหมด'
              )}
            </button>
          </div>
        )}
      </div>

      {/* Discord alert modal */}
      {discordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !discordSending && setDiscordOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800">📣 ส่งแจ้งเตือนโทษแบนไป Discord</h3>
            <p className="text-xs text-slate-500">
              ส่งเฉพาะผู้เล่นสถานะ <b>ติดโทษแบน (pending / active)</b> และ <b>ไม่พบโปรแกรมนัดถัดไป</b> — ไม่ส่งผู้ที่สะสมคะแนน (warning) หรือพ้นโทษแล้ว (served)
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">รุ่นอายุ</label>
              <select value={discordAge} onChange={(e) => setDiscordAge(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                <option value="all">ทุกรุ่น</option>
                {ageGroups.map((ag) => (
                  <option key={ag.id} value={ag.id}>{ag.code} - {ag.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">สถานะ</label>
              <select value={discordStatus} onChange={(e) => setDiscordStatus(e.target.value as any)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                <option value="all">ทั้งหมด (pending + active + no_next_match)</option>
                <option value="pending">pending (ติดโทษแบน)</option>
                <option value="active">active (กำลังรับโทษ/วันนี้)</option>
                <option value="no_next_match">no_next_match (ไม่พบโปรแกรม)</option>
              </select>
            </div>

            <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
              {discordAge === selectedAgeGroup || discordAge === 'all' ? (
                <>จะส่งผู้เล่น ~<b>{discordPreviewCount}</b> คน{discordAge === 'all' ? ' (ประมาณการเฉพาะรุ่นที่เปิดอยู่ — รุ่นอื่นนับฝั่งเซิร์ฟเวอร์)' : ''}</>
              ) : (
                <>จำนวนจะถูกคำนวณฝั่งเซิร์ฟเวอร์ตามรุ่นที่เลือก</>
              )}
            </div>

            {discordResult && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {discordResult}</div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDiscordOpen(false)} disabled={discordSending} className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold disabled:opacity-50">
                {discordResult ? 'ปิด' : 'ยกเลิก'}
              </button>
              {!discordResult && (
                <button onClick={sendDiscord} disabled={discordSending} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-semibold">
                  {discordSending ? 'กำลังส่ง...' : 'ยืนยันส่ง'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {recalcMessage && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          ✅ {recalcMessage}
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {/* Selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Season</label>
          <select
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(e.target.value)}
            disabled={isLoadingSeasons}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600 disabled:bg-gray-100"
          >
            <option value="">Select season...</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Age Group</label>
          <select
            value={selectedAgeGroup}
            onChange={(e) => setSelectedAgeGroup(e.target.value)}
            disabled={isLoadingAgeGroups || !selectedSeason}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600 disabled:bg-gray-100"
          >
            <option value="">Select age group...</option>
            {ageGroups.map((ag) => (
              <option key={ag.id} value={ag.id}>{ag.code} - {ag.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      {activeSuspensions.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 sm:p-4 text-center">
            <p className="text-2xl font-bold text-red-700">{activeCount}</p>
            <p className="text-xs sm:text-sm text-red-600 mt-1">🔴 ติดโทษแบน</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 sm:p-4 text-center">
            <p className="text-2xl font-bold text-slate-600">{servedCount}</p>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">✅ พ้นโทษแล้ว</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 sm:p-4 text-center">
            <p className="text-2xl font-bold text-gray-600">{noScheduleCount}</p>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">⚪ ไม่พบโปรแกรม</p>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 sm:p-4 text-center">
            <p className="text-2xl font-bold text-yellow-700">{warningCount}</p>
            <p className="text-xs sm:text-sm text-yellow-600 mt-1">🟡 สะสมคะแนน</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 sm:p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{counts.normal || 0}</p>
            <p className="text-xs sm:text-sm text-green-600 mt-1">🟢 ปกติ</p>
          </div>
        </div>
      )}

      {/* Status filter */}
      {activeSuspensions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {([
            ['all', `ทั้งหมด (${activeSuspensions.length})`],
            ['active', `🔴 ติดโทษแบน (${activeCount})`],
            ['served', `✅ พ้นโทษแล้ว (${servedCount})`],
            ['warning', `🟡 สะสมคะแนน (${warningCount})`],
            ['no_next_match', `⚪ ไม่พบโปรแกรม (${noScheduleCount})`],
            ['normal', `🟢 ปกติ (${counts.normal || 0})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key as SuspensionStatusKey | 'all')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${
                statusFilter === key
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      {isLoadingSuspensions ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mr-3"></div>
          <span className="text-gray-600">กำลังโหลดข้อมูล...</span>
        </div>
      ) : !selectedSeason || !selectedAgeGroup ? (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center text-blue-700">
          เลือก Season และ Age Group เพื่อดูข้อมูล
        </div>
      ) : activeSuspensions.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500">
          ไม่พบข้อมูลใบเหลืองใบแดง
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {/* Info notice */}
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200">
            <p className="text-xs text-amber-700">
              ℹ️ กดที่แถวเพื่อดูรายละเอียด | ระบบคำนวณอัตโนมัติทุกครั้งที่มีการเพิ่ม/แก้ไข/ลบใบ
            </p>
          </div>

          {/* CFYL Point Rules reminder */}
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
            <p className="text-xs text-gray-500">
              กติกา CFYL: 🟡เหลือง=2 | 🟡🟡เหลือง2ใบ=4 | 🔴แดง=6 | 🟡🔴เหลือง+แดง=8 &nbsp;|&nbsp; เกณฑ์แบน: 6คะแนน=1นัด, 12+คะแนน=2นัด
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800 text-white text-xs">
                  <th className="px-3 py-3 text-left">#</th>
                  <th className="px-3 py-3 text-left">ชื่อนักกีฬา</th>
                  <th className="px-3 py-3 text-left">ทีม</th>
                  <th className="px-3 py-3 text-center">เบอร์</th>
                  <th className="px-3 py-3 text-center">คะแนน</th>
                  <th className="px-3 py-3 text-center">แบน</th>
                  <th className="px-3 py-3 text-left">นัดที่ถูกแบน</th>
                  <th className="px-3 py-3 text-center">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuspensions.map((record, index) => {
                  const status = getSuspensionStatus(record, today);
                  const isExpanded = expandedId === record.id;
                  const suspendedMatches = record.suspension_details?.suspended_matches || [];

                  return (
                    <>
                      <tr
                        key={record.id}
                        onClick={() => setExpandedId(isExpanded ? null : record.id)}
                        className={`border-b border-gray-100 cursor-pointer transition hover:bg-gray-50 ${
                          isExpanded ? 'bg-orange-50' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                        }`}
                      >
                        <td className="px-3 py-3 text-gray-500 text-xs">{index + 1}</td>
                        <td className="px-3 py-3 font-semibold text-gray-800">
                          {record.player?.full_name || '—'}
                          <span className="ml-2 text-xs text-gray-400">{record.player?.player_code}</span>
                        </td>
                        <td className="px-3 py-3 text-gray-600">{record.team?.name || '—'}</td>
                        <td className="px-3 py-3 text-center text-gray-500">{record.player?.shirt_no ?? '—'}</td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full font-bold text-xs text-white ${
                            record.total_points >= 12 ? 'bg-red-600' :
                            record.total_points >= 6 ? 'bg-orange-500' :
                            record.total_points > 0 ? 'bg-yellow-500' : 'bg-gray-300'
                          }`}>
                            {record.total_points} pts
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          {record.ban_matches > 0 ? (
                            <span className="inline-block bg-red-600 text-white rounded-full px-2 py-0.5 font-semibold text-xs">
                              {record.ban_matches} นัด
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-600">
                          {suspendedMatches.length > 0
                            ? suspendedMatches.map((m) => `MD${m.matchday}`).join(', ')
                            : record.ban_matches > 0
                            ? 'ไม่พบโปรแกรม'
                            : '—'}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${status.color}`}>
                            {status.emoji} {status.label}
                          </span>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr key={`${record.id}-detail`} className="bg-orange-50/50">
                          <td colSpan={8} className="px-4 py-4">
                            <SuspensionDetailPanel record={record} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Legacy history — superseded records */}
      {legacyHistoryRecords.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none">
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 border border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-gray-200 transition">
              <span className="font-semibold">📂 Legacy history ({legacyHistoryRecords.length} รายการ)</span>
              <span>— ข้อมูลเก่าก่อน event-based migration ถูกแทนที่โดย event record แล้ว ไม่ใช่สถานะแบนปัจจุบัน</span>
            </div>
          </summary>
          <div className="mt-2 overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-100 text-gray-500">
                  <th className="px-3 py-2 text-left">ชื่อนักกีฬา</th>
                  <th className="px-3 py-2 text-left">ทีม</th>
                  <th className="px-3 py-2 text-center">คะแนน (legacy)</th>
                  <th className="px-3 py-2 text-left">suspended_from</th>
                  <th className="px-3 py-2 text-left">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {legacyHistoryRecords.map((record) => (
                  <tr key={record.id} className="border-t border-gray-100 bg-white text-gray-400">
                    <td className="px-3 py-2">{record.player?.full_name ?? '—'}</td>
                    <td className="px-3 py-2">{record.team?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-center">{record.total_points} pts</td>
                    <td className="px-3 py-2 font-mono text-gray-300">
                      {record.suspended_from_match_id
                        ? record.suspended_from_match_id.slice(0, 8) + '…'
                        : '—'}
                    </td>
                    <td className="px-3 py-2 italic text-gray-400">
                      ถูกแทนที่โดย event record — ไม่ใช่สถานะแบนปัจจุบัน
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
