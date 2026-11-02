import Database from 'better-sqlite3'
import fs from 'node:fs'
import { DB_FILE, defaultSettings, type AppSettings } from '../config'
import { hashPassword } from '../services/password'

export const db = new Database(DB_FILE)

/**
 * 日志模式按 WAL → TRUNCATE → MEMORY 依次降级。
 * 某些受限环境（沙箱/只读临时目录）不允许创建或删除 -wal / -journal 文件，
 * WAL 会直接报 disk I/O error；此时退到 MEMORY 仍可正常读写。
 *
 * ⚠️ 绝对不要删除 -wal / -shm：WAL 里存的是**尚未 checkpoint 到主库的已提交事务**，
 * 删掉等于把最近写入的数据全部回滚（曾因此丢失过整天的记录和模型配置）。
 * SQLite 自己会在打开时做 WAL 恢复，不劳外部插手。
 */
function configureDb() {
  for (const mode of ['WAL', 'TRUNCATE', 'MEMORY', 'OFF']) {
    try {
      db.pragma(`journal_mode = ${mode}`)
      db.pragma('foreign_keys = ON')
      db.pragma('busy_timeout = 5000')
      return mode
    } catch {
      /* 换下一个模式 */
    }
  }
  return 'OFF'
}

export const journalMode = configureDb()

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  nickname      TEXT    NOT NULL DEFAULT '我',
  gender        TEXT    NOT NULL DEFAULT 'female',
  birth_date    TEXT    NOT NULL DEFAULT '1995-01-01',
  height_cm     REAL    NOT NULL DEFAULT 165,
  weight_kg     REAL    NOT NULL DEFAULT 60,
  body_fat_pct  REAL,
  activity_note TEXT    DEFAULT '',
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS body_records (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL UNIQUE,
  weight_kg    REAL,
  waist_cm     REAL,
  body_fat_pct REAL,
  muscle_kg    REAL,
  note         TEXT DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_body_date ON body_records(date);

CREATE TABLE IF NOT EXISTS foods (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '其他',
  kcal        REAL NOT NULL DEFAULT 0,
  protein     REAL NOT NULL DEFAULT 0,
  carb        REAL NOT NULL DEFAULT 0,
  fat         REAL NOT NULL DEFAULT 0,
  fiber       REAL NOT NULL DEFAULT 0,
  sodium      REAL NOT NULL DEFAULT 0,
  unit        TEXT NOT NULL DEFAULT 'g',
  serving_g   REAL NOT NULL DEFAULT 100,
  serving_label TEXT DEFAULT '100 克',
  pinyin      TEXT DEFAULT '',
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  -- ingredient = 单一食材；dish = 由多个食材组合成的餐食（一份三明治、一盘炒饭）
  kind        TEXT NOT NULL DEFAULT 'ingredient',
  -- 单位表 JSON：[{"label":"片","grams":35}]，让「两片面包」能直接换算成克
  servings    TEXT NOT NULL DEFAULT '[]',
  -- 只有 dish 才有：组成明细 JSON [{food_id,name,grams,units,unit}]
  recipe      TEXT,
  note        TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_food_name ON foods(name);

CREATE TABLE IF NOT EXISTS exercises (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '有氧',
  met        REAL NOT NULL DEFAULT 3,
  intensity  TEXT NOT NULL DEFAULT 'moderate',
  icon       TEXT DEFAULT '',
  note       TEXT DEFAULT '',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workouts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,
  start_time   TEXT NOT NULL DEFAULT '19:00',
  exercise_id  INTEGER,
  name         TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 30,
  intensity    TEXT NOT NULL DEFAULT 'moderate',
  met          REAL NOT NULL DEFAULT 5,
  kcal         REAL NOT NULL DEFAULT 0,
  distance_km  REAL,
  avg_hr       INTEGER,
  sets         INTEGER,
  reps         INTEGER,
  weight_kg    REAL,
  route        TEXT,
  note         TEXT DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workout_date ON workouts(date);

CREATE TABLE IF NOT EXISTS diet_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  meal_type  TEXT NOT NULL,
  food_id    INTEGER,
  food_name  TEXT NOT NULL,
  amount_g   REAL NOT NULL DEFAULT 100,
  kcal       REAL NOT NULL DEFAULT 0,
  protein    REAL NOT NULL DEFAULT 0,
  carb       REAL NOT NULL DEFAULT 0,
  fat        REAL NOT NULL DEFAULT 0,
  fiber      REAL NOT NULL DEFAULT 0,
  photo      TEXT,
  source     TEXT NOT NULL DEFAULT 'manual',
  -- 记录时引用的是单一食材还是组合餐食，仅用于展示区分
  food_kind  TEXT DEFAULT 'ingredient',
  -- 整餐录入时的原始描述文本，便于后续「整体编辑 + 重新计算」
  raw_text   TEXT,
  -- 估算依据（助手对话里算出的理由，或「每日饮食」手动补的依据），便于追溯记录来源
  basis      TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diet_date ON diet_entries(date);

CREATE TABLE IF NOT EXISTS meal_photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  meal_type  TEXT NOT NULL,
  url        TEXT NOT NULL,
  recognized TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meal_photo_date ON meal_photos(date);

/* 体型照片：用户每日用电子秤称重后，上传正面 / 侧面 / 背面照片，便于后续对比身体变化 */
CREATE TABLE IF NOT EXISTS body_photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  view       TEXT NOT NULL DEFAULT 'front',  -- front=正面 side=侧面 back=背面
  url        TEXT NOT NULL,
  note       TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_body_photo_date ON body_photos(date);

CREATE TABLE IF NOT EXISTS goals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  start_weight   REAL NOT NULL,
  target_weight  REAL NOT NULL,
  target_date    TEXT NOT NULL,
  start_date     TEXT NOT NULL,
  weekly_target  REAL NOT NULL DEFAULT 0.5,
  status         TEXT NOT NULL DEFAULT 'active',
  note           TEXT DEFAULT '',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  work_start     TEXT NOT NULL DEFAULT '09:00',
  work_end       TEXT NOT NULL DEFAULT '18:00',
  lunch_start    TEXT NOT NULL DEFAULT '12:00',
  lunch_end      TEXT NOT NULL DEFAULT '14:00',
  meal_minutes   INTEGER NOT NULL DEFAULT 40,
  dinner_time    TEXT NOT NULL DEFAULT '18:30',
  wake_time      TEXT NOT NULL DEFAULT '07:00',
  sleep_time     TEXT NOT NULL DEFAULT '23:30',
  workout_days   TEXT NOT NULL DEFAULT '[1,3,5]',
  preferred      TEXT NOT NULL DEFAULT '["快走","力量训练"]',
  diet_pref      TEXT NOT NULL DEFAULT '{"style":"中式家常","avoid":["油炸"],"likes":[]}',
  step_goal      INTEGER NOT NULL DEFAULT 8000,
  note           TEXT DEFAULT '',
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS advice_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,
  score        INTEGER NOT NULL DEFAULT 0,
  headline     TEXT NOT NULL DEFAULT '',
  payload      TEXT NOT NULL,
  engine       TEXT NOT NULL DEFAULT 'local',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_advice_date ON advice_logs(date);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

/* —— 「我的助手」多轮对话 —— */
CREATE TABLE IF NOT EXISTS assistant_threads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL DEFAULT '新的对话',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thread_updated ON assistant_threads(updated_at);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  INTEGER NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  model      TEXT NOT NULL DEFAULT '',
  tokens     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_thread ON assistant_messages(thread_id);

/* ----------------------------- 账号与登录 ----------------------------- */
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  nickname      TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_user ON sessions(user_id);
`

/**
 * 增量迁移：只做「缺列则补列」，保证老数据库平滑升级、数据不丢。
 * SQLite 的 ALTER TABLE ADD COLUMN 不能加 UNIQUE / 非空无默认值，这里都带默认值。
 */
function migrate(): void {
  const columnsOf = (table: string): Set<string> => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    return new Set(rows.map((r) => r.name))
  }
  const ensure = (table: string, column: string, ddl: string) => {
    if (!columnsOf(table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }

  ensure('foods', 'kind', `kind TEXT NOT NULL DEFAULT 'ingredient'`)
  ensure('foods', 'servings', `servings TEXT NOT NULL DEFAULT '[]'`)
  ensure('foods', 'recipe', `recipe TEXT`)
  ensure('foods', 'note', `note TEXT DEFAULT ''`)
  ensure('diet_entries', 'food_kind', `food_kind TEXT DEFAULT 'ingredient'`)
  ensure('diet_entries', 'raw_text', `raw_text TEXT`)
  ensure('diet_entries', 'basis', `basis TEXT`)
  ensure('workouts', 'sets', `sets INTEGER`)
  ensure('workouts', 'reps', `reps INTEGER`)
  ensure('workouts', 'weight_kg', `weight_kg REAL`)

  // 索引迁移后补建（老库建表语句里没有这些索引）
  db.exec('CREATE INDEX IF NOT EXISTS idx_food_kind ON foods(kind)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_diet_date ON diet_entries(date)')
}

export function initSchema(): void {
  db.exec(SCHEMA)
  migrate()

  const now = new Date().toISOString()
  const hasProfile = db.prepare('SELECT COUNT(*) AS c FROM profile').get() as { c: number }
  if (hasProfile.c === 0) {
    db.prepare(
      `INSERT INTO profile (id, nickname, gender, birth_date, height_cm, weight_kg, body_fat_pct, activity_note, created_at, updated_at)
       VALUES (1, '豆姐', 'female', '1994-06-18', 164, 62.5, 30.5, '办公室坐班，通勤地铁，晚上 23:30 睡', ?, ?)`,
    ).run(now, now)
  }

  const hasPlan = db.prepare('SELECT COUNT(*) AS c FROM plan').get() as { c: number }
  if (hasPlan.c === 0) {
    db.prepare(
      `INSERT INTO plan (id, updated_at) VALUES (1, ?)`,
    ).run(now)
  }

  const hasSettings = db.prepare('SELECT COUNT(*) AS c FROM settings').get() as { c: number }
  if (hasSettings.c === 0) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('app', JSON.stringify(defaultSettings))
  }

  // 默认账号：user / user@123.（首次建库时播种，之后不再覆盖，可正常修改密码）
  const hasUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }
  if (hasUsers.c === 0) {
    const { hash, salt } = hashPassword('user@123.')
    db.prepare(
      `INSERT INTO users (username, password_hash, password_salt, nickname, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('user', hash, salt, '默认用户', now, now)
  }

  upgradeAssistantSettings()
}

/**
 * 老库的 ai 配置只有 { provider: 'local', model, tone }，
 * 这里补上 endpoint / temperature，并把 local 迁到默认供应商，避免界面显示「自定义」却没地址。
 * 幂等：只在 provider 仍是 local 时执行一次。
 */
function upgradeAssistantSettings(): void {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'app'`).get() as { value: string } | undefined
  if (!row) return
  try {
    const current = JSON.parse(row.value)
    const ai = current?.ai
    if (!ai || ai.provider !== 'local') return
    current.ai = {
      ...defaultSettings.ai,
      apiKey: typeof ai.apiKey === 'string' ? ai.apiKey : '',
      tone: ai.tone || defaultSettings.ai.tone,
    }
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'app'`).run(JSON.stringify(current))
  } catch {
    /* 配置坏了就跳过，下次保存会重建 */
  }
}

/* ------------------------------- settings ------------------------------- */

function deepMerge<T>(base: T, patch: any): T {
  if (patch === null || patch === undefined) return base
  if (Array.isArray(base) || typeof base !== 'object') return patch as T
  const out: any = { ...base }
  for (const key of Object.keys(patch)) {
    const b = (base as any)[key]
    const p = patch[key]
    out[key] = b && typeof b === 'object' && !Array.isArray(b) ? deepMerge(b, p) : p
  }
  return out
}

export function getSettings(): AppSettings {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('app') as { value: string } | undefined
  if (!row) return { ...defaultSettings }
  try {
    return deepMerge(defaultSettings, JSON.parse(row.value))
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = deepMerge(getSettings(), patch)
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('app', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(JSON.stringify(next))
  return next
}

export function nowIso(): string {
  return new Date().toISOString()
}
