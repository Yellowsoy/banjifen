/*
 * Copyright 2026 Yellowsoy (banjifen contributors)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/** 统一 API 客户端：自动附带 CSRF 头、401 时静默刷新访问令牌并重试一次 */
const API_BASE = '/api';

let refreshPromise = null;

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function rawFetch(path, options) {
  return fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    ...options,
  });
}

function buildOptions({ method = 'GET', body, headers = {} } = {}) {
  const options = {
    method,
    headers: { 'x-requested-with': 'fetch', ...headers },
  };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  return options;
}

async function parse(res) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

/**
 * 校验响应确实是 JSON。
 * 背景：若云函数路由异常（SPA 回退把 /api/* 回成 index.html），响应会是 200 + text/html，
 * 此时若把 HTML 当数据使用，登录页会误判「已登录」并跳首页，首页又拿不到账号再跳回登录页，
 * 形成无限跳转循环并持续消耗接口额度。这里统一识别并抛出明确错误，快速失败。
 */
function assertJson(res, path) {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new ApiError('服务响应异常，请稍后重试', res.status || 502, 'INVALID_RESPONSE', { path });
  }
}

async function refresh() {
  if (!refreshPromise) {
    refreshPromise = rawFetch('/auth/refresh', { method: 'POST', headers: { 'x-requested-with': 'fetch' }, credentials: 'same-origin' })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      });
  }
  return refreshPromise;
}

export async function request(path, options = {}) {
  let res = await rawFetch(path, buildOptions(options));
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const ok = await refresh();
    if (ok) res = await rawFetch(path, buildOptions(options));
  }
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    let code = 'HTTP_ERROR';
    let details;
    try {
      const data = await res.json();
      if (data && data.error) {
        message = data.error.message || message;
        code = data.error.code || code;
        details = data.error.details;
      }
    } catch {
      /* 忽略解析失败 */
    }
    throw new ApiError(message, res.status, code, details);
  }
  // 2xx 但不是 JSON（如 SPA 回退返回 index.html）：视为服务异常，快速失败，
  // 避免上层把 HTML 当数据解析而进入无限跳转循环。
  assertJson(res, path);
  if (options.raw) return res;
  return parse(res);
}

export const api = {
  get: (path, query) => {
    if (!query) return request(path);
    const qs = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.append(k, v);
    });
    const s = qs.toString();
    return request(s ? `${path}?${s}` : path);
  },
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path, body) => request(path, { method: 'DELETE', body }),
  upload: (path, formData) => request(path, { method: 'POST', body: formData }),
  /** 下载文件：沿用浏览器的下载行为，同时带上鉴权 Cookie */
  async download(path, query) {
    let qs = '';
    if (query) {
      const params = new URLSearchParams();
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params.append(k, v);
      });
      qs = params.toString() ? `?${params.toString()}` : '';
    }
    const res = await request(`${path}${qs}`, { raw: true });
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
    const filename = match ? decodeURIComponent(match[1]) : 'download';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};
