const base = 'http://127.0.0.1:4318/api'
const get = async (p) => { const r = await fetch(base + p); const j = await r.json(); return { status: r.status, j } }
const D = '2026-10-20'
const checks = [
  ['GET /dashboard', `/dashboard?date=${D}`, (d) => `weight ${d.weight.current} trend ${d.weight.trend} tdee ${d.burn.tdee} intake ${d.intake.kcal} deficit ${d.deficit.value}(${d.deficit.status})`],
  ['GET /analysis/energy', `/analysis/energy?date=${D}`, (d) => `bmr ${d.breakdown.bmrFull}(${d.formula.bmrName}) neat ${d.breakdown.neat} ex ${d.breakdown.exercise} tdee ${d.breakdown.tdee} plan ${d.plan.recommended}`],
  ['GET /diet/day', `/diet/day?date=${D}`, (d) => `meals ${d.meals.map(m=>m.label+':'+m.subtotal.kcal).join('/')} total ${d.totals.kcal}`],
  ['GET /body', `/body?days=30&end=${D}`, (d) => `records ${d.records.length} weekly ${d.weeklyChange} r2 ${d.r2} forecast ${d.forecast30}`],
  ['GET /stats week', `/stats?granularity=week&date=${D}`, (d) => `days ${d.summary.days} avgIntake ${d.summary.avgIntake} deficit ${d.summary.avgDeficit} weight ${d.summary.weightChange}`],
  ['GET /stats year', `/stats?granularity=year&date=${D}`, (d) => `buckets ${d.buckets.length} totalDeficit ${d.summary.totalDeficit}`],
  ['GET /plan/schedule', `/plan/schedule?date=${D}`, (d) => d.slots.map(s=>`${s.label}:${s.feasible?s.start+'-'+s.end+' '+s.activity+' '+s.kcal+'kcal':'不可用('+s.reason+')'}`).join(' | ')],
  ['GET /foods', `/foods?keyword=鸡`, (d) => `${d.length} 条：` + d.slice(0,3).map(f=>f.name).join(',')],
  ['GET /exercises', `/exercises`, (d) => `${d.length} 条`],
  ['GET /workouts', `/workouts?date=${D}`, (d) => `${d.items.length} 条`],
  ['GET /goals', `/goals/suggestion`, (d) => `recommend ${d.recommendedWeight} range ${d.healthyRange.min}-${d.healthyRange.max}`],
]
for (const [name, path, fmt] of checks) {
  try {
    const { status, j } = await get(path)
    console.log(`${status === 200 ? '✅' : '❌'} ${name} → ${status === 200 ? fmt(j) : JSON.stringify(j).slice(0,200)}`)
  } catch (e) { console.log('❌', name, e.message) }
}
const adv = await fetch(base + '/advice', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ date: D }) }).then(r=>r.json())
console.log('\n=== ADVICE ===')
console.log('score', adv.score, adv.level, '|', adv.headline)
console.log('metrics', JSON.stringify(adv.metrics))
console.log('advices:', adv.advices.map(a=>`[${a.level}] ${a.title}`).join('\n  '))
console.log('nextActions:', adv.nextActions)
console.log('schedule:', adv.schedule.slots.map(s=>`${s.label} ${s.start}-${s.end} ${s.feasible?'ok':'no'}`).join(' | '))
console.log('weekPlan:', adv.weekPlan.map(w=>`${w.date}${w.isWorkoutDay?'*':''}:${w.focus}/${w.plannedKcal}`).join(' '))
