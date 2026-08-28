'use client';

import type { CardNotePreset } from '@/lib/card-note-presets';

interface CardNoteInputProps {
  value: string;
  onChange: (value: string) => void;
  presets: CardNotePreset[];
  disabled?: boolean;
  label?: string;
  compact?: boolean;
  placeholder?: string;
}

export function CardNoteInput({
  value,
  onChange,
  presets,
  disabled = false,
  label = 'หมายเหตุ',
  compact = false,
  placeholder = 'หรือพิมพ์หมายเหตุอื่นเอง...',
}: CardNoteInputProps) {
  const exactPreset = presets.some((preset) => preset.note === value) ? value : '';

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {!compact && (
        <label className="block text-sm font-semibold text-gray-700">
          {label} <span className="text-gray-400 font-normal text-xs">(ไม่บังคับ)</span>
        </label>
      )}
      <select
        value={exactPreset}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
        disabled={disabled}
        aria-label={`${label}สำเร็จรูป`}
        className={`w-full border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 ${
          compact ? 'rounded-md px-2 py-1.5' : 'rounded-lg px-3 py-2'
        }`}
      >
        <option value="">— เลือกจากรายการ —</option>
        {presets.map((preset) => (
          <option key={preset.id} value={preset.note}>
            {preset.note}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={`${label}เพิ่มเติม`}
        className={`w-full border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 ${
          compact ? 'rounded-md px-2 py-1.5' : 'rounded-lg px-3 py-2'
        }`}
      />
      {!compact && (
        <p className="text-xs text-gray-400">
          เลือกรายการด้านบนแล้วแก้ข้อความต่อได้ หรือพิมพ์เองได้โดยไม่ต้องเพิ่มเป็น preset
        </p>
      )}
    </div>
  );
}
