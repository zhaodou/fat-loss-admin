/** 重置数据库：npm run reset:db（保留食物/运动库），加 --hard 连库一起删 */
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, DB_FILE } from '../config'
import { db, initSchema } from '../db'
import { seedAll } from '../db/seed'

const hard = process.argv.includes('--hard')

if (hard) {
  db.close()
  for (const file of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }
  initSchema()
  seedAll()
  console.log('已重建数据库（含演示数据）:', DB_FILE)
} else {
  db.prepare('DELETE FROM advice_logs').run()
  db.prepare('DELETE FROM diet_entries').run()
  db.prepare('DELETE FROM workouts').run()
  db.prepare('DELETE FROM body_records').run()
  db.prepare('DELETE FROM meal_photos').run()
  db.prepare('DELETE FROM goals').run()
  db.prepare("DELETE FROM settings WHERE key = 'app'").run()
  console.log('已清空业务数据，食物/运动库保留')
}

for (const f of fs.readdirSync(path.join(DATA_DIR, 'uploads'), { withFileTypes: true })) {
  if (f.isFile()) fs.unlinkSync(path.join(DATA_DIR, 'uploads', f.name))
}
