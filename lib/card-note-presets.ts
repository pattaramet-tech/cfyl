export interface CardNotePreset {
  id: string;
  note: string;
  created_at?: string | null;
}

export const CARD_NOTE_PRESET_MAX_LENGTH = 200;

export function normalizeOptionalCardNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function validateCardNotePreset(value: unknown):
  | { ok: true; note: string }
  | { ok: false; error: string } {
  if (typeof value !== 'string') {
    return { ok: false, error: 'หมายเหตุต้องเป็นข้อความ' };
  }

  const note = value.trim();
  if (!note) {
    return { ok: false, error: 'กรุณากรอกหมายเหตุที่ต้องการเพิ่ม' };
  }
  if (note.length > CARD_NOTE_PRESET_MAX_LENGTH) {
    return {
      ok: false,
      error: `หมายเหตุสำเร็จรูปต้องไม่เกิน ${CARD_NOTE_PRESET_MAX_LENGTH} ตัวอักษร`,
    };
  }

  return { ok: true, note };
}

export function sortCardNotePresets<T extends Pick<CardNotePreset, 'note' | 'created_at'>>(
  presets: T[]
): T[] {
  return [...presets].sort((a, b) => {
    const createdA = a.created_at || '';
    const createdB = b.created_at || '';
    if (createdA !== createdB) return createdA.localeCompare(createdB);
    return a.note.localeCompare(b.note, 'th');
  });
}
