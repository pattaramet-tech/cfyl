import { BulkImportRowResult } from '@/types/bulk-import';

// Validation helpers

export function validateMinute(minute: any): { valid: boolean; value?: number | null; error?: string } {
  if (minute === null || minute === undefined || minute === '') {
    return { valid: true, value: null };
  }

  const num = Number(minute);
  if (isNaN(num)) {
    return { valid: false, error: 'นาทีต้องเป็นตัวเลข' };
  }

  if (num < 0 || num > 120) {
    return { valid: false, error: 'นาทีต้องอยู่ระหว่าง 0-120' };
  }

  return { valid: true, value: num };
}

export function validateScore(score: any): { valid: boolean; value?: number | null; error?: string } {
  if (score === null || score === undefined || score === '') {
    return { valid: true, value: null };
  }

  const num = Number(score);
  if (isNaN(num)) {
    return { valid: false, error: 'คะแนนต้องเป็นตัวเลข' };
  }

  if (num < 0) {
    return { valid: false, error: 'คะแนนต้องเป็นค่าบวก' };
  }

  return { valid: true, value: Math.floor(num) };
}

export function validateCardType(cardType: any): { valid: boolean; normalized?: string; error?: string } {
  if (!cardType || typeof cardType !== 'string') {
    return { valid: false, error: 'ประเภทบัตรจำเป็น' };
  }

  const normalized = cardType.trim().toLowerCase();
  const valid = ['yellow', 'second_yellow', 'red'].includes(normalized);

  if (!valid) {
    return { valid: false, error: 'ประเภทบัตรต้องเป็น yellow/second_yellow/red' };
  }

  return { valid: true, normalized };
}

export function validateDisciplineType(
  disciplineType: any
): { valid: boolean; normalized?: string; error?: string } {
  if (!disciplineType || typeof disciplineType !== 'string') {
    return { valid: false, error: 'ประเภทวินัยจำเป็น' };
  }

  let normalized = disciplineType.trim().toLowerCase();

  // Normalize caution to warning
  if (normalized === 'caution') {
    normalized = 'warning';
  }

  const valid = ['warning', 'ejection', 'ban'].includes(normalized);

  if (!valid) {
    return { valid: false, error: 'ประเภทวินัยต้องเป็น warning/ejection/ban' };
  }

  return { valid: true, normalized };
}

export function validateMatchStatus(status: any): { valid: boolean; normalized?: string; error?: string } {
  if (!status || typeof status !== 'string') {
    return { valid: false, error: 'สถานะแมตช์จำเป็น' };
  }

  const normalized = status.trim().toLowerCase();
  const valid = ['scheduled', 'finished', 'postponed', 'cancelled'].includes(normalized);

  if (!valid) {
    return { valid: false, error: 'สถานะต้องเป็น scheduled/finished/postponed/cancelled' };
  }

  return { valid: true, normalized };
}

export function validateGoalsCount(goals: any): { valid: boolean; value?: number; error?: string } {
  if (goals === null || goals === undefined || goals === '') {
    return { valid: true, value: 1 };
  }

  const num = Number(goals);
  if (isNaN(num)) {
    return { valid: false, error: 'จำนวนประตูต้องเป็นตัวเลข' };
  }

  if (num < 1) {
    return { valid: false, error: 'จำนวนประตูต้องมากกว่า 0' };
  }

  return { valid: true, value: Math.floor(num) };
}

export function validateCardCount(count: any): { valid: boolean; value?: number; error?: string } {
  if (count === null || count === undefined || count === '') {
    return { valid: true, value: 1 };
  }

  const num = Number(count);
  if (isNaN(num)) {
    return { valid: false, error: 'จำนวนบัตรต้องเป็นตัวเลข' };
  }

  if (num < 1) {
    return { valid: false, error: 'จำนวนบัตรต้องมากกว่า 0' };
  }

  return { valid: true, value: Math.floor(num) };
}

export function validateShirtNo(shirtNo: any): { valid: boolean; value?: number; error?: string } {
  if (shirtNo === null || shirtNo === undefined || shirtNo === '') {
    return { valid: false, error: 'เบอร์เสื้อจำเป็น' };
  }

  const num = Number(shirtNo);
  if (isNaN(num)) {
    return { valid: false, error: 'เบอร์เสื้อต้องเป็นตัวเลข' };
  }

  if (num < 1 || num > 99) {
    return { valid: false, error: 'เบอร์เสื้อต้องอยู่ระหว่าง 1-99' };
  }

  return { valid: true, value: Math.floor(num) };
}

export function validateDate(dateStr: any): { valid: boolean; value?: string; error?: string } {
  if (!dateStr) {
    return { valid: false, error: 'วันที่จำเป็น' };
  }

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return { valid: false, error: 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)' };
  }

  const isoDate = date.toISOString().split('T')[0];
  return { valid: true, value: isoDate };
}

// Cell value helpers

export function getCellValue(cell: any): any {
  if (!cell) return null;
  if (typeof cell === 'string' || typeof cell === 'number') return cell;
  if (cell.value !== undefined) return cell.value;
  return null;
}

export function trimString(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

export function normalizeTeamName(name: string, shortName: string | null): string {
  // Prefer full name if available, fallback to short name
  const trimmedName = trimString(name);
  if (trimmedName) return trimmedName;

  const trimmedShort = trimString(shortName);
  return trimmedShort || '—';
}

// Result builder

export function createValidResult(
  sheet: string,
  rowNumber: number,
  action: BulkImportRowResult['action'],
  resolved: Record<string, any> = {},
  raw: Record<string, any> = {}
): BulkImportRowResult {
  return {
    sheet,
    rowNumber,
    status: 'valid',
    action,
    message: 'ตรวจสอบสำเร็จ',
    resolved,
    raw,
  };
}

export function createWarningResult(
  sheet: string,
  rowNumber: number,
  action: BulkImportRowResult['action'],
  message: string,
  resolved: Record<string, any> = {},
  raw: Record<string, any> = {}
): BulkImportRowResult {
  return {
    sheet,
    rowNumber,
    status: 'warning',
    action,
    message,
    resolved,
    raw,
  };
}

export function createErrorResult(
  sheet: string,
  rowNumber: number,
  action: BulkImportRowResult['action'],
  message: string,
  raw: Record<string, any> = {}
): BulkImportRowResult {
  return {
    sheet,
    rowNumber,
    status: 'error',
    action,
    message,
    raw,
  };
}

// Batch logging helpers

export function generateImportBatchNo(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `IMP-${y}${m}${d}-${hh}${mm}${ss}-${rand}`;
}
