'use client';

import { useEffect, useState } from 'react';

type Banner = { type: 'success' | 'error'; text: string } | null;

export default function AdminSettingsPage() {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const authHeader = (): Record<string, string> => {
    const token = localStorage.getItem('admin_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  useEffect(() => {
    fetch('/api/admin/settings/notifications', { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setWebhookUrl(data.webhook_url || '');
          setEnabled(data.enabled !== false);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setBanner(null);
    try {
      const res = await fetch('/api/admin/settings/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ webhook_url: webhookUrl, enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
      setBanner({ type: 'success', text: 'บันทึกการตั้งค่าแล้ว' });
    } catch (e) {
      setBanner({ type: 'error', text: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' });
    } finally {
      setSaving(false);
    }
  };

  const testSend = async () => {
    setTesting(true);
    setBanner(null);
    try {
      const res = await fetch('/api/admin/notifications/discord/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ส่งทดสอบไม่สำเร็จ');
      setBanner({ type: 'success', text: data.message || 'ส่งข้อความทดสอบสำเร็จ' });
    } catch (e) {
      setBanner({ type: 'error', text: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800">⚙️ Settings</h1>
        <p className="text-slate-600 mt-1 text-sm">ตั้งค่าระบบ</p>
      </div>

      {banner && (
        <div className={`p-3 rounded-lg text-sm border ${
          banner.type === 'success'
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {banner.type === 'success' ? '✅ ' : '❌ '}{banner.text}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-slate-800">📣 Discord Notification</h2>
          <p className="text-xs text-slate-500 mt-1">
            แจ้งเตือนผู้ติดโทษแบนไปยัง Discord channel ผ่าน Webhook (ใช้ฝั่งเซิร์ฟเวอร์เท่านั้น)
          </p>
        </div>

        {loading ? (
          <div className="text-slate-500 text-sm py-4">กำลังโหลด...</div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Discord Webhook URL</label>
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400 mt-1">
                สร้างได้จาก Discord: Server Settings → Integrations → Webhooks
              </p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4" />
              <span className="text-sm text-slate-700">เปิดใช้งานการแจ้งเตือน (Enabled)</span>
            </label>

            <div className="flex gap-2 pt-2">
              <button onClick={save} disabled={saving} className="px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-lg text-sm font-semibold">
                {saving ? 'กำลังบันทึก...' : '💾 บันทึกการตั้งค่า'}
              </button>
              <button onClick={testSend} disabled={testing} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-lg text-sm font-semibold">
                {testing ? 'กำลังส่ง...' : '🧪 Test Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
