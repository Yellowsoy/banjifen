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
'use strict';
/**
 * 种子数据：首次启动即可登录体验
 * - 超级管理员：admin / admin123456（管理全部班级与账号）
 * - 演示班级「三年级二班」及三个角色账号：
 *     班主任 123456 / 123456
 *     老师   teacher / 123456
 *     班干部 cadre / 123456
 * 已存在则跳过，不会覆盖现有数据。
 */
const db = require('./db');
const { config, genId } = require('./config');
const { hashPassword } = require('./core/security');
const { logger } = require('./core/logger');
const { ROLE } = require('./core/policy');

const DEFAULT_RULES = [
  { name: '作业优秀', score: 2 },
  { name: '课堂发言', score: 1 },
  { name: '主动帮助他人', score: 2 },
  { name: '值日认真', score: 1 },
  { name: '作业未完成', score: -2 },
  { name: '课堂讲话', score: -1 },
  { name: '迟到', score: -1 },
  { name: '未戴红领巾', score: -1 },
];

const SAMPLE_STUDENTS = [
  ['张小明', '第一组', '男', '班长'],
  ['李小红', '第一组', '女', '学习委员'],
  ['王小刚', '第二组', '男', ''],
  ['赵小美', '第二组', '女', '文艺委员'],
  ['陈小强', '第三组', '男', '体育委员'],
  ['刘小丽', '第三组', '女', ''],
  ['杨小帆', '第四组', '男', ''],
  ['周小雨', '第四组', '女', '劳动委员'],
];

const SAMPLE_GIFTS = [
  ['免写一次作业', 30],
  ['换座位一次', 50],
  ['班级小零食', 15],
  ['精美笔记本', 25],
  ['当一天小老师', 40],
];

function createAccount({ id, role, classId, username, phone, name, password }) {
  const exists = db.get('SELECT id FROM accounts WHERE username = ?', [username]);
  if (exists) return false;
  db.run(
    `INSERT INTO accounts (id, type, role, class_id, username, phone, name, pwd_hash, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      id,
      role === ROLE.SUPER ? 'super_admin' : 'class',
      role,
      classId || null,
      username,
      phone || '',
      name,
      hashPassword(password),
      Date.now(),
    ]
  );
  return true;
}

function runSeed({ silent = false } = {}) {
  const created = [];
  const now = Date.now();
  const classId = genId('cls');
  const ownerId = genId('own');

  db.transaction(() => {
    if (
      createAccount({
        id: genId('root'),
        role: ROLE.SUPER,
        username: config.seed.superUsername,
        name: '超级管理员',
        password: config.seed.superPassword,
      })
    ) {
      created.push(`超级管理员 ${config.seed.superUsername} / ${config.seed.superPassword}`);
    }

    const hasDemo = db.get('SELECT id FROM classes WHERE name = ?', ['三年级二班']);
    if (!hasDemo) {
      db.run(
        `INSERT INTO classes (id, name, school, grade, badge, owner_id, created_at)
         VALUES (?, '三年级二班', '示范小学', '三年级', '', ?, ?)`,
        [classId, ownerId, now]
      );
      if (
        createAccount({
          id: ownerId,
          role: ROLE.OWNER,
          classId,
          username: config.seed.teacherUsername,
          phone: '13800000001',
          name: '王班主任',
          password: config.seed.teacherPassword,
        })
      ) {
        created.push(`班主任 ${config.seed.teacherUsername} / ${config.seed.teacherPassword}`);
      }
      if (createAccount({ id: genId('tea'), role: ROLE.TEACHER, classId, username: 'teacher', phone: '13800000002', name: '李老师', password: '123456' })) {
        created.push('老师 teacher / 123456');
      }
      if (createAccount({ id: genId('cad'), role: ROLE.CADRE, classId, username: 'cadre', phone: '13800000003', name: '张小明', password: '123456' })) {
        created.push('班干部 cadre / 123456');
      }
      DEFAULT_RULES.forEach((rule, index) => {
        db.run('INSERT INTO quick_rules (id, class_id, name, score, sort_no, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
          genId('rule'),
          classId,
          rule.name,
          rule.score,
          index,
          now,
        ]);
      });
      SAMPLE_STUDENTS.forEach(([name, groupName, sex, position], index) => {
        const points = [12, 9, 7, 5, 4, 2, 0, -2][index] ?? 0;
        db.run(
          `INSERT INTO students (id, class_id, name, group_name, sex, position, points, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [genId('stu'), classId, name, groupName, sex, position, points, now - index * 1000]
        );
      });
      SAMPLE_GIFTS.forEach(([name, cost]) => {
        db.run('INSERT INTO gifts (id, class_id, name, cost, icon, stock, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)', [
          genId('gift'),
          classId,
          name,
          cost,
          '',
          now,
        ]);
      });
    }
  });

  if (!silent) {
    if (created.length) logger.info('种子数据已写入', { items: created });
    else logger.info('种子数据已存在，跳过');
  }
  return created;
}

module.exports = { runSeed, DEFAULT_RULES };

if (require.main === module) {
  db.init().then(() => {
    const created = runSeed();
    console.log(created.length ? `已创建：\n- ${created.join('\n- ')}` : '种子数据已存在，跳过');
    db.close();
  });
}
