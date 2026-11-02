import Database from 'better-sqlite3'
const db = new Database('data/fatloss.db', { readonly: true })
for (const t of ['profile','body_records','diet_entries','workouts','foods','exercises','goals','settings','advice_logs']) {
  const c = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get()
  console.log(t, c.c)
}
console.log('body dates', db.prepare('SELECT date, weight_kg FROM body_records ORDER BY date DESC LIMIT 3').all())
console.log('diet dates', db.prepare('SELECT date, COUNT(*) c FROM diet_entries GROUP BY date ORDER BY date DESC LIMIT 3').all())
console.log('settings', db.prepare('SELECT * FROM settings').all())
