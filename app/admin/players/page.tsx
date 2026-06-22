'use client';

import { useEffect, useState } from 'react';
import { BulkImportPanel } from '@/components/BulkImportPanel';

interface Season {
  id: string;
  name: string;
  year: number;
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
  division_id: string | null;
}

interface Player {
  id: string;
  player_code: string;
  shirt_no: number | null;
  full_name: string;
  birth_date: string | null;
  remarks: string | null;
  active: boolean;
  season_id: string;
  age_group_id: string;
  division_id: string | null;
  team_id: string;
  team: { id: string; name: string; short_name: string } | null;
}

interface FormData {
  player_code: string;
  full_name: string;
  shirt_no: string;
  team_id: string;
  birth_date: string;
  remarks: string;
  active: boolean;
}

const EMPTY_FORM: FormData = {
  player_code: '',
  full_name: '',
  shirt_no: '',
  team_id: '',
  birth_date: '',
  remarks: '',
  active: true,
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('admin_token');
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function AdminPlayersPage() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);

  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedAgeGroup, setSelectedAgeGroup] = useState('');
  const [filterTeam, setFilterTeam] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [isLoadingSeasons, setIsLoadingSeasons] = useState(true);
  const [isLoadingAgeGroups, setIsLoadingAgeGroups] = useState(false);
  const [isLoadingTeams, setIsLoadingTeams] = useState(false);
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form
  const [formMode, setFormMode] = useState<'closed' | 'add' | 'edit'>('closed');
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  // Load seasons on mount
  useEffect(() => {
    fetch('/api/public/seasons')
      .then((r) => r.json())
      .then((data) => {
        setSeasons(data);
        if (data.length > 0) setSelectedSeason(data[0].id);
      })
      .catch(() => setPageError('โหลด Season ล้มเหลว'))
      .finally(() => setIsLoadingSeasons(false));
  }, []);

  // Load age groups when season changes
  useEffect(() => {
    if (!selectedSeason) return;
    setIsLoadingAgeGroups(true);
    setSelectedAgeGroup('');
    setAgeGroups([]);
    setTeams([]);
    setPlayers([]);

    fetch(`/api/public/age-groups?seasonId=${selectedSeason}`)
      .then((r) => r.json())
      .then((data) => {
        setAgeGroups(data);
        if (data.length > 0) setSelectedAgeGroup(data[0].id);
      })
      .catch(() => setPageError('โหลด Age Group ล้มเหลว'))
      .finally(() => setIsLoadingAgeGroups(false));
  }, [selectedSeason]);

  // Load teams + players when age group changes
  useEffect(() => {
    if (!selectedSeason || !selectedAgeGroup) return;
    setFilterTeam('');
    setSearchQuery('');
    loadTeams();
    loadPlayers();
  }, [selectedSeason, selectedAgeGroup]);

  const loadTeams = async () => {
    setIsLoadingTeams(true);
    try {
      const res = await fetch(
        `/api/public/teams?seasonId=${selectedSeason}&ageGroupId=${selectedAgeGroup}`
      );
      const data = await res.json();
      setTeams(data);
    } catch {
      setPageError('โหลดทีมล้มเหลว');
    } finally {
      setIsLoadingTeams(false);
    }
  };

  const loadPlayers = async () => {
    if (!selectedSeason || !selectedAgeGroup) return;
    setIsLoadingPlayers(true);
    setPageError(null);
    try {
      const token = getToken();
      const res = await fetch(
        `/api/admin/players/manage?seasonId=${selectedSeason}&ageGroupId=${selectedAgeGroup}`,
        { headers: authHeaders(token) }
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Unauthorized');
      }
      const data = await res.json();
      setPlayers(data);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'โหลดข้อมูลผู้เล่นล้มเหลว');
    } finally {
      setIsLoadingPlayers(false);
    }
  };

  // Client-side filter
  const filteredPlayers = players.filter((p) => {
    if (!showInactive && !p.active) return false;
    if (filterTeam && p.team_id !== filterTeam) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        p.full_name.toLowerCase().includes(q) ||
        p.player_code.toLowerCase().includes(q) ||
        String(p.shirt_no ?? '').includes(q)
      );
    }
    return true;
  });

  const activeCount = players.filter((p) => p.active).length;
  const inactiveCount = players.filter((p) => !p.active).length;

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  // Form handlers
  const openAddForm = () => {
    setFormMode('add');
    setEditingPlayerId(null);
    setFormData({ ...EMPTY_FORM, team_id: filterTeam || (teams[0]?.id ?? '') });
    setFormError(null);
  };

  const openEditForm = (player: Player) => {
    setFormMode('edit');
    setEditingPlayerId(player.id);
    setFormData({
      player_code: player.player_code,
      full_name: player.full_name,
      shirt_no: String(player.shirt_no ?? ''),
      team_id: player.team_id,
      birth_date: player.birth_date || '',
      remarks: player.remarks || '',
      active: player.active,
    });
    setFormError(null);
  };

  const closeForm = () => {
    setFormMode('closed');
    setEditingPlayerId(null);
    setFormData(EMPTY_FORM);
    setFormError(null);
  };

  const handleFormChange = (field: keyof FormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.player_code.trim() || !formData.full_name.trim() || !formData.team_id) {
      setFormError('กรุณากรอก PlayerID, ชื่อ-นามสกุล และทีม');
      return;
    }

    setFormLoading(true);
    setFormError(null);

    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    };

    const payload = {
      player_code: formData.player_code.trim(),
      full_name: formData.full_name.trim(),
      shirt_no: formData.shirt_no ? Number(formData.shirt_no) : null,
      team_id: formData.team_id,
      birth_date: formData.birth_date || null,
      remarks: formData.remarks.trim() || null,
      ...(formMode === 'edit' ? { active: formData.active } : {}),
    };

    try {
      if (formMode === 'add') {
        const res = await fetch('/api/admin/players/manage', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'เพิ่มผู้เล่นล้มเหลว');
        showSuccess(`✅ เพิ่ม "${data.full_name}" สำเร็จ`);
        setFormData({ ...EMPTY_FORM, team_id: formData.team_id });
      } else if (formMode === 'edit' && editingPlayerId) {
        const res = await fetch(`/api/admin/players/${editingPlayerId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'แก้ไขข้อมูลล้มเหลว');
        showSuccess(`✅ แก้ไข "${data.full_name}" สำเร็จ`);
        closeForm();
      }
      await loadPlayers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleActive = async (player: Player) => {
    const newActive = !player.active;
    const label = newActive ? 'เปิดการใช้งาน' : 'ปิดการใช้งาน';
    if (!confirm(`ต้องการ${label} "${player.full_name}" ใช่หรือไม่?`)) return;

    const token = getToken();
    try {
      const res = await fetch(`/api/admin/players/${player.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ active: newActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ล้มเหลว');
      showSuccess(`✅ ${label} "${player.full_name}" สำเร็จ`);
      setPlayers((prev) =>
        prev.map((p) => (p.id === player.id ? { ...p, active: newActive } : p))
      );
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    }
  };

  const handleDelete = async (player: Player) => {
    if (
      !confirm(
        `ต้องการลบ "${player.full_name}" ออกจากระบบ?\n⚠️ การลบไม่สามารถกู้คืนได้`
      )
    )
      return;

    const token = getToken();
    try {
      const res = await fetch(`/api/admin/players/${player.id}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setPageError(data.error);
        } else {
          throw new Error(data.error || 'ลบล้มเหลว');
        }
        return;
      }
      showSuccess(`✅ ลบ "${player.full_name}" สำเร็จ`);
      setPlayers((prev) => prev.filter((p) => p.id !== player.id));
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    }
  };

  const isFormOpen = formMode !== 'closed';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800">👤 Player Management</h1>
          <p className="text-gray-600 mt-1 text-sm">เพิ่ม แก้ไข และจัดการสถานะนักกีฬา</p>
        </div>
        {selectedSeason && selectedAgeGroup && !isFormOpen && (
          <button
            onClick={openAddForm}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition"
          >
            ➕ เพิ่มผู้เล่น
          </button>
        )}
      </div>

      {/* Messages */}
      {successMessage && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {successMessage}
        </div>
      )}
      {pageError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start justify-between gap-2">
          <span>⚠️ {pageError}</span>
          <button onClick={() => setPageError(null)} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
        </div>
      )}

      {/* Selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Season</label>
          <select
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(e.target.value)}
            disabled={isLoadingSeasons}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          >
            <option value="">เลือก Season...</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Age Group</label>
          <select
            value={selectedAgeGroup}
            onChange={(e) => setSelectedAgeGroup(e.target.value)}
            disabled={isLoadingAgeGroups || !selectedSeason}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          >
            <option value="">เลือก Age Group...</option>
            {ageGroups.map((ag) => (
              <option key={ag.id} value={ag.id}>{ag.code} — {ag.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Search + Filter bar */}
      {selectedSeason && selectedAgeGroup && (
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            <input
              type="text"
              placeholder="ค้นหาชื่อ / PlayerID / เบอร์เสื้อ"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filterTeam}
            onChange={(e) => setFilterTeam(e.target.value)}
            disabled={isLoadingTeams}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          >
            <option value="">ทุกทีม</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.short_name ? ` (${t.short_name})` : ''}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300"
            />
            แสดงที่ปิดการใช้งานด้วย
          </label>
          {isFormOpen && (
            <button
              onClick={openAddForm}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition"
            >
              ➕ เพิ่ม
            </button>
          )}
        </div>
      )}

      {/* Bulk add / import */}
      {selectedSeason && selectedAgeGroup && (
        <BulkImportPanel
          title="Bulk Add / Import Players"
          seasonId={selectedSeason}
          ageGroupId={selectedAgeGroup}
          columns={[
            { key: 'team_code', label: 'team_code', placeholder: 'short' },
            { key: 'team_name', label: 'team_name', placeholder: 'หรือชื่อทีม' },
            { key: 'player_code', label: 'player_code', placeholder: 'เว้นว่าง=auto' },
            { key: 'shirt_no', label: 'shirt_no', placeholder: 'เบอร์' },
            { key: 'full_name', label: 'full_name', placeholder: 'ชื่อ-สกุล' },
            { key: 'active', label: 'active' },
          ]}
          previewUrl="/api/admin/players/bulk/preview"
          saveUrl="/api/admin/players/bulk/save"
          templateUrl="/api/admin/players/bulk/template"
          templateFilename="players_template.xlsx"
          hints={[
            'Players ต้องอิง Team ที่มีอยู่แล้ว — ใช้ team_code (short_name) ก่อน ไม่มีจึงใช้ team_name',
            'player_code เว้นว่าง = สร้างอัตโนมัติ ({AGE}-{TEAM}-001) · ห้ามซ้ำในฤดูกาล',
          ]}
          onSaved={loadPlayers}
        />
      )}

      {/* Main content */}
      {!selectedSeason || !selectedAgeGroup ? (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center text-blue-700">
          เลือก Season และ Age Group เพื่อดูข้อมูลผู้เล่น
        </div>
      ) : isLoadingPlayers ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-3"></div>
          <span className="text-gray-600">กำลังโหลดข้อมูล...</span>
        </div>
      ) : (
        <div className={`grid gap-4 sm:gap-6 ${isFormOpen ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1'}`}>

          {/* Add/Edit Form */}
          {isFormOpen && (
            <div className="md:col-span-1 bg-white rounded-lg shadow p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-800">
                  {formMode === 'add' ? '➕ เพิ่มผู้เล่น' : '✏️ แก้ไขข้อมูล'}
                </h2>
                <button
                  onClick={closeForm}
                  className="text-gray-400 hover:text-gray-600 text-lg font-bold"
                >
                  ✕
                </button>
              </div>

              {formError && (
                <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    PlayerID <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.player_code}
                    onChange={(e) => handleFormChange('player_code', e.target.value)}
                    placeholder="เช่น CFYL2026001"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    ชื่อ-นามสกุล <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.full_name}
                    onChange={(e) => handleFormChange('full_name', e.target.value)}
                    placeholder="ชื่อเต็ม"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">เบอร์เสื้อ</label>
                  <input
                    type="number"
                    value={formData.shirt_no}
                    onChange={(e) => handleFormChange('shirt_no', e.target.value)}
                    placeholder="0–99"
                    min={0}
                    max={99}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    ทีม <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.team_id}
                    onChange={(e) => handleFormChange('team_id', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="">เลือกทีม...</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}{t.short_name ? ` (${t.short_name})` : ''}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">วันเกิด</label>
                  <input
                    type="date"
                    value={formData.birth_date}
                    onChange={(e) => handleFormChange('birth_date', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">หมายเหตุ</label>
                  <textarea
                    value={formData.remarks}
                    onChange={(e) => handleFormChange('remarks', e.target.value)}
                    placeholder="หมายเหตุ (ถ้ามี)"
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>

                {formMode === 'edit' && (
                  <div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={formData.active}
                        onChange={(e) => handleFormChange('active', e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                      <span className="font-semibold text-gray-700">ใช้งานอยู่ (Active)</span>
                    </label>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={formLoading}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-semibold text-sm transition"
                  >
                    {formLoading ? 'กำลังบันทึก...' : '💾 บันทึก'}
                  </button>
                  <button
                    type="button"
                    onClick={closeForm}
                    disabled={formLoading}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-semibold text-sm transition"
                  >
                    ยกเลิก
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Player List */}
          <div className={`${isFormOpen ? 'md:col-span-2' : 'col-span-1'} bg-white rounded-lg shadow overflow-hidden`}>
            {/* Summary */}
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap gap-4 text-sm">
              <span className="text-gray-700">
                แสดง <strong>{filteredPlayers.length}</strong> / {players.length} คน
              </span>
              <span className="text-green-700">🟢 ใช้งาน {activeCount} คน</span>
              {inactiveCount > 0 && (
                <span className="text-red-600">🔴 ปิดใช้งาน {inactiveCount} คน</span>
              )}
            </div>

            {filteredPlayers.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                {searchQuery || filterTeam ? 'ไม่พบผู้เล่นที่ตรงกับการค้นหา' : 'ยังไม่มีข้อมูลผู้เล่น'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-800 text-white text-xs">
                      <th className="px-3 py-3 text-center w-8">#</th>
                      <th className="px-3 py-3 text-center w-12">เบอร์</th>
                      <th className="px-3 py-3 text-left">ชื่อ-นามสกุล</th>
                      <th className="px-3 py-3 text-left">PlayerID</th>
                      <th className="px-3 py-3 text-left hidden sm:table-cell">ทีม</th>
                      <th className="px-3 py-3 text-left hidden md:table-cell">วันเกิด</th>
                      <th className="px-3 py-3 text-center">สถานะ</th>
                      <th className="px-3 py-3 text-center">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlayers.map((player, index) => (
                      <tr
                        key={player.id}
                        className={`border-b border-gray-100 transition hover:bg-gray-50 ${
                          !player.active ? 'opacity-60' : ''
                        } ${editingPlayerId === player.id ? 'bg-blue-50' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}
                      >
                        <td className="px-3 py-2.5 text-center text-gray-400 text-xs">{index + 1}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-gray-700">
                          {player.shirt_no ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-gray-800">
                          {player.full_name}
                          {player.remarks && (
                            <span
                              title={player.remarks}
                              className="ml-1 text-gray-400 text-xs cursor-help"
                            >
                              ℹ️
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 text-xs font-mono">
                          {player.player_code}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 text-xs hidden sm:table-cell">
                          {player.team?.name ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 text-xs hidden md:table-cell">
                          {formatDate(player.birth_date)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {player.active ? (
                            <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                              🟢 ใช้งาน
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs font-semibold">
                              🔴 ปิดใช้งาน
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => openEditForm(player)}
                              title="แก้ไข"
                              className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleToggleActive(player)}
                              title={player.active ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน'}
                              className={`px-2 py-1 text-xs rounded transition ${
                                player.active
                                  ? 'bg-red-100 hover:bg-red-200 text-red-700'
                                  : 'bg-green-100 hover:bg-green-200 text-green-700'
                              }`}
                            >
                              {player.active ? '🔴' : '✅'}
                            </button>
                            {!player.active && (
                              <button
                                onClick={() => handleDelete(player)}
                                title="ลบออกจากระบบ"
                                className="px-2 py-1 text-xs bg-gray-100 hover:bg-red-100 text-gray-500 hover:text-red-600 rounded transition"
                              >
                                🗑️
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
