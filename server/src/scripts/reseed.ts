/** 重新生成演示数据：npm run seed:demo -w server */
import { db, initSchema, saveSettings } from '../db'
import { seedAll } from '../db/seed'

initSchema()
for (const t of ['advice_logs', 'diet_entries', 'workouts', 'body_records', 'meal_photos', 'goals']) {
  db.prepare(`DELETE FROM ${t}`).run()
}
saveSettings({ demoSeeded: false })
seedAll()
const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c
console.log(
  `演示数据已重建：体重 ${count('body_records')} 条 / 饮食 ${count('diet_entries')} 条 / 运动 ${count('workouts')} 条 / 目标 ${count('goals')} 个`,
)
