'use client';

import { useEffect, useRef, useState } from 'react';
import { TeamLogo } from '@/components/TeamLogo';

interface Team {
  id: string;
  name: string;
  short_name?: string;
  logo_url?: string;
  age_group?: { code: string; name: string };
  division?: { name: string };
}

export default function AdminTeamLogosPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  // Load teams
  useEffect(() => {
    const loadTeams = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('/api/admin/teams?seasonId=current&ageGroupId=current');
        if (!response.ok) throw new Error('Failed to load teams');
        const data = await response.json();
        setTeams(data);
      } catch (error) {
        console.error('Error loading teams:', error);
        setMessage({ type: 'error', text: 'ไม่สามารถโหลดข้อมูลทีมได้' });
      } finally {
        setIsLoading(false);
      }
    };

    loadTeams();
  }, []);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
      setMessage({ type: 'error', text: 'รูปต้องเป็น PNG, JPG หรือ WebP เท่านั้น' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'ไฟล์ใหญ่เกิน 5MB' });
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
    setMessage(null);
  };

  // Handle upload
  const handleUpload = async () => {
    if (!selectedTeamId || !selectedFile) {
      setMessage({ type: 'error', text: 'ต้องเลือกทีมและไฟล์' });
      return;
    }

    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append('teamId', selectedTeamId);
      formData.append('file', selectedFile);

      const response = await fetch('/api/admin/team-logos/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage({ type: 'error', text: result.error || 'อัปโหลดไม่สำเร็จ' });
        return;
      }

      // Update team data
      setTeams((prevTeams) =>
        prevTeams.map((t) =>
          t.id === selectedTeamId ? { ...t, logo_url: result.logo_url } : t
        )
      );

      setMessage({ type: 'success', text: result.message || 'อัปโหลดโลโก้สำเร็จ' });
      setSelectedFile(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      setTimeout(() => setMessage(null), 3500);
    } catch (error) {
      console.error('Upload error:', error);
      setMessage({ type: 'error', text: 'เกิดข้อผิดพลาดในการอัปโหลด' });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-800 mb-2">จัดการโลโก้ทีม</h1>
        <p className="text-gray-600">อัปโหลดโลโก้ทีมจากเครื่อง แล้วบันทึกลง Supabase Storage</p>
      </div>

      {/* Messages */}
      {message && (
        <div
          className={`p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-100 text-green-700 border border-green-300'
              : 'bg-red-100 text-red-700 border border-red-300'
          }`}
        >
          {message.text}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-6 text-gray-600">กำลังโหลดข้อมูลทีม...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Team Selection */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">เลือกทีม</label>
              <select
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- เลือกทีม --</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.age_group?.code && `${team.age_group.code} - `}
                    {team.name}
                    {team.short_name && ` (${team.short_name})`}
                  </option>
                ))}
              </select>
            </div>

            {/* Current Logo */}
            {selectedTeam && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">โลโก้ปัจจุบัน</label>
                <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                  <TeamLogo
                    logoUrl={selectedTeam.logo_url}
                    name={selectedTeam.name}
                    shortName={selectedTeam.short_name}
                    size="lg"
                  />
                  <div className="text-sm text-gray-600">
                    {selectedTeam.logo_url ? (
                      <>
                        <p className="font-semibold">มีโลโก้</p>
                        <p className="text-xs text-gray-500 truncate">{selectedTeam.logo_url}</p>
                      </>
                    ) : (
                      <p className="font-semibold">ยังไม่มีโลโก้</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* File Input */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">เลือกไฟล์โลโก้</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                onChange={handleFileChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">PNG, JPG, WebP (ไม่เกิน 5MB)</p>
            </div>
          </div>

          {/* Right: Preview & Upload */}
          <div className="space-y-4">
            {/* Preview */}
            {preview && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">ตัวอย่างรูป</label>
                <div className="p-4 bg-gray-50 rounded-lg flex items-center justify-center">
                  <img
                    src={preview}
                    alt="Preview"
                    className="max-h-48 max-w-full object-contain rounded"
                  />
                </div>
              </div>
            )}

            {/* Upload Button */}
            <button
              onClick={handleUpload}
              disabled={!selectedTeamId || !selectedFile || isUploading}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-lg transition"
            >
              {isUploading ? 'กำลังอัปโหลด...' : 'อัปโหลดและบันทึกโลโก้'}
            </button>

            {selectedFile && (
              <p className="text-sm text-gray-600 text-center">
                ไฟล์: <span className="font-semibold">{selectedFile.name}</span>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
