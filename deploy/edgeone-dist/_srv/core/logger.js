'use strict';
/**
 * 结构化 JSON 日志：每行一条 JSON，携带 requestId 便于串联一次请求的全链路。
 * 敏感字段（password / token / cookie 等）统一脱敏，绝不落盘。
 */
const SENSITIVE = /(password|pwd|token|secret|cookie|authorization)/i;

function redact(value, depth = 0) {
  if (value == null || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}...`;
  return value;
}

function write(level, msg, fields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...redact(fields),
  });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

const logger = {
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
  debug: (msg, fields) => {
    if (process.env.NODE_ENV !== 'production') write('debug', msg, fields);
  },
  child(bindings) {
    return {
      info: (msg, fields = {}) => write('info', msg, { ...bindings, ...fields }),
      warn: (msg, fields = {}) => write('warn', msg, { ...bindings, ...fields }),
      error: (msg, fields = {}) => write('error', msg, { ...bindings, ...fields }),
      debug: (msg, fields = {}) => {
        if (process.env.NODE_ENV !== 'production') write('debug', msg, { ...bindings, ...fields });
      },
    };
  },
};

module.exports = { logger };
