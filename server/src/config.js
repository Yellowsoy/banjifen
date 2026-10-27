'use strict';
/**
 * 集中配置：全部来自环境变量，启动时一次性校验，校验失败立即退出（fail fast）。
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const ROOT = path.resolve(__dirname, '../..');

function required(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`[config] 缺少必需的环境变量 ${name}，请参考 .env.example 配置`);
  }
  return raw;
}

function toInt(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`[config] 环境变量 ${name} 必须是 ${min}~${max} 之间的整数，当前值：${raw}`);
  }
  return n;
}

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

const nodeEnv = required('NODE_ENV', 'development');
// EO_PERSIST=blob 表示运行在 EdgeOne 云函数：数据持久化走 Blob 存储，不落本地盘
const edgeMode = process.env.EO_PERSIST === 'blob';

// 云函数模式下先用占位密钥启动，edge-entry 引导时从 Blob 读取/生成正式密钥并覆盖
let jwtSecret = required(
  'JWT_SECRET',
  edgeMode ? 'edge-bootstrap-placeholder-secret-will-replace-32' : nodeEnv === 'production' ? undefined : 'dev-only-insecure-secret-change-me-32chars'
);
if (jwtSecret.length < 32) {
  throw new Error('[config] JWT_SECRET 长度必须 >= 32 个字符');
}

const config = {
  root: ROOT,
  env: nodeEnv,
  isProd: nodeEnv === 'production',
  port: toInt('PORT', 3000, 1, 65535),
  jwtSecret,
  accessTokenTtl: toInt('ACCESS_TOKEN_TTL', 1800, 60, 86400),
  refreshTokenTtl: toInt('REFRESH_TOKEN_TTL', 1209600, 3600, 60 * 60 * 24 * 90),
  // 登录接口防爆破限流（每 IP 5 分钟上限，可配置；测试环境调高避免单 IP 批量登录触发）
  authLoginRateMax: toInt('AUTH_LOGIN_RATE_MAX', 30, 1, 100000),
  corsOrigin: (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
  dbFile: resolvePath(required('DB_FILE', 'data/banjifen.sqlite')),
  uploadDir: resolvePath(required('UPLOAD_DIR', 'data/uploads')),
  publicDir: path.join(ROOT, 'public'),
  seed: {
    superUsername: process.env.SUPER_USERNAME || 'admin',
    superPassword: process.env.SUPER_PASSWORD || 'admin123456',
    teacherUsername: process.env.DEMO_OWNER_USERNAME || '123456',
    teacherPassword: process.env.DEMO_OWNER_PASSWORD || '123456',
  },
  version: '1.0.0',
};

for (const dir of [path.dirname(config.dbFile), config.uploadDir]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    if (!edgeMode) throw err; // 只读文件系统（云函数）下忽略
  }
}

if (edgeMode) config.edge = true;

/** 生成随机 ID（带前缀），与原系统 id 风格一致 */
function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

module.exports = { config, genId };
