'use strict';
/**
 * 数据访问层：
 * - 使用 sql.js（SQLite 的 WebAssembly 版本）内嵌数据库，免安装原生依赖
 * - 启动时加载数据并执行可回滚的迁移（schema_migrations 表记录已执行版本）
 * - 写操作统一走 transaction()
 * - 持久化驱动二选一（由环境变量 EO_PERSIST 决定）：
 *     fs   （默认）：SQLite 字节原子落盘到 DB_FILE，适用于自有服务器 / 本地
 *     blob ：整库快照写入 EdgeOne Pages Blob 存储（强一致读），适用于 EdgeOne 云函数
 * - 对外只暴露参数化查询 API，杜绝 SQL 注入
 */
const fs = require('node:fs');
const path = require('node:path');
const { config } = require('../config');
const { logger } = require('../core/logger');
const MIGRATIONS = require('./migrations.generated');

const BLOB_MODE = process.env.EO_PERSIST === 'blob';
const BLOB_SNAPSHOT_KEY = 'bj/db/snapshot';
const BLOB_META_KEY = 'bj/db/meta';
const DB_FILE = config.dbFile;

let db = null;
let flushTimer = null;
let txDepth = 0;
let closed = false;
let dirty = false;
let snapshotVersion = 0; // 本地快照版本号（blob 模式下与远端 meta.v 对齐）
let loadedFromRemote = false;

const log = logger.child({ scope: 'db' });

/* ---------------- Blob 驱动（仅 EdgeOne） ---------------- */

let blobStore = null;
function getBlobStore() {
  if (!blobStore) {
    // @edgeone/pages-blob 在 Pages 云函数内自动鉴权；strong 保证读己之写
    const mod = require('@edgeone/pages-blob');
    const getStore = mod.getStore || (mod.default && mod.default.getStore);
    blobStore = getStore({ name: 'banjifen', consistency: 'strong' });
  }
  return blobStore;
}

/**
 * 读取远端整库快照。
 * 性能：meta 与 snapshot 两个 Blob 读并行发起（原本串行，冷启动多一次 RTT）。
 * 一致性：仍用 strong 读，保证读到的是同一版本的快照。
 */
async function blobReadSnapshot() {
  const store = getBlobStore();
  const [meta, buf] = await Promise.all([
    store.get(BLOB_META_KEY, { type: 'json', consistency: 'strong' }),
    store.get(BLOB_SNAPSHOT_KEY, { type: 'arrayBuffer', consistency: 'strong' }),
  ]);
  if (!meta || !meta.v) return null;
  if (!buf) return null;
  return { version: meta.v, bytes: new Uint8Array(buf) };
}

async function blobWriteSnapshot(bytes) {
  const store = getBlobStore();
  const v = snapshotVersion + 1;
  await store.set(BLOB_SNAPSHOT_KEY, Buffer.from(bytes));
  await store.setJSON(BLOB_META_KEY, { v, at: Date.now() });
  snapshotVersion = v;
}

/* ---------------- 查询 API ---------------- */

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

function markDirty() {
  if (!db || closed) return;
  dirty = true;
  if (BLOB_MODE) return; // blob 模式由 edge-entry 在响应结束后统一持久化
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 60);
  if (flushTimer.unref) flushTimer.unref();
}

/** 立即落盘（fs 模式：原子写；blob 模式：写入远端快照） */
function flush() {
  if (!db || closed || !dirty) return;
  const data = Buffer.from(db.export());
  if (BLOB_MODE) {
    // 云函数环境中不能阻塞响应，交由 persistIfDirty() 异步处理
    blobWriteSnapshot(data).then(
      () => {
        dirty = false;
      },
      (err) => log.error('blob 持久化失败', { err: err.message })
    );
    return;
  }
  const tmp = `${DB_FILE}.tmp`;
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, DB_FILE);
  dirty = false;
}

/* ---------------- 快照与多实例同步（blob 模式） ---------------- */

function exportSnapshot() {
  return Buffer.from(db.export());
}

function loadSnapshot(bytes, version = 0) {
  const SQL = sqlFactory;
  if (db) db.close();
  db = new SQL.Database(new Uint8Array(bytes));
  db.run('PRAGMA foreign_keys = ON');
  snapshotVersion = version;
  dirty = false;
  loadedFromRemote = true;
}

function isDirty() {
  return dirty;
}

function markClean(version) {
  dirty = false;
  if (typeof version === 'number') snapshotVersion = version;
}

