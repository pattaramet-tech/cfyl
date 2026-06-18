'use client';

import { useEffect, useState } from 'react';
import type { SuspensionDetails, SuspendedMatchDetail } from '@/lib/suspension-calc';

interface SuspensionRecord {
  id: string;
  player_id: string;
  team_id: string;
  total_points: number;
  ban_matches: number;
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
}

function getStatus(record: SuspensionRecord): { label: string; color: string; emoji: string } {
  const { total_points, ban_matches, suspension_details } = record;
  if (total_points === 0) return { label: 'ปกติ', color: 'bg-green-100 text-green-800', emoji: '🟢' };
  if (ban_matches === 0) return { label: 'สะสมคะแนน / เฝ้าระวัง', color: 'bg-yellow-100 text-yellow-800', emoji: '🟡' };
  const hasNextMatch = (suspension_details?.suspended_matches?.length ?? 0) > 0;
  if (!hasNextMatch) return { label: 'ไม่พบโปรแกรมแข่งขันนัดถัดไป', color: 'bg-gray-100 text-gray-700', emoji: '⚪' };
  return { label: 'ติดโทษแบน', color: 'bg-red-100 text-red-800', emoji: '🔴' };
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
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h4 className="font-semibold text-red-800 mb-3">
          🚫 นัดที่ถูกระงับการแข่งขัน ({d.suspended_matches.length > 0 ? d.suspended_matches.length : 'ยังไม่พบโปรแกรม'})
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

  const bannedCount = suspensions.filter((s) => s.ban_matches > 0 && (s.suspension_details?.suspended_matches?.length ?? 0) > 0).length;
  const warningCount = suspensions.filter((s) => s.ban_matches === 0 && s.total_points > 0).length;
  const noScheduleCount = suspensions.filter((s) => s.ban_matches > 0 && (s.suspension_details?.suspended_matches?.length ?? 0) === 0).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800">🚨 Suspension Management</h1>
          <p className="text-gray-600 mt-1 text-sm">ระบบคำนวณอัตโนมัติ — Admin ดูข้อมูลได้เท่านั้น ไม่สามารถแก้ไขได้</p>
        </div>
        {selectedSeason && selectedAgeGroup && (
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
        )}
      </div>

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
      {suspensions.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 sm:p-4 text-center">
            <p className="text-2xl font-bold text-red-700">{bannedCount}</p>
            <p className="text-xs sm:text-sm text-red-600 mt-1">🔴 ติดโทษแบน</p>
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
            <p className="text-2xl font-bold text-green-700">{suspensions.length - bannedCount - warningCount - noScheduleCount}</p>
            <p className="text-xs sm:text-sm text-green-600 mt-1">🟢 ปกติ</p>
          </div>
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
      ) : suspensions.length === 0 ? (
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
                {suspensions.map((record, index) => {
                  const status = getStatus(record);
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
    </div>
  );
}
