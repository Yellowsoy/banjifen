'use strict';
/**
 * 数据访问层：
 * - 使用 sql.js（SQLite 的 WebAssembly 版本）内嵌数据库，免安装原生依赖，Windows/macOS/Linux 通用
 * - 启动时加载数据文件并执行可回滚的迁移（schema_migrations 表记录已执行版本）
 * - 写操作统一走 transaction()，提交后以「临时文件 + rename」方式原子落盘
 * - 对外只暴露参数化查询 API，杜绝 SQL 注入
 */
const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');
const { config } = require('../config');
const { logger } = require('../core/logger');

const MIGRATION_DIR = path.join(__dirname, 'migrations');
const DB_FILE = config.dbFile;

let db = null;
let flushTimer = null;
let txDepth = 0;
let closed = false;

const log = logger.child({ scope: 'db' });

function markDirty() {
  if (!db || closed) return;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 60);
  if (flushTimer.unref) flushTimer.unref();
}

/** 立即落盘（原子写） */
function flush() {
  if (!db || closed) return;
  const tmp = `${DB_FILE}.tmp`;
  const data = Buffer.from(db.export());
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, DB_FILE);
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    if (params && (Array.isArray(params) ? params.length : Object.keys(params).length)) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    if (params && (Array.isArray(params) ? params.length : Object.keys(params).length)) stmt.bind(params);
    stmt.step();
  } finally {
    stmt.free();
  }
  const changes = db.getRowsModified();
  markDirty();
  return { changes };
}

function exec(sql) {
  db.run(sql);
  markDirty();
}

/** 事务：嵌套调用时复用外层事务，避免隐式提交 */
function transaction(fn) {
  if (txDepth > 0) return fn();
  db.run('BEGIN IMMEDIATE');
  txDepth += 1;
  try {
    const result = fn();
    db.run('COMMIT');
    txDepth -= 1;
    markDirty();
    return result;
  } catch (err) {
    try {
      db.run('ROLLBACK');
    } catch (rollbackErr) {
      log.error('rollback failed', { err: rollbackErr.message });
    }
    txDepth -= 1;
    throw err;
  }
}

function ensureMigrationTable() {
  db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
}

function applyMigrations() {
  ensureMigrationTable();
  const files = fs
    .readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied = new Set(all('SELECT name FROM schema_migrations').map((r) => r.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATION_DIR, file), 'utf8');
    transaction(() => {
      db.run(sql);
      run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [file, Date.now()]);
    });
    log.info('迁移已执行', { migration: file });
  }
}

/** 结构自检：拦截 v1（推广员/会员）旧数据文件，避免以错误结构运行 */
function assertSchema() {
  const columns = all('PRAGMA table_info(accounts)').map((row) => row.name);
  if (!columns.includes('class_id') || !columns.includes('role')) {
    throw new Error(
      `检测到旧版数据文件（v1），本版本的角色与班级结构不兼容。\n请删除 ${DB_FILE} 后重新启动；如已有真实数据，请先通过旧版导出 CSV 备份。`
    );
  }
}

async function init() {
  const SQL = await initSqlJs();
  const exists = fs.existsSync(DB_FILE);
  db = exists ? new SQL.Database(new Uint8Array(fs.readFileSync(DB_FILE))) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  applyMigrations();
  assertSchema();
  flush();
  log.info('数据库就绪', { file: DB_FILE, existed: exists });
  return module.exports;
}

function close() {
  if (!db) return;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flush();
  closed = true;
  db.close();
  db = null;
}

/** 计数查询小工具 */
function count(sql, params = []) {
  const row = get(sql, params);
  if (!row) return 0;
  const key = Object.keys(row)[0];
  return Number(row[key] || 0);
}

module.exports = { init, all, get, run, exec, transaction, flush, close, count, get dbFile() { return DB_FILE; } };
