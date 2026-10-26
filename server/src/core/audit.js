'use strict';
/**
 * 操作审计：把「谁 / 哪个班 / 对谁 / 做了什么 / 改成了什么」完整落盘到 operation_logs。
 *
 * 设计要点：
 * 1. 统一入口 record()，避免在业务代码里散落 INSERT；
 * 2. 支持 before / after 快照，超管可以还原每一步的具体改动；
 * 3. 日志写入失败绝不阻断主流程（catch 后仅记录）；
 * 4. 敏感字段（密码、令牌）自动脱敏，日志本身不存储明文口令。
 */
const crypto = require('node:crypto');
const db = require('../db');

const SENSITIVE_KEYS = [
  'password', 'pwd', 'pwdHash', 'newPassword', 'oldPassword', 'confirmPassword',
  'token', 'tokenHash', 'accessToken', 'refreshToken', 'authorization',
];

function redact(input, depth = 0) {
  if (depth > 4 || input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.slice(0, 200).map((v) => redact(v, depth + 1));
  if (typeof input === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      const lower = key.toLowerCase();
      out[key] = SENSITIVE_KEYS.some((k) => lower.includes(k.toLowerCase())) ? '***' : redact(value, depth + 1);
    }
    return out;
  }
  if (typeof input === 'string' && input.length > 2000) return `${input.slice(0, 2000)}…(已截断)`;
  return input;
}

function stringify(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(redact(value));
  } catch {
    return String(value);
  }
}

function clientIp(req) {
  if (!req) return '';
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return (req.ip || (req.socket && req.socket.remoteAddress) || '').replace('::ffff:', '');
}

/**
 * 记录一条操作日志
 * @param {object} payload
 * @param {object} [payload.req]        当前请求对象（用于提取操作者、IP、UA）
 * @param {string} payload.module       业务模块
 * @param {string} payload.action       动作名（推荐 资源.动词，如 student.create）
 * @param {string} [payload.targetType] 目标类型
 * @param {string} [payload.targetId]
 * @param {string} [payload.targetName]
 * @param {string} [payload.summary]    一句话摘要
 * @param {string} [payload.amount]     关联数量描述
 * @param {object|string} [payload.detail]   明细：请求参数、受影响对象清单等
 * @param {object} [payload.before]     变更前快照
 * @param {object} [payload.after]      变更后快照
 * @param {'success'|'failed'} [payload.result]
 * @param {number} [payload.statusCode]
 * @param {object} [payload.actor]      手动指定操作者 { id, name, role, classId }
 */
function record(payload) {
  try {
    const req = payload.req || null;
    const auth = (req && req.auth) || {};
    const actor = payload.actor || {};
    // req.auth = { accountId, name, role, classId }；actor = { id, name, role, classId }，两种形态都要认
    const authLike = auth.accountId || auth.id ? auth : actor.account || {};
    const actorId = actor.id || auth.accountId || authLike.accountId || authLike.id || '';
    const actorName = actor.name || auth.name || authLike.name || '';
    const actorRole = actor.role || auth.role || authLike.role || '';
    const classId = String(actor.classId || auth.classId || authLike.classId || (req && req.query && req.query.classId) || '');
    let className = actor.className || auth.className || '';
    if (classId && !className) {
      try {
        const row = db.get('SELECT name FROM classes WHERE id = ?', [classId]);
        className = row ? row.name : '';
      } catch {
        className = '';
      }
    }

    const before = stringify(payload.before);
    const after = stringify(payload.after);
    const detail = stringify(payload.detail);
    const id = crypto.randomUUID();

    db.run(
      `INSERT INTO operation_logs
        (id, created_at, actor_id, actor_name, actor_role, class_id, class_name,
         module, action, target_type, target_id, target_name, summary, amount,
         result, status_code, detail, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        Date.now(),
        actorId,
        actorName,
        actorRole,
        classId,
        className,
        payload.module || 'system',
        payload.action || 'unknown',
        payload.targetType || '',
        String(payload.targetId || ''),
        payload.targetName || '',
        payload.summary || '',
        payload.amount || '',
        payload.result || 'success',
        Number(payload.statusCode || 0),
        [detail, before ? `BEFORE:${before}` : '', after ? `AFTER:${after}` : ''].filter(Boolean).join('\n'),
        clientIp(req),
        (req && req.headers && req.headers['user-agent'] ? String(req.headers['user-agent']) : '').slice(0, 300),
      ]
    );
    return id;
  } catch (err) {
    // 审计失败不能影响业务
    try {
      console.error('[audit] 写入失败', err.message);
    } catch { /* noop */ }
    return null;
  }
}

/** 取出某实体当前快照（用于 before / after 对比） */
function snapshotRow(table, id) {
  try {
    return db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]) || null;
  } catch {
    return null;
  }
}

/** 精简 diff：只输出真正变化的字段，避免日志过长 */
function diffObject(before, after) {
  if (!before || !after) return null;
  const changes = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  keys.forEach((key) => {
    const b = before[key];
    const a = after[key];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changes[key] = { from: SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k)) ? '***' : b, to: a };
    }
  });
  return Object.keys(changes).length ? changes : null;
}

function list({ from, to, classId, actorId, module, action, actorRole, result, keyword, page = 1, pageSize = 30 } = {}) {
  const where = [];
  const params = [];
  if (from) {
    where.push('created_at >= ?');
    params.push(Number(from));
  }
  if (to) {
    where.push('created_at <= ?');
    params.push(Number(to));
  }
  if (result === 'success' || result === 'failed') {
    where.push('result = ?');
    params.push(result);
  }
  if (classId) {
    where.push('class_id = ?');
    params.push(classId);
  }
  if (actorId) {
    where.push('actor_id = ?');
    params.push(actorId);
  }
  if (module) {
    where.push('module = ?');
    params.push(module);
  }
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  if (actorRole) {
    where.push('actor_role = ?');
    params.push(actorRole);
  }
  if (keyword) {
    where.push('(summary LIKE ? OR target_name LIKE ? OR actor_name LIKE ? OR detail LIKE ? OR action LIKE ?)');
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw, kw, kw);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pageNo = Math.max(1, Number(page) || 1);
  const size = Math.min(200, Math.max(1, Number(pageSize) || 30));
  const total = db.count(`SELECT COUNT(*) AS c FROM operation_logs ${clause}`, params);
  const items = db.all(
    `SELECT * FROM operation_logs ${clause} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
    [...params, size, (pageNo - 1) * size]
  );
  return { items, total, page: pageNo, pageSize: size };
}

function clearBefore(ts) {
  return db.run('DELETE FROM operation_logs WHERE created_at < ?', [Number(ts)]).changes;
}

module.exports = { record, snapshotRow, diffObject, list, clearBefore, redact };
