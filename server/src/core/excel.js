'use strict';
/** Excel 读写工具：统一表头映射与容错，避免各模块重复实现 */

/**
 * xlsx（SheetJS）包体约 7MB，require 本身耗时 ~60ms。
 * 云函数冷启动时并不需要 Excel 能力（只有导入/导出成绩、导入名单才会用到），
 * 因此改为首次使用时才 require，避免拖慢冷启动与首请求。
 */
let XLSX = null;
function xlsx() {
  if (!XLSX) XLSX = require('xlsx');
  return XLSX;
}

function readSheet(buffer) {
  const X = xlsx();
  // codepage 65001：CSV 按 UTF-8 解析，避免中文表头（姓名/成绩）被当作 Latin-1 而匹配不到列
  const wb = X.read(buffer, { type: 'buffer', cellDates: false, codepage: 65001 });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const rows = X.utils.sheet_to_json(wb.Sheets[first], { defval: '', raw: false });
  return rows;
}

function buildBuffer(sheets) {
  const X = xlsx();
  const wb = X.utils.book_new();
  for (const { name, rows, cols } of sheets) {
    const ws = X.utils.json_to_sheet(rows);
    if (cols) ws['!cols'] = cols.map((w) => ({ wch: w }));
    X.utils.book_append_sheet(wb, ws, name.slice(0, 30));
  }
  return X.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** 从一行对象里按候选表头名取值（忽略空格与大小写） */
function pick(row, candidates, fallback = '') {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const hit = keys.find((k) => String(k).replace(/\s/g, '').toLowerCase() === candidate.toLowerCase());
    if (hit !== undefined && row[hit] !== '' && row[hit] !== null && row[hit] !== undefined) return row[hit];
  }
  return fallback;
}

function toNumber(value, fallback = NaN) {
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

/** CSV 生成：带 BOM，Excel 打开不乱码 */
function toCsv(headers, rows) {
  const escapeCell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  return '\uFEFF' + lines.join('\r\n');
}

module.exports = { readSheet, buildBuffer, pick, toNumber, toCsv };
