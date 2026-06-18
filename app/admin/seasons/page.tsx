'use client';

import { useEffect, useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Season {
  id: string;
  name: string;
  year: number;
  start_date: string | null;
  end_date: string | null;
  status: 'upcoming' | 'active' | 'completed';
  age_group_count: number;
}

interface AgeGroup {
  id: string;
  season_id: string;
  code: string;
  name: string;
  sort_order: number;
  division_count: number;
  team_count: number;
}

interface Division {
  id: string;
  season_id: string;
  age_group_id: string;
  name: string;
  sort_order: number;
  team_count: number;
  match_count: number;
}

type Tab = 'seasons' | 'age-groups' | 'divisions';

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  upcoming: { label: 'กำลังจะมาถึง', cls: 'bg-blue-100 text-blue-800' },
  active: { label: 'กำลังแข่งขัน', cls: 'bg-green-100 text-green-800' },
  completed: { label: 'เสร็จสิ้น', cls: 'bg-gray-100 text-gray-600' },
};

const EMPTY_SEASON = {
  name: '',
  year: new Date().getFullYear(),
  start_date: '',
  end_date: '',
  status: 'upcoming' as Season['status'],
};
const EMPTY_AG = { code: '', name: '', sort_order: 0 };
const EMPTY_DIV = { name: '', sort_order: 0 };

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('admin_token');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SeasonsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('seasons');

  // --- Seasons ---
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonForm, setSeasonForm] = useState<{
    mode: 'add' | 'edit';
    id?: string;
    data: typeof EMPTY_SEASON;
  } | null>(null);
  const [seasonMsg, setSeasonMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [confirmActive, setConfirmActive] = useState<{
    conflicting: string[];
  } | null>(null);

  // --- Age Groups ---
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const [agForm, setAgForm] = useState<{
    mode: 'add' | 'edit';
    id?: string;
    data: typeof EMPTY_AG;
  } | null>(null);
  const [agMsg, setAgMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [agLoading, setAgLoading] = useState(false);

  // --- Divisions ---
  const [divSeasonId, setDivSeasonId] = useState('');
  const [divAgeGroupId, setDivAgeGroupId] = useState('');
  const [divAgeGroups, setDivAgeGroups] = useState<AgeGroup[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divForm, setDivForm] = useState<{
    mode: 'add' | 'edit';
    id?: string;
    data: typeof EMPTY_DIV;
  } | null>(null);
  const [divMsg, setDivMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [divLoading, setDivLoading] = useState(false);

  // ---------------------------------------------------------------------------
  // Seasons
  // ---------------------------------------------------------------------------

  const loadSeasons = useCallback(async () => {
    const res = await fetch('/api/admin/seasons', { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    setSeasons(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { loadSeasons(); }, [loadSeasons]);

  const handleSeasonSave = async (overrideStatus?: Season['status']) => {
    if (!seasonForm) return;
    setSeasonLoading(true);
    setSeasonMsg(null);

    const status = overrideStatus ?? seasonForm.data.status;

    // Client-side warning: if setting active and others are active
    if (!overrideStatus && status === 'active') {
      const currentActive = seasons.filter(
        (s) => s.status === 'active' && s.id !== seasonForm.id
      );
      if (currentActive.length > 0) {
        setConfirmActive({ conflicting: currentActive.map((s) => s.name) });
        setSeasonLoading(false);
        return;
      }
    }

    const payload = {
      name: seasonForm.data.name,
      year: seasonForm.data.year,
      status,
      start_date: seasonForm.data.start_date || null,
      end_date: seasonForm.data.end_date || null,
    };

    try {
      const url =
        seasonForm.mode === 'edit'
          ? `/api/admin/seasons/${seasonForm.id}`
          : '/api/admin/seasons';
      const method = seasonForm.mode === 'edit' ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
      const data = await res.json();

      if (!res.ok) {
        setSeasonMsg({ type: 'error', text: data.error || 'เกิดข้อผิดพลาด' });
        return;
      }

      const deactivated: string[] = data.deactivated ?? [];
      if (deactivated.length > 0) {
        setSeasonMsg({
          type: 'success',
          text: `บันทึกสำเร็จ — Season ต่อไปนี้ถูกเปลี่ยนเป็น "เสร็จสิ้น": ${deactivated.join(', ')}`,
        });
      } else {
        setSeasonMsg({
          type: 'success',
          text: seasonForm.mode === 'add' ? 'สร้าง Season สำเร็จ' : 'บันทึก Season สำเร็จ',
        });
      }

      setSeasonForm(null);
      setConfirmActive(null);
      await loadSeasons();
    } finally {
      setSeasonLoading(false);
    }
  };

  const deleteSeason = async (id: string, name: string) => {
    if (!confirm(`ลบ Season "${name}" ?\n\nการลบจะลบ Age Groups และ Divisions ที่ว่างออกด้วย`)) return;
    const res = await fetch(`/api/admin/seasons/${id}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) {
      setSeasonMsg({ type: 'error', text: data.error || 'เกิดข้อผิดพลาด' });
      return;
    }
    setSeasonMsg({ type: 'success', text: `ลบ Season "${name}" สำเร็จ` });
    await loadSeasons();
  };

  // ---------------------------------------------------------------------------
  // Age Groups
  // ---------------------------------------------------------------------------

  const loadAgeGroups = useCallback(async (sid: string) => {
    if (!sid) { setAgeGroups([]); return; }
    const res = await fetch(`/api/admin/age-groups?seasonId=${sid}`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    setAgeGroups(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { loadAgeGroups(selectedSeasonId); }, [selectedSeasonId, loadAgeGroups]);

  const submitAgeGroup = async () => {
    if (!agForm || !selectedSeasonId) return;
    setAgLoading(true);
    setAgMsg(null);

    const payload = { ...agForm.data, season_id: selectedSeasonId };

    try {
      const url = agForm.mode === 'edit' ? `/api/admin/age-groups/${agForm.id}` : '/api/admin/age-groups';
      const method = agForm.mode === 'edit' ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
      const data = await res.json();

      if (!res.ok) {
        setAgMsg({ type: 'error', text: data.error || 'เกิดข้อผิดพลาด' });
        return;
      }

      setAgMsg({ type: 'success', text: agForm.mode === 'add' ? 'สร้าง Age Group สำเร็จ' : 'บันทึก Age Group สำเร็จ' });
      setAgForm(null);
      await loadAgeGroups(selectedSeasonId);
    } finally {
      setAgLoading(false);
    }
  };

  const deleteAgeGroup = async (id: string, code: string) => {
    if (!confirm(`ลบ Age Group "${code}" ?`)) return;
    const res = await fetch(`/api/admin/age-groups/${id}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) {
      setAgMsg({ type: 'error', text: data.error || 'เกิดข้อผิดพลาด' });
      return;
    }
    setAgMsg({ type: 'success', text: `ลบ Age Group "${code}" สำเร็จ` });
    await loadAgeGroups(selectedSeasonId);
  };

  // ---------------------------------------------------------------------------
  // Divisions
  // ---------------------------------------------------------------------------

  const loadDivAgeGroups = useCallback(async (sid: string) => {
    if (!sid) { setDivAgeGroups([]); setDivAgeGroupId(''); return; }
    const res = await fetch(`/api/admin/age-groups?seasonId=${sid}`, { headers: authHeaders() });
    if (!res.ok) return;
    const list: AgeGroup[] = await res.json();
    setDivAgeGroups(Array.isArray(list) ? list : []);
    if (list.length > 0) setDivAgeGroupId(list[0].id);
    else setDivAgeGroupId('');
  }, []);

  const loadDivisions = useCallback(async (sid: string, agid: string) => {
    if (!sid || !agid) { setDivisions([]); return; }
    const res = await fetch(`/api/admin/divisions?seasonId=${sid}&ageGroupId=${agid}`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    setDivisions(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { loadDivAgeGroups(divSeasonId); }, [divSeasonId, loadDivAgeGroups]);
  useEffect(() => { loadDivisions(divSeasonId, divAgeGroupId); }, [divSeasonId, divAgeGroupId, loadDivisions]);

  const submitDivision = async () => {
    if (!divForm || !divSeasonId || !divAgeGroupId) return;
    setDivLoading(true);
    setDivMsg(null);

    const payload = { ...divForm.data, season_id: divSeasonId, age_group_id: divAgeGroupId };

    try {
      const url = divForm.mode === 'edit' ? `/api/admin/divisions/${divForm.id}` : '/api/admin/divisions';
      const method = divForm.mode === 'edit' ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
      const data = await res.json();

      if (!res.ok) {
        setDivMsg({ type: 'error', text: data.error || 'เกิดข้อผิดพลาด' });
        return;
      }

      setDivMsg({ type: 'success', text: divForm.mode === 'add' ? 'สร้าง Division สำเร็จ' : 'บันทึก Division สำเร็จ' });
      setDivForm(null);
      await loadDivisions(divSeasonId, divAgeGroupId);
    } finally {
      setDivLoading(false);
    }
  };

  const deleteDivision = async (id: string, name: string) => {
    if (!confirm(`ลบ Division "${name}" ?`)) return;
    const res = await fetch(`/api/admin/divisions/${id}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) {
      setDivMsg({ type: 'error', text: data.error || 'เกิดข้อผิดพลาด' });
      return;
    }
    setDivMsg({ type: 'success', text: `ลบ Division "${name}" สำเร็จ` });
    await loadDivisions(divSeasonId, divAgeGroupId);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const tabs: { key: Tab; label: string }[] = [
    { key: 'seasons', label: '🏆 Seasons' },
    { key: 'age-groups', label: '👶 Age Groups' },
    { key: 'divisions', label: '🏅 Divisions' },
  ];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Season Management</h1>
        <p className="text-gray-500 text-sm mt-1">จัดการ Season, Age Group, และ Division</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition ${
              activeTab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ==================================================================
          TAB: SEASONS
          ================================================================== */}
      {activeTab === 'seasons' && (
        <div className={`grid gap-6 ${seasonForm ? 'md:grid-cols-3' : 'grid-cols-1'}`}>
          {/* Form */}
          {seasonForm && (
            <div className="bg-white rounded-xl shadow p-5">
              <h2 className="font-semibold text-gray-800 mb-4">
                {seasonForm.mode === 'add' ? 'เพิ่ม Season' : 'แก้ไข Season'}
              </h2>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ชื่อ Season *</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={seasonForm.data.name}
                    onChange={(e) =>
                      setSeasonForm({ ...seasonForm, data: { ...seasonForm.data, name: e.target.value } })
                    }
                    placeholder="เช่น CFYL 2026"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ปี (Year) *</label>
                  <input
                    type="number"
                    min={2000}
                    max={2099}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={seasonForm.data.year}
                    onChange={(e) =>
                      setSeasonForm({
                        ...seasonForm,
                        data: { ...seasonForm.data, year: parseInt(e.target.value) || new Date().getFullYear() },
                      })
                    }
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">วันเริ่ม</label>
                  <input
                    type="date"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={seasonForm.data.start_date}
                    onChange={(e) =>
                      setSeasonForm({ ...seasonForm, data: { ...seasonForm.data, start_date: e.target.value } })
                    }
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">วันสิ้นสุด</label>
                  <input
                    type="date"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={seasonForm.data.end_date}
                    onChange={(e) =>
                      setSeasonForm({ ...seasonForm, data: { ...seasonForm.data, end_date: e.target.value } })
                    }
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">สถานะ *</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={seasonForm.data.status}
                    onChange={(e) =>
                      setSeasonForm({
                        ...seasonForm,
                        data: { ...seasonForm.data, status: e.target.value as Season['status'] },
                      })
                    }
                  >
                    <option value="upcoming">กำลังจะมาถึง</option>
                    <option value="active">กำลังแข่งขัน (Active)</option>
                    <option value="completed">เสร็จสิ้น</option>
                  </select>
                  {seasonForm.data.status === 'active' && (
                    <p className="text-xs text-amber-600 mt-1">
                      ⚠️ Season อื่นที่ active อยู่จะถูกเปลี่ยนเป็น &quot;เสร็จสิ้น&quot; อัตโนมัติ
                    </p>
                  )}
                </div>
              </div>

              {seasonMsg && (
                <div
                  className={`mt-3 p-2 rounded text-xs ${
                    seasonMsg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                  }`}
                >
                  {seasonMsg.text}
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => handleSeasonSave()}
                  disabled={seasonLoading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg py-2 text-sm font-medium"
                >
                  {seasonLoading ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button
                  onClick={() => { setSeasonForm(null); setSeasonMsg(null); }}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          <div className={`bg-white rounded-xl shadow ${seasonForm ? 'md:col-span-2' : ''}`}>
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">Seasons ({seasons.length})</h2>
              <button
                onClick={() => { setSeasonForm({ mode: 'add', data: { ...EMPTY_SEASON } }); setSeasonMsg(null); }}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
              >
                + เพิ่ม Season
              </button>
            </div>

            {seasonMsg && !seasonForm && (
              <div
                className={`mx-4 mt-3 p-2 rounded text-xs ${
                  seasonMsg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                }`}
              >
                {seasonMsg.text}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-left px-4 py-3">ชื่อ Season</th>
                    <th className="text-left px-4 py-3">ปี</th>
                    <th className="text-left px-4 py-3">ช่วงเวลา</th>
                    <th className="text-left px-4 py-3">สถานะ</th>
                    <th className="text-center px-4 py-3">Age Groups</th>
                    <th className="text-right px-4 py-3">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {seasons.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-gray-400">ยังไม่มี Season</td>
                    </tr>
                  )}
                  {seasons.map((s) => {
                    const si = STATUS_LABELS[s.status] ?? { label: s.status, cls: 'bg-gray-100 text-gray-600' };
                    return (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                        <td className="px-4 py-3 text-gray-600">{s.year}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {s.start_date || '—'}
                          {s.start_date && s.end_date ? ' → ' : ''}
                          {s.end_date && s.start_date ? s.end_date : ''}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${si.cls}`}>
                            {si.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="bg-purple-100 text-purple-700 text-xs font-medium px-2 py-0.5 rounded-full">
                            {s.age_group_count}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => {
                                setSeasonForm({
                                  mode: 'edit',
                                  id: s.id,
                                  data: {
                                    name: s.name,
                                    year: s.year,
                                    start_date: s.start_date || '',
                                    end_date: s.end_date || '',
                                    status: s.status,
                                  },
                                });
                                setSeasonMsg(null);
                              }}
                              className="px-2 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 rounded"
                            >
                              ✏️ แก้ไข
                            </button>
                            <button
                              onClick={() => deleteSeason(s.id, s.name)}
                              className="px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-700 rounded"
                            >
                              🗑️ ลบ
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================
          TAB: AGE GROUPS
          ================================================================== */}
      {activeTab === 'age-groups' && (
        <div className={`grid gap-6 ${agForm ? 'md:grid-cols-3' : 'grid-cols-1'}`}>
          {/* Form */}
          {agForm && (
            <div className="bg-white rounded-xl shadow p-5">
              <h2 className="font-semibold text-gray-800 mb-4">
                {agForm.mode === 'add' ? 'เพิ่ม Age Group' : 'แก้ไข Age Group'}
              </h2>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Code * (เช่น U14, U17)</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 uppercase"
                    value={agForm.data.code}
                    onChange={(e) =>
                      setAgForm({ ...agForm, data: { ...agForm.data, code: e.target.value } })
                    }
                    placeholder="U14"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ชื่อเต็ม *</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={agForm.data.name}
                    onChange={(e) =>
                      setAgForm({ ...agForm, data: { ...agForm.data, name: e.target.value } })
                    }
                    placeholder="Under 14"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ลำดับการแสดง</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={agForm.data.sort_order}
                    onChange={(e) =>
                      setAgForm({ ...agForm, data: { ...agForm.data, sort_order: parseInt(e.target.value) || 0 } })
                    }
                  />
                </div>
              </div>

              {agMsg && (
                <div
                  className={`mt-3 p-2 rounded text-xs ${
                    agMsg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                  }`}
                >
                  {agMsg.text}
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  onClick={submitAgeGroup}
                  disabled={agLoading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg py-2 text-sm font-medium"
                >
                  {agLoading ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button
                  onClick={() => { setAgForm(null); setAgMsg(null); }}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          <div className={`bg-white rounded-xl shadow ${agForm ? 'md:col-span-2' : ''}`}>
            <div className="p-4 border-b">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800">Age Groups ({ageGroups.length})</h2>
                <button
                  onClick={() => { setAgForm({ mode: 'add', data: { ...EMPTY_AG } }); setAgMsg(null); }}
                  disabled={!selectedSeasonId}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium"
                >
                  + เพิ่ม Age Group
                </button>
              </div>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={selectedSeasonId}
                onChange={(e) => { setSelectedSeasonId(e.target.value); setAgForm(null); setAgMsg(null); }}
              >
                <option value="">— เลือก Season —</option>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.year})
                  </option>
                ))}
              </select>
            </div>

            {agMsg && !agForm && (
              <div
                className={`mx-4 mt-3 p-2 rounded text-xs ${
                  agMsg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                }`}
              >
                {agMsg.text}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-left px-4 py-3">Code</th>
                    <th className="text-left px-4 py-3">ชื่อ</th>
                    <th className="text-center px-4 py-3">ลำดับ</th>
                    <th className="text-center px-4 py-3">Divisions</th>
                    <th className="text-center px-4 py-3">Teams</th>
                    <th className="text-right px-4 py-3">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {!selectedSeasonId && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-gray-400">กรุณาเลือก Season</td>
                    </tr>
                  )}
                  {selectedSeasonId && ageGroups.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-gray-400">ยังไม่มี Age Group ใน Season นี้</td>
                    </tr>
                  )}
                  {ageGroups.map((ag) => (
                    <tr key={ag.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono font-semibold text-blue-700">{ag.code}</td>
                      <td className="px-4 py-3 text-gray-800">{ag.name}</td>
                      <td className="px-4 py-3 text-center text-gray-500">{ag.sort_order}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="bg-indigo-100 text-indigo-700 text-xs font-medium px-2 py-0.5 rounded-full">
                          {ag.division_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">
                          {ag.team_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setAgForm({
                                mode: 'edit',
                                id: ag.id,
                                data: { code: ag.code, name: ag.name, sort_order: ag.sort_order },
                              });
                              setAgMsg(null);
                            }}
                            className="px-2 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 rounded"
                          >
                            ✏️ แก้ไข
                          </button>
                          <button
                            onClick={() => deleteAgeGroup(ag.id, ag.code)}
                            className="px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-700 rounded"
                          >
                            🗑️ ลบ
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================
          TAB: DIVISIONS
          ================================================================== */}
      {activeTab === 'divisions' && (
        <div className={`grid gap-6 ${divForm ? 'md:grid-cols-3' : 'grid-cols-1'}`}>
          {/* Form */}
          {divForm && (
            <div className="bg-white rounded-xl shadow p-5">
              <h2 className="font-semibold text-gray-800 mb-4">
                {divForm.mode === 'add' ? 'เพิ่ม Division' : 'แก้ไข Division'}
              </h2>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ชื่อ Division *</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={divForm.data.name}
                    onChange={(e) =>
                      setDivForm({ ...divForm, data: { ...divForm.data, name: e.target.value } })
                    }
                    placeholder="เช่น Division 1"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ลำดับการแสดง</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={divForm.data.sort_order}
                    onChange={(e) =>
                      setDivForm({ ...divForm, data: { ...divForm.data, sort_order: parseInt(e.target.value) || 0 } })
                    }
                  />
                </div>
              </div>

              {divMsg && (
                <div
                  className={`mt-3 p-2 rounded text-xs ${
                    divMsg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                  }`}
                >
                  {divMsg.text}
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  onClick={submitDivision}
                  disabled={divLoading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg py-2 text-sm font-medium"
                >
                  {divLoading ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button
                  onClick={() => { setDivForm(null); setDivMsg(null); }}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          <div className={`bg-white rounded-xl shadow ${divForm ? 'md:col-span-2' : ''}`}>
            <div className="p-4 border-b">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800">Divisions ({divisions.length})</h2>
                <button
                  onClick={() => { setDivForm({ mode: 'add', data: { ...EMPTY_DIV } }); setDivMsg(null); }}
                  disabled={!divSeasonId || !divAgeGroupId}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium"
                >
                  + เพิ่ม Division
                </button>
              </div>
              <div className="flex gap-3">
                <select
                  className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={divSeasonId}
                  onChange={(e) => { setDivSeasonId(e.target.value); setDivForm(null); setDivMsg(null); }}
                >
                  <option value="">— เลือก Season —</option>
                  {seasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.year})
                    </option>
                  ))}
                </select>
                <select
                  className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={divAgeGroupId}
                  onChange={(e) => { setDivAgeGroupId(e.target.value); setDivForm(null); setDivMsg(null); }}
                  disabled={!divSeasonId}
                >
                  <option value="">— เลือก Age Group —</option>
                  {divAgeGroups.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.code} — {ag.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {divMsg && !divForm && (
              <div
                className={`mx-4 mt-3 p-2 rounded text-xs ${
                  divMsg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                }`}
              >
                {divMsg.text}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-left px-4 py-3">ชื่อ Division</th>
                    <th className="text-center px-4 py-3">ลำดับ</th>
                    <th className="text-center px-4 py-3">Teams</th>
                    <th className="text-center px-4 py-3">Matches</th>
                    <th className="text-right px-4 py-3">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {!divSeasonId && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-gray-400">กรุณาเลือก Season</td>
                    </tr>
                  )}
                  {divSeasonId && !divAgeGroupId && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-gray-400">กรุณาเลือก Age Group</td>
                    </tr>
                  )}
                  {divSeasonId && divAgeGroupId && divisions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-gray-400">ยังไม่มี Division ใน Age Group นี้</td>
                    </tr>
                  )}
                  {divisions.map((d) => (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{d.name}</td>
                      <td className="px-4 py-3 text-center text-gray-500">{d.sort_order}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">
                          {d.team_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="bg-orange-100 text-orange-700 text-xs font-medium px-2 py-0.5 rounded-full">
                          {d.match_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setDivForm({
                                mode: 'edit',
                                id: d.id,
                                data: { name: d.name, sort_order: d.sort_order },
                              });
                              setDivMsg(null);
                            }}
                            className="px-2 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 rounded"
                          >
                            ✏️ แก้ไข
                          </button>
                          <button
                            onClick={() => deleteDivision(d.id, d.name)}
                            className="px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-700 rounded"
                          >
                            🗑️ ลบ
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================
          CONFIRM DIALOG: Active Season Conflict
          ================================================================== */}
      {confirmActive && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">⚠️ ยืนยันการเปลี่ยนสถานะ</h3>
            <p className="text-sm text-gray-600 mb-4">
              Season ต่อไปนี้กำลัง Active อยู่ และจะถูกเปลี่ยนเป็น{' '}
              <span className="font-semibold text-gray-800">&quot;เสร็จสิ้น&quot;</span> อัตโนมัติ:
            </p>
            <ul className="bg-amber-50 rounded-lg p-3 mb-4 space-y-1">
              {confirmActive.conflicting.map((name) => (
                <li key={name} className="text-sm text-amber-800 font-medium">
                  • {name}
                </li>
              ))}
            </ul>
            <p className="text-sm text-gray-600 mb-5">ต้องการดำเนินการต่อหรือไม่?</p>
            <div className="flex gap-3">
              <button
                onClick={() => handleSeasonSave('active')}
                disabled={seasonLoading}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg py-2 text-sm font-medium"
              >
                {seasonLoading ? 'กำลังบันทึก...' : 'ยืนยัน — เปลี่ยนสถานะ'}
              </button>
              <button
                onClick={() => setConfirmActive(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
