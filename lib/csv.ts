/**
 * CSV / Excel helpers for the Backup Center.
 * UTF-8 BOM is prepended so Thai text opens correctly in Excel.
 */

export type CsvValue = string | number | boolean | null | undefined;
export type CsvRow = Record<string, CsvValue>;

/** Escape a single cell: keep 0 as "0", null/undefined as empty. */
function cell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build a CSV string from explicit columns and rows.
 * `columns` = [{ key, header }] preserving order.
 */
export function buildCsv(
  columns: Array<{ key: string; header: string }>,
  rows: CsvRow[]
): string {
  const head = columns.map((c) => cell(c.header)).join(',');
  const body = rows
    .map((row) => columns.map((c) => cell(row[c.key])).join(','))
    .join('\r\n');
  const csv = body ? `${head}\r\n${body}` : head;
  return '﻿' + csv; // UTF-8 BOM
}

export function csvFilename(parts: Array<string | number | null | undefined>): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const base = parts.filter(Boolean).join('_').replace(/[^\w\-]+/g, '-');
  return `${base}_${stamp}.csv`;
}
