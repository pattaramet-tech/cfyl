import { describe, expect, it } from 'vitest';
import {
  normalizeOptionalCardNote,
  sortCardNotePresets,
  validateCardNotePreset,
} from '../card-note-presets';

describe('card note presets', () => {
  it('keeps card notes optional and converts blank text to null', () => {
    expect(normalizeOptionalCardNote(undefined)).toBeNull();
    expect(normalizeOptionalCardNote(null)).toBeNull();
    expect(normalizeOptionalCardNote('   ')).toBeNull();
  });

  it('preserves arbitrary free text after trimming without requiring a preset', () => {
    expect(normalizeOptionalCardNote('  ผู้เล่นประท้วงคำตัดสินเพิ่มเติม  ')).toBe(
      'ผู้เล่นประท้วงคำตัดสินเพิ่มเติม'
    );
  });

  it('validates and trims a preset but rejects blank or overlong values', () => {
    expect(validateCardNotePreset('  เล่นอันตราย  ')).toEqual({
      ok: true,
      note: 'เล่นอันตราย',
    });
    expect(validateCardNotePreset('   ')).toMatchObject({ ok: false });
    expect(validateCardNotePreset('x'.repeat(201))).toMatchObject({ ok: false });
  });

  it('keeps preset ordering deterministic by creation time then Thai label', () => {
    const sorted = sortCardNotePresets([
      { id: 'b', note: 'ประท้วงคำตัดสิน', created_at: '2026-08-02T00:00:00Z' },
      { id: 'a', note: 'เล่นอันตราย', created_at: '2026-08-01T00:00:00Z' },
    ]);
    expect(sorted.map((row) => row.id)).toEqual(['a', 'b']);
  });
});