function currentVersion() {
  return snapshotVersion;
}

/**
 * 云函数多实例：请求开始前检查远端是否有更新版本（edge-entry 调用）。
 * 性能：远端 meta 读是网络往返，这里做「短 TTL 缓存」——
 * 2 秒内的重复检查直接复用上次结果，避免每个请求都打一次 Blob。
 */
const FRESH_CHECK_TTL_MS = 2000;
let lastFreshCheckAt = 0;
let lastFreshMeta = null;

async function refreshIfRemoteNewer(force = false) {
  if (!BLOB_MODE || !db || closed) return;
  const now = Date.now();
  if (!force && now - lastFreshCheckAt < FRESH_CHECK_TTL_MS) return;
  lastFreshCheckAt = now;
  const store = getBlobStore();
  const meta = await store.get(BLOB_META_KEY, { type: 'json', consistency: 'strong' });
  lastFreshMeta = meta;
  if (meta && typeof meta.v === 'number' && meta.v !== snapshotVersion) {
    const buf = await store.get(BLOB_SNAPSHOT_KEY, { type: 'arrayBuffer', consistency: 'strong' });
    if (buf) loadSnapshot(new Uint8Array(buf), meta.v);
  }
}

/** 云函数：把未落盘变更写入远端（串行化，避免并发覆盖） */
let persistChain = Promise.resolve();
function persistIfDirty() {
  if (!BLOB_MODE || !db || closed || !dirty) return Promise.resolve();
  const task = persistChain.then(async () => {
    if (!dirty) return;
    await blobWriteSnapshot(exportSnapshot());
    dirty = false;
    loadedFromRemote = true;
  });
  persistChain = task.catch((err) => log.error('blob 持久化失败', { err: err.message }));
  return task;
}

/* ---------------- 迁移与结构 ---------------- */

function ensureMigrationTable() {
  db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
}

function applyMigrations() {
  ensureMigrationTable();
  const applied = new Set(all('SELECT name FROM schema_migrations').map((r) => r.name));
  for (const file of Object.keys(MIGRATIONS).sort()) {
    if (applied.has(file)) continue;
    transaction(() => {
      db.run(MIGRATIONS[file]);
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

/* ---------------- 初始化 ---------------- */

let sqlFactory = null;

async function init() {
  // wasm 二进制由构建脚本内联（见 scripts/gen-inline.js），云函数环境无 node_modules 文件可读
  let wasmBinary = null;
  try {
    wasmBinary = Buffer.from(require('./sql-wasm.b64.js').data, 'base64');
  } catch {
    wasmBinary = null;
  }
  // loader 同样内联进仓库（46KB），生产环境无需安装 sql.js 整个包（~30MB）
  let initSqlJs;
  try {
    initSqlJs = require('./sql-wasm-loader');
  } catch {
    initSqlJs = require('sql.js');
  }
  const SQL = await initSqlJs(wasmBinary ? { wasmBinary } : {});
  sqlFactory = SQL;

  if (BLOB_MODE) {
    const snap = await blobReadSnapshot();
    db = snap ? new SQL.Database(snap.bytes) : new SQL.Database();
    snapshotVersion = snap ? snap.version : 0;
    loadedFromRemote = Boolean(snap);
  } else {
    const exists = fs.existsSync(DB_FILE);
    db = exists ? new SQL.Database(new Uint8Array(fs.readFileSync(DB_FILE))) : new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  applyMigrations();
  assertSchema();
  if (!BLOB_MODE) flush();
  log.info('数据库就绪', {
    mode: BLOB_MODE ? 'blob' : 'fs',
    file: BLOB_MODE ? '(EdgeOne Blob)' : DB_FILE,
    fresh: !loadedFromRemote,
  });
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

/** 是否已从远端加载过数据（用于判断是否需要写入种子） */
function hasStoredData() {
  return loadedFromRemote;
}

/** 计数查询小工具 */
function count(sql, params = []) {
  const row = get(sql, params);
  if (!row) return 0;
  const key = Object.keys(row)[0];
  return Number(row[key] || 0);
}

module.exports = {
  init,
  all,
  get,
  run,
  exec,
  transaction,
  flush,
  close,
  count,
  get dbFile() {
    return DB_FILE;
  },
  // EdgeOne 多实例支持
  exportSnapshot,
  loadSnapshot,
  isDirty,
  markClean,
  currentVersion,
  refreshIfRemoteNewer,
  persistIfDirty,
  hasStoredData,
  blobWriteSnapshot,
};
