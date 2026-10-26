'use strict';
/**
 * 审计中间件：在响应结束后统一落一条 operation_logs。
 *
 * 用法（挂在具体路由上，紧跟鉴权中间件之后）：
 *   router.patch('/students/:id', ..., trail({
 *     module: 'class', action: 'student.update',
 *     entity: { param: 'id', table: 'students', nameField: 'name' },
 *   }), handler)
 *
 * - entity：给出目标实体时会自动做 before / after 快照并计算字段级 diff
 * - summary/amount/targetName：支持传函数，按请求动态生成（可拿到 before/after/diff）
 * - 只记录写操作的结果；GET 不挂（避免刷爆日志）
 */
const { record, snapshotRow, diffObject } = require('../core/audit');

const resolve = (value, ...args) => (typeof value === 'function' ? value(...args) : value);

function trimBody(body) {
  if (!body || typeof body !== 'object') return undefined;
  const clone = { ...body };
  delete clone.file;
  return clone;
}

/**
 * @param {object} options
 * @param {string} options.module
 * @param {string|Function} options.action
 * @param {string} [options.targetType]
 * @param {string|Function} [options.targetName]
 * @param {string|Function} [options.summary]
 * @param {string|Function} [options.amount]
 * @param {{param:string, table:string, nameField?:string}} [options.entity]
 */
function trail(options) {
  return function auditMiddleware(req, res, next) {
    const entity = options.entity || null;
    const entityId = entity ? req.params[entity.param] : '';
    const before = entity && entityId ? snapshotRow(entity.table, entityId) : null;
    let finished = false;

    const write = () => {
      if (finished) return;
      finished = true;
      try {
        const statusCode = res.statusCode || 0;
        const ok = statusCode >= 200 && statusCode < 400;
        const after = ok && entity && entityId ? snapshotRow(entity.table, entityId) : null;
        const diff = before && after ? diffObject(before, after) : null;
        const ctx = { req, before, after, diff, body: trimBody(req.body) };
        const nameFromRow = (row) => (row && entity && entity.nameField ? row[entity.nameField] : '');

        // before / after 走 record 的顶层参数：落库时会被写成 BEFORE:/AFTER: 前缀行，
        // 超管前端据此还原「变更前 / 变更后」快照；detail 只保留请求上下文与 diff，避免重复占用。
        record({
          req,
          module: options.module,
          action: String(resolve(options.action, ctx) || 'unknown'),
          targetType: resolve(options.targetType, ctx) || '',
          targetId: entityId || '',
          targetName: String(resolve(options.targetName, ctx) || nameFromRow(before) || nameFromRow(after) || ''),
          summary: String(resolve(options.summary, ctx) || ''),
          amount: String(resolve(options.amount, ctx) || ''),
          result: ok ? 'success' : 'failed',
          statusCode,
          before,
          after,
          detail: {
            method: req.method,
            path: req.originalUrl,
            params: req.params,
            query: req.query,
            body: ctx.body,
            diff,
          },
        });
      } catch (err) {
        console.error('[audit-trail] 记录失败', err.message);
      }
    };

    res.on('finish', write);
    res.on('close', write); // 客户端提前断开时也要补一条
    next();
  };
}

/**
 * 失败尝试记录器：挂在路由入口（router.use），只记 4xx / 5xx 的响应，
 * 让超管能看到「谁在什么时候越权 / 操作失败」，成功请求由具体路由的 trail 负责，避免重复。
 */
function failureTrail(module) {
  return function failureMiddleware(req, res, next) {
    let done = false;
    const write = () => {
      if (done) return;
      done = true;
      const statusCode = res.statusCode || 0;
      if (statusCode < 400) return;
      try {
        record({
          req,
          module,
          action: `${req.method.toLowerCase()} ${String(req.baseUrl || '')}${String(req.path || '')}`.replace(/\s+/g, ' '),
          result: 'failed',
          statusCode,
          summary: '操作被拒绝或执行失败',
          detail: { method: req.method, path: req.originalUrl, params: req.params, query: req.query, body: trimBody(req.body) },
        });
      } catch (err) {
        console.error('[audit-trail] 失败日志记录异常', err.message);
      }
    };
    res.on('finish', write);
    res.on('close', write);
    next();
  };
}

module.exports = { trail, failureTrail };
