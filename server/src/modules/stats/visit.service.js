'use strict';
/**
 * 站点访问统计（自建）
 *
 * 与 51.LA 埋点并存：51.LA 负责后台报表，这里负责在超管后台直接展示真实数字。
 * 隐私与安全约定：
 *   - 只存 visitor_hash（IP + UA + 当日盐 的 sha256），不落原始 IP；
 *   - 路径只保留一级页面名，丢弃查询串（家长查询口令在 URL 中，绝不入库）；
 *   - 只记录页面请求（GET + HTML 文档），不记录接口、静态资源与爬虫；
 *   - 写库失败静默忽略，绝不影响正常请求。
 */
const crypto = require('node:crypto');
const db = require('../../db');
const { config } = require('../../config');

const DAY_MS = 24 * 60 * 60 * 1000;
/** 指纹盐的固定分量：取服务端密钥，保证「改管理员密码」不会让历史指纹漂移 */
const JWT_SECRET = config.jwtSecret;

/** 服务器本地时区的 YYYY-MM-DD */
function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 当日盐：每天更换，避免跨天指纹可关联；盐值随 JWT_SECRET 固定，不随管理员改密而漂移 */
function daySalt(day) {
  return crypto.createHash('sha256').update(`${day}|${JWT_SECRET}|banjifen-visit`).digest('hex');
}

/** 匿名访客指纹：当天内同一 (IP+UA) 视为同一访客 */
function visitorHash(ip, ua, day) {
  return crypto.createHash('sha256').update(`${daySalt(day)}|${ip}|${ua}`).digest('hex').slice(0, 32);
}

/** 常见爬虫判定（这些请求不计入访问量） */
const BOT_RE = /bot|crawler|spider|slurp|bingpreview|headless|curl|wget|python-requests|node-fetch|go-http-client/i;

/**
 * 归一化路径：只保留一级 HTML 页面名
 *   /                        -> /index.html
 *   /index.html?x=1          -> /index.html
 *   /query.html?token=abcdef -> /query.html   （丢弃 token）
 * 非 HTML 请求返回 null，表示不计入
 */
function normalizePath(rawUrl) {
  let pathname = String(rawUrl || '/').split('?')[0].split('#')[0];
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (!/\.html?$/i.test(pathname)) return null; // 静态资源 / 接口一律不记
  return pathname.slice(0, 120);
}

/** 记录一次页面访问（幂等：同一访客同日只新增一行，hits 自增） */
function record(req) {
  try {
    if (req.method !== 'GET') return;
    const ua = req.get('user-agent') || '';
    if (!ua || BOT_RE.test(ua)) return; // 无 UA 或爬虫不计
    // 只统计浏览器发起的「文档」请求，排除前端 fetch 的接口调用
    const dest = req.get('sec-fetch-dest');
    if (dest && dest !== 'document') return;

    const path = normalizePath(req.originalUrl || req.url);
    if (!path) return;

    const day = dayKey();
    const ip = req.ip || req.socket?.remoteAddress || '';
    const vh = visitorHash(ip, ua, day);
    const now = Date.now();

    db.run(
      `INSERT INTO visit_daily (day, visitor_hash, first_at, last_at, hits)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(day, visitor_hash) DO UPDATE SET last_at = excluded.last_at, hits = hits + 1`,
      [day, vh, now, now]
    );
    db.run(
      `INSERT INTO visit_page (day, path, pv) VALUES (?, ?, 1)
       ON CONFLICT(day, path) DO UPDATE SET pv = pv + 1`,
      [day, path]
    );
  } catch {
    /* 统计失败绝不影响业务请求 */
  }
}

/** 汇总给超管后台展示的数据 */
function summary() {
  const now = Date.now();
  const today = dayKey(now);
  const yesterday = dayKey(now - DAY_MS);

  const pvTotal = db.count('SELECT COALESCE(SUM(hits), 0) FROM visit_daily');
  const uvTotal = db.count('SELECT COUNT(*) FROM visit_daily');
  const pvToday = db.count('SELECT COALESCE(SUM(hits), 0) FROM visit_daily WHERE day = ?', [today]);
  const uvToday = db.count('SELECT COUNT(*) FROM visit_daily WHERE day = ?', [today]);
  const uvYesterday = db.count('SELECT COUNT(*) FROM visit_daily WHERE day = ?', [yesterday]);
  // 近 5 分钟内有访问记录的访客数，作为「在线」近似值
  const online = db.count('SELECT COUNT(*) FROM visit_daily WHERE day = ? AND last_at >= ?', [today, now - 5 * 60 * 1000]);

  const topPages = db.all(
    `SELECT path, SUM(pv) AS pv FROM visit_page GROUP BY path ORDER BY pv DESC LIMIT 5`
  );

  // 近 7 天趋势（含今天），缺失的日期补 0
  const trend = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = dayKey(now - i * DAY_MS);
    trend.push({
      day: d,
      label: d.slice(5),
      uv: db.count('SELECT COUNT(*) FROM visit_daily WHERE day = ?', [d]),
      pv: db.count('SELECT COALESCE(SUM(hits), 0) FROM visit_daily WHERE day = ?', [d]),
    });
  }

  const growth = uvYesterday > 0 ? Math.round(((uvToday - uvYesterday) / uvYesterday) * 100) : null;

  return {
    pvTotal, uvTotal, pvToday, uvToday, uvYesterday, online, growth,
    topPages: topPages.map((p) => ({ path: p.path, pv: Number(p.pv) })),
    trend,
    updatedAt: now,
  };
}

module.exports = { record, summary, normalizePath, dayKey };
