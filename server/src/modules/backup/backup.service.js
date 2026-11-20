'use strict';
/**
 * 每日冷备份到 GitHub（仅备份，不参与业务读写）
 *
 * 主存储仍是腾讯云 EdgeOne Blob（SQLite 整库快照）；本模块读取快照字节，
 * gzip 后 PUT 到私有 GitHub 仓库 Yellowsoy/bj-data 的 data/backup.json.gz。
 *
 * 安全：token 只从环境变量 GH_BACKUP_TOKEN 读；触发需 BACKUP_SECRET。
 */
const zlib = require('node:zlib');
const db = require('./index');

const GH_REPO = process.env.GH_BACKUP_REPO || 'Yellowsoy/bj-data';
const GH_BRANCH = 'main';

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'edgeone-daily-backup',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

/**
 * 生成并推送备份。返回 {ok, ...} 或抛错。
 * payload 结构：{ kind:'sqlite-snapshot', version, snapshotBase64, meta }
 */
async function runBackup() {
  const token = String(process.env.GH_BACKUP_TOKEN || '');
  if (!token) throw new Error('GH_BACKUP_TOKEN 未配置');

  // 先把未落盘变更写入 Blob，确保备份是最新数据
  try { await db.persistIfDirty(); } catch (_) { /* 忽略 */ }

  const bytes = db.exportSnapshot();            // Uint8Array（SQLite 整库）
  if (!bytes || bytes.length === 0) throw new Error('快照为空，放弃备份以免覆盖历史');
  const version = db.currentVersion();
  const payload = {
    kind: 'sqlite-snapshot',
    version,
    snapshotBase64: Buffer.from(bytes).toString('base64'),
    backedUpAt: new Date().toISOString(),
  };
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  const content = zlib.gzipSync(raw, { level: 6 }).toString('base64');

  const api = `https://api.github.com/repos/${GH_REPO}/contents/data/backup.json.gz`;
  const h = headers(token);
  let sha;
  const cur = await fetch(api, { headers: h });
  if (cur.ok) {
    try { sha = (await cur.json()).sha; } catch (_) {}
  } else if (cur.status !== 404) {
    throw new Error(`GitHub GET backup ${cur.status}`);
  }
  const body = {
    message: `daily backup ${new Date().toISOString()} (v${version})`,
    content,
    branch: GH_BRANCH,
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(api, { method: 'PUT', headers: h, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub PUT backup ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  return { ok: true, repo: GH_REPO, version, rawBytes: raw.length, sha: j.content && j.content.sha };
}

module.exports = { runBackup, GH_REPO };
