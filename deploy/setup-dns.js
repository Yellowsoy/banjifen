'use strict';
/**
 * 阿里云 DNS 记录工具（可选，用于把域名指向服务器）
 * 依赖环境变量：ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET
 *
 * 用法：
 *   node deploy/setup-dns.js list  5166966.xyz
 *   node deploy/setup-dns.js upsert 5166966.xyz bj A 1.2.3.4
 *   node deploy/setup-dns.js upsert 5166966.xyz bj CNAME abc.example.com
 */
const crypto = require('node:crypto');

const AK = process.env.ALIYUN_ACCESS_KEY_ID;
const SK = process.env.ALIYUN_ACCESS_KEY_SECRET;
const ENDPOINT = 'https://alidns.aliyuncs.com/';
const VERSION = '2015-01-09';

if (!AK || !SK) {
  console.error('缺少 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET 环境变量');
  process.exit(1);
}

const pe = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function sign(params) {
  const q = Object.keys(params)
    .sort()
    .map((k) => `${pe(k)}=${pe(params[k])}`)
    .join('&');
  const sts = `GET&${pe('/')}&${pe(q)}`;
  const sig = crypto.createHmac('sha1', `${SK}&`).update(sts).digest('base64');
  return `${q}&Signature=${pe(sig)}`;
}

async function call(action, params = {}) {
  const all = {
    Action: action,
    Format: 'JSON',
    Version: VERSION,
    AccessKeyId: AK,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...params,
  };
  const res = await fetch(`${ENDPOINT}?${sign(all)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(`${action} 失败: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const [cmd, domain, rr, type, value] = process.argv.slice(2);
  if (!cmd || !domain) {
    console.error('用法: node deploy/setup-dns.js <list|upsert> <domain> [rr type value]');
    process.exit(1);
  }
  if (cmd === 'list') {
    const data = await call('DescribeDomainRecords', { DomainName: domain, PageSize: 100 });
    (data.DomainRecords?.Record || []).forEach((r) => {
      console.log(`${r.RR.padEnd(12)} ${r.Type.padEnd(6)} ${String(r.Value).padEnd(40)} TTL=${r.TTL} ${r.Status}`);
    });
    return;
  }
  if (cmd === 'upsert') {
    if (!rr || !type || !value) throw new Error('upsert 需要 rr type value');
    const existing = await call('DescribeDomainRecords', { DomainName: domain, RRKeyWord: rr, Type: type });
    const hit = (existing.DomainRecords?.Record || []).find((r) => r.RR === rr && r.Type === type);
    if (hit) {
      await call('UpdateDomainRecord', { RecordId: hit.RecordId, RR: rr, Type: type, Value: value, TTL: 600 });
      console.log(`已更新 ${rr}.${domain} ${type} -> ${value}`);
    } else {
      await call('AddDomainRecord', { DomainName: domain, RR: rr, Type: type, Value: value, TTL: 600 });
      console.log(`已新增 ${rr}.${domain} ${type} -> ${value}`);
    }
    const after = await call('DescribeDomainRecords', { DomainName: domain, RRKeyWord: rr, Type: type });
    (after.DomainRecords?.Record || []).forEach((r) => console.log(`回读: ${r.RR} ${r.Type} ${r.Value} ${r.Status}`));
    return;
  }
  throw new Error(`未知命令 ${cmd}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
