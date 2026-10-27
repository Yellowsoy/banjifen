'use strict';
/**
 * 全局平台设置（键值对）。
 * 目前用于存放跨班级的开关，例如「成绩自助查询总开关 public_query_enabled」。
 * 读取带默认值，避免未初始化时抛错；写入兼容「存在则更新、不存在则插入」。
 */
const db = require('../db');

/** 读取设置原值（字符串），不存在返回 default */
function get(key, defaultValue = null) {
  const row = db.get('SELECT value FROM platform_settings WHERE key = ?', [key]);
  return row ? row.value : defaultValue;
}

/** 读取布尔设置：'1' / 'true' / 'yes' / 'on' 视为真，未设置返回 defaultVal */
function getBool(key, defaultVal = false) {
  const v = get(key, null);
  if (v === null || v === '') return defaultVal;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/** 写入设置，不存在则插入、存在则更新，返回写入后的字符串值 */
function set(key, value, by = '') {
  const str = String(value);
  const now = Date.now();
  const exists = db.get('SELECT key FROM platform_settings WHERE key = ?', [key]);
  if (exists) {
    db.run('UPDATE platform_settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = ?', [
      str,
      now,
      by || '',
      key,
    ]);
  } else {
    db.run('INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      key,
      str,
      now,
      by || '',
    ]);
  }
  return get(key);
}

module.exports = { get, getBool, set };
