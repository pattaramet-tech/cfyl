'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface Season {
  id: string;
  name: string;
}

interface AgeGroup {
  id: string;
  code: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
  short_name: string;
}

interface StaffDisciplineRecord {
  id: string;
  created_at: string;
  minute: number | null;
  reason: string | null;
  note: string | null;
  suspended_matches: number | null;
  suspended_from_matchday: number | null;
  status: 'active' | 'served' | 'cancelled';
  discipline_type: 'warning' | 'caution' | 'ejection' | 'ban';
  staff: {
    full_name: string;
    position: string;
  } | null;
  team: {
    name: string;
  } | null;
  match: {
    matchday: number;
  } | null;
}

const disciplineIcons: Record<string, string> = {
  warning: '⚠️',
  caution: '🟧',
  ejection: '🟥',
  ban: '🚫',
};

const disciplineLabels: Record<string, string> = {
  warning: 'คาดโทษ',
  caution: 'เตือน',
  ejection: 'ไล่ออก',
  ban: 'แบน',
};

const statusLabels: Record<string, string> = {
  active: 'มีผล',
  served: 'ชดเชยแล้ว',
  cancelled: 'ยกเลิก',
};

export default function StaffDisciplinePage() {
  const router = useRouter();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [records, setRecords] = useState<StaffDisciplineRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedAgeGroup, setSelectedAgeGroup] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedDisciplineType, setSelectedDisciplineType] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        const token = localStorage.getItem('admin_token');
        if (!token) {
          router.push('/admin/login');
          return;
        }

        const headers = { Authorization: `Bearer ${token}` };

        // Fetch seasons
        const seasonsRes = await fetch('/api/admin/seasons', { headers });
        if (seasonsRes.ok) {
          const { data } = await seasonsRes.json();
          setSeasons(data || []);
          if (data?.length > 0) {
            setSelectedSeason(data[0].id);
          }
        }

        setLoading(false);
      } catch (error) {
        console.error('Error loading data:', error);
        setLoading(false);
      }
    };

    loadData();
  }, [router]);

  // Load age groups when season changes
  useEffect(() => {
    if (!selectedSeason) return;

    const loadAgeGroups = async () => {
      try {
        const token = localStorage.getItem('admin_token');
        const headers = { Authorization: `Bearer ${token}` };

        const res = await fetch(
          `/api/admin/age-groups?seasonId=${selectedSeason}`,
          { headers }
        );
        if (res.ok) {
          const { data } = await res.json();
          setAgeGroups(data || []);
          setSelectedAgeGroup('');
          setSelectedTeam('');
        }
      } catch (error) {
        console.error('Error loading age groups:', error);
      }
    };

    loadAgeGroups();
  }, [selectedSeason]);

  // Load teams when season/age group change
  useEffect(() => {
    if (!selectedSeason || !selectedAgeGroup) return;

    const loadTeams = async () => {
      try {
        const token = localStorage.getItem('admin_token');
        const headers = { Authorization: `Bearer ${token}` };

        const res = await fetch(
          `/api/admin/teams?seasonId=${selectedSeason}&ageGroupId=${selectedAgeGroup}`,
          { headers }
        );
        if (res.ok) {
          const { data } = await res.json();
          setTeams(data || []);
          setSelectedTeam('');
        }
      } catch (error) {
        console.error('Error loading teams:', error);
      }
    };

    loadTeams();
  }, [selectedSeason, selectedAgeGroup]);

  // Load discipline records
  useEffect(() => {
    const loadRecords = async () => {
      try {
        const token = localStorage.getItem('admin_token');
        const headers = { Authorization: `Bearer ${token}` };

        const params = new URLSearchParams();
        if (selectedSeason) params.append('seasonId', selectedSeason);
        if (selectedAgeGroup) params.append('ageGroupId', selectedAgeGroup);
        if (selectedTeam) params.append('teamId', selectedTeam);
        if (selectedStatus) params.append('status', selectedStatus);

        const res = await fetch(
          `/api/admin/staff-discipline?${params.toString()}`,
          { headers }
        );
        if (res.ok) {
          const { data } = await res.json();
          setRecords(data || []);
        }
      } catch (error) {
        console.error('Error loading records:', error);
      }
    };

    loadRecords();
  }, [selectedSeason, selectedAgeGroup, selectedTeam, selectedStatus]);

  const handleDelete = useCallback(
    async (recordId: string) => {
      if (!confirm('ยืนยันการลบเหตุการณ์วินัยนี้?')) return;

      try {
        const token = localStorage.getItem('admin_token');
        const headers = { Authorization: `Bearer ${token}` };

        const res = await fetch(`/api/admin/staff-discipline/${recordId}`, {
          method: 'DELETE',
          headers,
        });

        if (res.ok) {
          setRecords((prev) => prev.filter((r) => r.id !== recordId));
        }
      } catch (error) {
        console.error('Error deleting record:', error);
      }
    },
    []
  );

  const filteredRecords = useMemo(() => {
    let filtered = records;

    if (selectedDisciplineType) {
      filtered = filtered.filter(
        (r) => r.discipline_type === selectedDisciplineType
      );
    }

    return filtered.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateB - dateA;
    });
  }, [records, selectedDisciplineType]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
          <p className="text-gray-600">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">รายการวินัยเจ้าหน้าที่</h1>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Season */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ฤดูกาล
            </label>
            <select
              value={selectedSeason}
              onChange={(e) => {
                setSelectedSeason(e.target.value);
                setSelectedAgeGroup('');
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">เลือกฤดูกาล</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Age Group */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ระดับอายุ
            </label>
            <select
              value={selectedAgeGroup}
              onChange={(e) => {
                setSelectedAgeGroup(e.target.value);
                setSelectedTeam('');
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              disabled={!selectedSeason}
            >
              <option value="">เลือกระดับอายุ</option>
              {ageGroups.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name}
                </option>
              ))}
            </select>
          </div>

          {/* Team */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ทีม
            </label>
            <select
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              disabled={!selectedAgeGroup}
            >
              <option value="">ทั้งหมด</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Discipline Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ประเภทวินัย
            </label>
            <select
              value={selectedDisciplineType}
              onChange={(e) => setSelectedDisciplineType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">ทั้งหมด</option>
              <option value="warning">⚠️ {disciplineLabels.warning}</option>
              <option value="caution">🟧 {disciplineLabels.caution}</option>
              <option value="ejection">🟥 {disciplineLabels.ejection}</option>
              <option value="ban">🚫 {disciplineLabels.ban}</option>
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              สถานะ
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">ทั้งหมด</option>
              <option value="active">มีผล</option>
              <option value="served">ชดเชยแล้ว</option>
              <option value="cancelled">ยกเลิก</option>
            </select>
          </div>
        </div>
      </div>

      {/* Records Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {filteredRecords.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            ไม่มีข้อมูลวินัยเจ้าหน้าที่
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">นัดที่</th>
                  <th className="px-4 py-3 text-left font-medium">ทีม</th>
                  <th className="px-4 py-3 text-left font-medium">ชื่อ</th>
                  <th className="px-4 py-3 text-left font-medium">ตำแหน่ง</th>
                  <th className="px-4 py-3 text-left font-medium">ประเภท</th>
                  <th className="px-4 py-3 text-left font-medium">นาที</th>
                  <th className="px-4 py-3 text-left font-medium">เหตุผล</th>
                  <th className="px-4 py-3 text-left font-medium">ชดเชย</th>
                  <th className="px-4 py-3 text-left font-medium">สถานะ</th>
                  <th className="px-4 py-3 text-left font-medium">วันที่</th>
                  <th className="px-4 py-3 text-center font-medium">ลบ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {record.match?.matchday || '-'}
                    </td>
                    <td className="px-4 py-3">{record.team?.name || '-'}</td>
                    <td className="px-4 py-3">{record.staff?.full_name || '-'}</td>
                    <td className="px-4 py-3">{record.staff?.position || '-'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1">
                        {disciplineIcons[record.discipline_type]}
                        {disciplineLabels[record.discipline_type]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {record.minute !== null ? `${record.minute}'` : '-'}
                    </td>
                    <td className="px-4 py-3 text-xs max-w-xs truncate">
                      {record.reason || '-'}
                    </td>
                    <td className="px-4 py-3">
                      {record.suspended_matches ? `${record.suspended_matches} นัด` : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                          record.status === 'active'
                            ? 'bg-blue-100 text-blue-800'
                            : record.status === 'served'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {statusLabels[record.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(record.created_at).toLocaleDateString('th-TH', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleDelete(record.id)}
                        className="text-red-600 hover:text-red-900 font-medium text-sm"
                      >
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-600">
          ทั้งหมด {filteredRecords.length} รายการ
        </div>
      </div>
    </div>
  );
}
