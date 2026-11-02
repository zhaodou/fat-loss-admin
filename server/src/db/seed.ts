/**
 * 种子数据：食物库、运动库、演示数据
 * 食物营养值均按「每 100 g 可食部」记录，来源为中国食物成分表常见值 + 品牌平均值。
 */
import { db, getSettings, nowIso, saveSettings } from './index'
import { MEAL_TYPES, SEED_DEMO, type MealType } from '../config'
import { shiftDate, localDateStr } from '../services/trend'
import { deriveUnitFromLabel } from '../services/servings'
import { saveDish } from '../services/recipe'
import { DISH_LIBRARY } from '../services/recognizer'

type FoodSeed = [name: string, category: string, kcal: number, p: number, c: number, f: number, fiber: number, serving: number, pinyin: string, label?: string]

const FOODS: FoodSeed[] = [
  // 主食
  ['米饭（熟）', '主食', 116, 2.6, 25.9, 0.3, 0.3, 150, 'mifan', '1 小碗 150 g'],
  ['糙米饭（熟）', '主食', 112, 2.6, 23.5, 0.9, 1.6, 150, 'caomifan', '1 小碗 150 g'],
  ['馒头', '主食', 223, 7, 47, 1.1, 1.3, 100, 'mantou', '1 个 100 g'],
  ['全麦面包', '主食', 246, 9, 43, 3.4, 6, 35, 'quanmaimianbao', '1 片 35 g'],
  ['面条（熟）', '主食', 110, 3.4, 22, 0.6, 1, 200, 'miantiao', '1 碗 200 g'],
  ['燕麦片（干）', '主食', 377, 13, 66, 6.7, 10, 40, 'yanmaipian', '1 份 40 g'],
  ['红薯', '主食', 86, 1.6, 20.1, 0.1, 3, 150, 'hongshu', '1 个 150 g'],
  ['玉米（鲜）', '主食', 112, 4, 22.8, 1.2, 2.9, 150, 'yumi', '1 根 150 g'],
  ['土豆', '主食', 77, 2, 17.2, 0.1, 0.7, 150, 'tudou', '1 个 150 g'],
  ['藜麦（熟）', '主食', 120, 4.4, 21.3, 1.9, 2.8, 120, 'limai', '1 份 120 g'],
  ['米粉（熟）', '主食', 109, 2, 24.9, 0.2, 0.4, 200, 'mifen', '1 碗 200 g'],
  ['全麦意面（熟）', '主食', 149, 5.3, 30, 0.9, 3.9, 150, 'yimian', '1 份 150 g'],
  // 蛋白质
  ['鸡胸肉（熟）', '蛋白质', 165, 31, 0, 3.6, 0, 120, 'jixiongrou', '1 块 120 g'],
  ['鸡腿肉（去皮）', '蛋白质', 181, 20, 0, 11, 0, 100, 'jituirou', '1 只 100 g'],
  ['鸡蛋', '蛋白质', 144, 13.3, 2.8, 8.8, 0, 50, 'jidan', '1 个 50 g'],
  ['蛋白', '蛋白质', 52, 11, 0.7, 0.2, 0, 33, 'danbai', '1 个 33 g'],
  ['三文鱼', '蛋白质', 208, 20.4, 0, 13.4, 0, 100, 'sanwenyu', '1 份 100 g'],
  ['鲈鱼', '蛋白质', 105, 18.6, 0, 3.4, 0, 120, 'luyu', '1 条 120 g'],
  ['虾仁', '蛋白质', 93, 18.6, 1, 0.8, 0, 100, 'xiaren', '1 份 100 g'],
  ['瘦牛肉', '蛋白质', 143, 21.3, 0, 5.6, 0, 100, 'shouniurou', '1 份 100 g'],
  ['猪里脊', '蛋白质', 155, 20.2, 0.7, 7.9, 0, 100, 'zhuliji', '1 份 100 g'],
  ['北豆腐', '蛋白质', 116, 12.2, 3, 6.5, 0.5, 100, 'beidoufu', '半块 100 g'],
  ['嫩豆腐', '蛋白质', 57, 5.7, 2.4, 2.7, 0.4, 150, 'nendoufu', '1 盒 150 g'],
  ['豆浆（无糖）', '蛋白质', 31, 3, 1.2, 1.6, 0.2, 250, 'doujiang', '1 杯 250 ml'],
  ['毛豆', '蛋白质', 131, 13.1, 10.5, 5, 4, 80, 'maodou', '1 小碟 80 g'],
  ['金枪鱼罐头（水浸）', '蛋白质', 116, 26, 0, 1, 0, 100, 'jinqiangyu', '1 罐 100 g'],
  ['希腊酸奶（无糖）', '乳品', 59, 10, 3.6, 0.4, 0, 150, 'xilasuannai', '1 盒 150 g'],
  ['牛奶（全脂）', '乳品', 65, 3.3, 4.9, 3.6, 0, 250, 'niunai', '1 杯 250 ml'],
  ['低脂牛奶', '乳品', 45, 3.4, 5, 1.2, 0, 250, 'dizhiniunai', '1 杯 250 ml'],
  ['奶酪', '乳品', 328, 25, 3.5, 24, 0, 20, 'nailao', '1 片 20 g'],
  // 蔬菜
  ['西兰花', '蔬菜', 36, 4.1, 4.3, 0.6, 1.6, 150, 'xilanhua', '1 份 150 g'],
  ['菠菜', '蔬菜', 28, 2.6, 4.5, 0.3, 1.7, 150, 'bocai', '1 份 150 g'],
  ['生菜', '蔬菜', 16, 1.3, 2, 0.3, 0.7, 100, 'shengcai', '1 份 100 g'],
  ['番茄', '蔬菜', 20, 0.9, 4, 0.2, 0.5, 150, 'fanqie', '1 个 150 g'],
  ['黄瓜', '蔬菜', 16, 0.8, 2.9, 0.2, 0.5, 150, 'huanggua', '1 根 150 g'],
  ['胡萝卜', '蔬菜', 39, 1, 8.8, 0.2, 2.8, 100, 'huluobo', '1 根 100 g'],
  ['大白菜', '蔬菜', 17, 1.5, 3.2, 0.1, 0.8, 200, 'dabaicai', '1 份 200 g'],
  ['蘑菇', '蔬菜', 26, 2.7, 4.1, 0.1, 2.1, 100, 'mogu', '1 份 100 g'],
  ['青椒', '蔬菜', 22, 1, 5.4, 0.2, 1.4, 100, 'qingjiao', '1 个 100 g'],
  ['芦笋', '蔬菜', 22, 2.2, 3.9, 0.1, 2.1, 100, 'lusun', '1 份 100 g'],
  ['冬瓜', '蔬菜', 12, 0.4, 2.6, 0.2, 0.7, 200, 'donggua', '1 份 200 g'],
  // 水果
  ['苹果', '水果', 53, 0.2, 13.5, 0.2, 1.7, 200, 'pingguo', '1 个 200 g'],
  ['香蕉', '水果', 93, 1.4, 22, 0.2, 1.2, 120, 'xiangjiao', '1 根 120 g'],
  ['蓝莓', '水果', 57, 0.7, 14.5, 0.3, 2.4, 80, 'lanmei', '1 盒 80 g'],
  ['草莓', '水果', 32, 1, 7.1, 0.2, 1.1, 150, 'caomei', '1 份 150 g'],
  ['橙子', '水果', 48, 0.8, 11.1, 0.2, 0.6, 200, 'chengzi', '1 个 200 g'],
  ['西瓜', '水果', 31, 0.5, 7.9, 0.1, 0.3, 300, 'xigua', '1 块 300 g'],
  ['猕猴桃', '水果', 61, 0.8, 14.5, 0.6, 2.6, 100, 'mihoutao', '1 个 100 g'],
  ['牛油果', '水果', 171, 2, 7.4, 15.3, 2.1, 100, 'niuyouguo', '半个 100 g'],
  // 坚果
  ['核桃', '坚果', 646, 14.9, 19.1, 58.8, 9.5, 15, 'hetao', '3 个 15 g'],
  ['杏仁', '坚果', 578, 21.2, 21.7, 49.9, 12.2, 15, 'xingren', '1 小把 15 g'],
  ['花生', '坚果', 574, 24.8, 21.7, 44.3, 5.5, 15, 'huasheng', '1 小把 15 g'],
  ['腰果', '坚果', 559, 17.3, 41.6, 36.7, 3.6, 15, 'yaoguo', '1 小把 15 g'],
  // 饮品
  ['美式咖啡（无糖）', '饮品', 2, 0.1, 0, 0, 0, 300, 'meishikafei', '1 杯 300 ml'],
  ['拿铁（全脂）', '饮品', 55, 3, 4.5, 2.8, 0, 350, 'natie', '1 杯 350 ml'],
  ['奶茶（全糖）', '饮品', 78, 1, 13, 2.5, 0, 500, 'naicha', '1 杯 500 ml'],
  ['无糖气泡水', '饮品', 0, 0, 0, 0, 0, 500, 'qipaoshui', '1 瓶 500 ml'],
  ['可乐', '饮品', 43, 0, 10.6, 0, 0, 330, 'kele', '1 罐 330 ml'],
  ['橙汁', '饮品', 45, 0.7, 10.4, 0.2, 0.2, 250, 'chengzhi', '1 杯 250 ml'],
  // 零食
  ['薯片', '零食', 536, 6.6, 53, 33, 4.4, 40, 'shupian', '1 小包 40 g'],
  ['巧克力（牛奶）', '零食', 535, 7.6, 59.4, 29.7, 3.4, 20, 'qiaokeli', '2 块 20 g'],
  ['苏打饼干', '零食', 408, 8.4, 76, 7.7, 3, 30, 'sudabinggan', '3 片 30 g'],
  ['冰淇淋', '零食', 207, 3.5, 24, 11, 0.7, 100, 'bingqilin', '1 个 100 g'],
  // 快餐 / 外食
  ['牛肉汉堡', '快餐', 250, 12, 27, 10, 1.5, 200, 'hanbao', '1 个 200 g'],
  ['炸鸡（带皮）', '快餐', 279, 22, 8, 18, 0.4, 150, 'zhaji', '2 块 150 g'],
  ['披萨', '快餐', 266, 11, 33, 10, 2.3, 150, 'pisa', '2 片 150 g'],
  ['兰州拉面', '快餐', 140, 5, 22, 4, 1, 500, 'lamian', '1 碗 500 g'],
  ['麻辣烫（混合）', '快餐', 130, 7, 10, 7, 2, 500, 'malatang', '1 碗 500 g'],
  ['蛋炒饭', '快餐', 180, 5, 26, 6, 0.8, 300, 'danchaofan', '1 盘 300 g'],
  ['猪肉水饺', '快餐', 240, 9, 30, 9, 1.2, 200, 'shuijiao', '10 个 200 g'],
  ['清炒时蔬', '快餐', 90, 2.2, 6, 6.5, 2, 200, 'qingchaoshishu', '1 份 200 g'],
  // 调味 / 油脂
  ['食用油', '调味', 899, 0, 0, 99.9, 0, 10, 'shiyongyou', '1 勺 10 g'],
  ['花生酱', '调味', 588, 25, 20, 50, 6, 15, 'huashengjiang', '1 勺 15 g'],
  ['沙拉酱', '调味', 680, 1, 3, 74, 0, 15, 'shalajiang', '1 勺 15 g'],
  ['白砂糖', '调味', 400, 0, 99.9, 0, 0, 5, 'baishatang', '1 小勺 5 g'],
  ['生抽', '调味', 63, 5.6, 10.1, 0.1, 0, 10, 'shengchou', '1 勺 10 g'],

  // —— 补充：组合餐食里高频出现的食材（三明治、炒菜、拌面等）——
  ['白吐司', '主食', 280, 8.5, 50, 5.5, 2.5, 35, 'baituzi', '1 片 35 g'],
  ['贝果', '主食', 257, 10, 50, 1.7, 2.3, 90, 'beiguo', '1 个 90 g'],
  ['油条', '主食', 388, 6.9, 51, 17.6, 0.9, 50, 'youtiao', '1 根 50 g'],
  ['包子（猪肉）', '主食', 227, 8, 30, 8, 1, 100, 'baozi', '1 个 100 g'],
  ['米线（熟）', '主食', 110, 2, 24, 0.3, 0.4, 200, 'mixian', '1 碗 200 g'],
  ['火腿片', '蛋白质', 145, 18, 1.5, 7, 0, 15, 'huotuipian', '1 片 15 g'],
  ['培根', '蛋白质', 181, 22, 1.5, 10, 0, 15, 'peigen', '1 片 15 g'],
  ['鸡翅', '蛋白质', 202, 19, 0, 13.5, 0, 50, 'jichi', '1 个 50 g'],
  ['牛肉片', '蛋白质', 125, 20, 0, 4, 0, 100, 'niuroupian', '1 份 100 g'],
  ['洋葱', '蔬菜', 40, 1.1, 9, 0.1, 1.7, 100, 'yangcong', '1 个 100 g'],
  ['豆芽', '蔬菜', 44, 4.5, 4.5, 0.8, 1.8, 100, 'douya', '1 份 100 g'],
  ['茄子', '蔬菜', 23, 1.1, 4.9, 0.2, 1.3, 150, 'qiezi', '1 根 150 g'],
  ['四季豆', '蔬菜', 31, 2, 7, 0.2, 3, 100, 'sijidou', '1 份 100 g'],
  ['番茄酱', '调味', 100, 1.3, 25, 0.2, 1.2, 15, 'fanqiejiang', '1 勺 15 g'],
  ['千岛酱', '调味', 380, 1, 15, 35, 0, 15, 'qiandaojiang', '1 勺 15 g'],
]

type ExerciseSeed = [name: string, category: string, met: number, intensity: 'low' | 'moderate' | 'high', icon: string, note: string]

const EXERCISES: ExerciseSeed[] = [
  ['快走（6 km/h）', '有氧', 4.3, 'low', '🚶', '最不挑场地的减脂运动，午休饭后就能走'],
  ['慢跑（8 km/h）', '有氧', 8.3, 'moderate', '🏃', '心率控制在最大心率 65%–75%'],
  ['跑步（10 km/h）', '有氧', 9.8, 'high', '🏃‍♀️', '对膝盖压力较大，体重基数大时优先椭圆机'],
  ['骑行（通勤）', '有氧', 6.8, 'moderate', '🚴', '通勤顺带完成，注意别当成冲刺'],
  ['椭圆机', '有氧', 5, 'moderate', '🎿', '膝关节友好，适合大体重'],
  ['跳绳', '有氧', 12.3, 'high', '🪢', '10 分钟 ≈ 快走 30 分钟，注意缓冲'],
  ['游泳（自由泳）', '有氧', 8.3, 'moderate', '🏊', '全身参与，夏季首选'],
  ['HIIT', '有氧', 8, 'high', '⚡', '20 分钟足够，每周不超过 3 次'],
  ['动感单车', '有氧', 8.5, 'high', '🚲', '注意坐垫高度，避免膝盖内扣'],
  ['划船机', '有氧', 7, 'moderate', '🚣', '发力顺序：腿—核心—手'],
  ['爬楼梯', '有氧', 8.8, 'high', '🪜', '上楼练，下楼坐电梯保护膝盖'],
  ['力量训练（全身）', '力量', 5, 'moderate', '🏋️', '减脂期保住肌肉的核心手段'],
  ['深蹲', '力量', 5, 'moderate', '🦵', '膝盖跟脚尖同向，臀部发力'],
  ['硬拉', '力量', 6, 'high', '🏗️', '腰背保持中立，重量循序渐进'],
  ['卧推', '力量', 5, 'moderate', '💪', '肩胛骨收紧，不要塌腰'],
  ['引体向上 / 划船', '力量', 8, 'high', '🧗', '做不了引体先做高位下拉'],
  ['徒手核心', '力量', 3.8, 'low', '🧘', '平板支撑 30 秒 × 4 组'],
  ['瑜伽', '柔韧', 2.5, 'low', '🧘‍♀️', '改善体态，缓解久坐腰背'],
  ['拉伸', '柔韧', 2.3, 'low', '🤸', '训练后 10 分钟，减少酸痛'],
  ['普拉提', '柔韧', 3, 'low', '🤍', '核心控制，适合产后恢复'],
  ['羽毛球', '球类', 5.5, 'moderate', '🏸', '间歇性强，注意踝关节'],
  ['篮球', '球类', 6.5, 'high', '🏀', '对抗性强，注意补水'],
  ['乒乓球', '球类', 4, 'low', '🏓', '强度不高，适合作为活动量补充'],
  ['网球', '球类', 7.3, 'moderate', '🎾', '单打强度高于双打'],
  ['爬山', '户外', 6.3, 'moderate', '⛰️', '下坡对膝盖压力大，用登山杖'],
  ['徒步', '户外', 5.3, 'moderate', '🥾', '周末 2 小时，顺便补 NEAT'],
  ['舞蹈', '有氧', 5, 'moderate', '💃', '跟练 30 分钟不难坚持'],
  ['办公室拉伸', '日常', 2, 'low', '🪑', '每小时起来 2 分钟，别小看'],
  ['站立办公', '日常', 1.8, 'low', '🧍', '每天 2 小时，约多消耗 40 kcal'],
  ['遛狗', '日常', 3, 'low', '🐕', '顺便完成低强度有氧'],
  ['家务', '日常', 3.3, 'low', '🧹', '拖地 30 分钟 ≈ 快走 20 分钟'],
]

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedLibraries(): void {
  const now = nowIso()
  const foodCount = db.prepare('SELECT COUNT(*) AS c FROM foods').get() as { c: number }
  if (foodCount.c === 0) {
    const stmt = db.prepare(
      `INSERT INTO foods (name, category, kcal, protein, carb, fat, fiber, sodium, unit, serving_g, serving_label, pinyin, is_builtin, created_at, kind, servings)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'g', ?, ?, ?, 1, ?, 'ingredient', ?)`,
    )
    const insertMany = db.transaction((rows: FoodSeed[]) => {
      for (const [name, category, kcal, p, c, f, fiber, serving, pinyin, label] of rows) {
        const labelText = label ?? `${serving} g`
        // 「1 片 35 g」这类描述直接反推成结构化单位，这样「两片面包」就能自动换算
        const unit = deriveUnitFromLabel(labelText)
        stmt.run(
          name,
          category,
          kcal,
          p,
          c,
          f,
          fiber,
          serving,
          labelText,
          pinyin,
          now,
          JSON.stringify(unit ? [unit] : []),
        )
      }
    })
    insertMany(FOODS)
  } else {
    backfillServings()
    seedMissingFoods()
  }

  const exCount = db.prepare('SELECT COUNT(*) AS c FROM exercises').get() as { c: number }
  if (exCount.c === 0) {
    const stmt = db.prepare(
      `INSERT INTO exercises (name, category, met, intensity, icon, note, is_builtin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    const insertMany = db.transaction((rows: ExerciseSeed[]) => {
      for (const [name, category, met, intensity, icon, note] of rows) stmt.run(name, category, met, intensity, icon, note, now)
    })
    insertMany(EXERCISES)
  }

  seedDishes()
}

/**
 * 版本升级：把新增的内置食材补给老库。
 * 只插「库里还没有同名食材」的条目，用户改过的同名食材不会被覆盖。
 */
function seedMissingFoods(): void {
  const existing = new Set(
    (db.prepare('SELECT name FROM foods').all() as { name: string }[]).map((r) => r.name),
  )
  const missing = FOODS.filter((f) => !existing.has(f[0]))
  if (!missing.length) return
  const stmt = db.prepare(
    `INSERT INTO foods (name, category, kcal, protein, carb, fat, fiber, sodium, unit, serving_g, serving_label, pinyin, is_builtin, created_at, kind, servings)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'g', ?, ?, ?, 1, ?, 'ingredient', ?)`,
  )
  const run = db.transaction((rows: FoodSeed[]) => {
    for (const [name, category, kcal, p, c, f, fiber, serving, pinyin, label] of rows) {
      const labelText = label ?? `${serving} g`
      const unit = deriveUnitFromLabel(labelText)
      stmt.run(name, category, kcal, p, c, f, fiber, serving, labelText, pinyin, nowIso(), JSON.stringify(unit ? [unit] : []))
    }
  })
  run(missing)
}

/**
 * 老库升级：把已经有 serving_label 但 servings 为空的食材补上单位表。
 * 幂等，只在 servings = '[]' 时写，不会覆盖用户自己改过的单位。
 */
function backfillServings(): void {
  const rows = db
    .prepare(`SELECT id, serving_label FROM foods WHERE kind = 'ingredient' AND (servings IS NULL OR servings = '[]')`)
    .all() as { id: number; serving_label: string | null }[]
  const stmt = db.prepare('UPDATE foods SET servings = ? WHERE id = ?')
  const run = db.transaction((list: typeof rows) => {
    for (const r of list) {
      const unit = deriveUnitFromLabel(String(r.serving_label ?? ''))
      if (unit) stmt.run(JSON.stringify([unit]), r.id)
    }
  })
  if (rows.length) run(rows)
}

/** 内置几道示例餐食，让「我的餐食」一进去就有东西可看、可改 */
function seedDishes(): void {
  const wanted = new Map(DISH_LIBRARY.map((t) => [t.name, t]))

  // 清理改过名的旧内置餐食（只动 is_builtin = 1 的，用户自建的不受影响）
  const stale = db.prepare(`SELECT id, name FROM foods WHERE kind = 'dish' AND is_builtin = 1`).all() as { id: number; name: string }[]
  for (const s of stale) {
    if (!wanted.has(s.name)) db.prepare('DELETE FROM foods WHERE id = ?').run(s.id)
  }

  const existing = new Set(
    (db.prepare(`SELECT name FROM foods WHERE kind = 'dish'`).all() as { name: string }[]).map((r) => r.name),
  )
  const missing = DISH_LIBRARY.filter((t) => !existing.has(t.name))
  if (!missing.length) return

  const run = db.transaction(() => {
    for (const t of missing) {
      // 只种库里有完整食材的菜，缺食材的跳过，避免出现半份菜谱
      const items = t.items.map((i) => ({ name: i.food, units: i.units ?? null, unit: i.unit ?? null, grams: i.grams ?? null }))
      try {
        saveDish(
          {
            name: t.name,
            category: t.category,
            items,
            note: `示例餐食（${t.category}），食材可自行调整`,
          },
          undefined,
          { builtin: true },
        )
      } catch {
        /* 缺食材的模板跳过即可 */
      }
    }
  })
  run()
}

/* ------------------------------- 演示数据 ------------------------------- */

interface FoodRef {
  id: number
  name: string
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
}

function foodMap(): Map<string, FoodRef> {
  const rows = db.prepare('SELECT id, name, kcal, protein, carb, fat, fiber FROM foods').all() as FoodRef[]
  return new Map(rows.map((r) => [r.name, r]))
}

const MEAL_TEMPLATES: Record<Exclude<MealType, 'snack'>, { food: string; g: number }[][]> = {
  breakfast: [
    [
      { food: '燕麦片（干）', g: 40 },
      { food: '牛奶（全脂）', g: 250 },
      { food: '鸡蛋', g: 50 },
    ],
    [
      { food: '全麦面包', g: 70 },
      { food: '鸡蛋', g: 100 },
      { food: '美式咖啡（无糖）', g: 300 },
    ],
    [
      { food: '红薯', g: 150 },
      { food: '豆浆（无糖）', g: 250 },
      { food: '鸡蛋', g: 50 },
    ],
  ],
  lunch: [
    [
      { food: '米饭（熟）', g: 180 },
      { food: '鸡胸肉（熟）', g: 120 },
      { food: '西兰花', g: 150 },
      { food: '食用油', g: 8 },
    ],
    [
      { food: '糙米饭（熟）', g: 180 },
      { food: '瘦牛肉', g: 100 },
      { food: '青椒', g: 100 },
      { food: '食用油', g: 8 },
    ],
    [
      { food: '兰州拉面', g: 400 },
      { food: '鸡蛋', g: 50 },
      { food: '生菜', g: 80 },
    ],
    [
      { food: '米饭（熟）', g: 120 },
      { food: '猪里脊', g: 100 },
      { food: '蘑菇', g: 100 },
      { food: '食用油', g: 10 },
    ],
  ],
  dinner: [
    [
      { food: '糙米饭（熟）', g: 150 },
      { food: '三文鱼', g: 100 },
      { food: '食用油', g: 6 },
      { food: '菠菜', g: 150 },
    ],
    [
      { food: '红薯', g: 150 },
      { food: '鸡腿肉（去皮）', g: 100 },
      { food: '大白菜', g: 200 },
      { food: '食用油', g: 6 },
    ],
    [
      { food: '北豆腐', g: 150 },
      { food: '虾仁', g: 100 },
      { food: '冬瓜', g: 200 },
      { food: '米饭（熟）', g: 80 },
    ],
  ],
}

const SNACK_TEMPLATES: { food: string; g: number }[][] = [
  [
    { food: '希腊酸奶（无糖）', g: 150 },
    { food: '蓝莓', g: 80 },
  ],
  [
    { food: '苹果', g: 180 },
    { food: '杏仁', g: 15 },
  ],
  [{ food: '牛奶（全脂）', g: 250 }],
  [{ food: '香蕉', g: 100 }],
]

export function seedDemo(): void {
  const settings = getSettings()
  if (settings.demoSeeded) return

  const bodyCount = db.prepare('SELECT COUNT(*) AS c FROM body_records').get() as { c: number }
  const dietCount = db.prepare('SELECT COUNT(*) AS c FROM diet_entries').get() as { c: number }
  if (bodyCount.c > 0 || dietCount.c > 0) {
    saveSettings({ demoSeeded: true })
    return
  }

  const foods = foodMap()
  const rand = mulberry32(20261020)
  const today = new Date()
  const todayStr = localDateStr(today)
  const now = nowIso()

  const insertBody = db.prepare(
    'INSERT OR IGNORE INTO body_records (date, weight_kg, waist_cm, body_fat_pct, muscle_kg, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const insertDiet = db.prepare(
    `INSERT INTO diet_entries (date, meal_type, food_id, food_name, amount_g, kcal, protein, carb, fat, fiber, photo, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'demo', ?)`,
  )
  const insertWorkout = db.prepare(
    `INSERT INTO workouts (date, start_time, exercise_id, name, duration_min, intensity, met, kcal, distance_km, avg_hr, route, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', ?)`,
  )

  // 21 天体重：起步 64.2 kg，缓慢下降 + 日常波动
  const startWeight = 63.7
  const run = db.transaction(() => {
    for (let i = 20; i >= 0; i--) {
      const date = shiftDate(todayStr, -i)
      const drop = (20 - i) * 0.06
      const noise = (rand() - 0.5) * 0.55
      const weight = Math.round((startWeight - drop + noise) * 10) / 10
      const waist = Math.round((77.6 - (20 - i) * 0.07 + (rand() - 0.5) * 0.4) * 10) / 10
      const fat = Math.round((31.2 - (20 - i) * 0.06 + (rand() - 0.5) * 0.3) * 10) / 10
      insertBody.run(date, weight, waist, fat, 41.5 + rand(), i % 7 === 0 || i === 0 ? '晨起空腹' : '', now)
    }

    for (let i = 20; i >= 0; i--) {
      const date = shiftDate(todayStr, -i)
      const dow = new Date(`${date}T00:00:00`).getDay()
      const isToday = i === 0

      const meals: MealType[] = isToday ? ['breakfast', 'lunch'] : ['breakfast', 'lunch', 'dinner']
      for (const meal of meals) {
        if (meal === 'snack') continue
        const templates = MEAL_TEMPLATES[meal as Exclude<MealType, 'snack'>]
        const tpl = templates[Math.floor(rand() * templates.length)]
        const hour = meal === 'breakfast' ? 7 : meal === 'lunch' ? 12 : 19
        for (const item of tpl) {
          const f = foods.get(item.food)
          if (!f) continue
          const grams = item.g * (0.9 + rand() * 0.2)
          const k = (f.kcal * grams) / 100
          insertDiet.run(
            date,
            meal,
            f.id,
            f.name,
            Math.round(grams),
            Math.round(k),
            Math.round(((f.protein * grams) / 100) * 10) / 10,
            Math.round(((f.carb * grams) / 100) * 10) / 10,
            Math.round(((f.fat * grams) / 100) * 10) / 10,
            Math.round(((f.fiber * grams) / 100) * 10) / 10,
            `${date}T${String(hour).padStart(2, '0')}:${String(Math.floor(rand() * 40)).padStart(2, '0')}:00.000Z`,
          )
        }
      }

      // 加餐：一周 4 次左右
      if (!isToday && rand() > 0.22) {
        const tpl = SNACK_TEMPLATES[Math.floor(rand() * SNACK_TEMPLATES.length)]
        for (const item of tpl) {
          const f = foods.get(item.food)
          if (!f) continue
          const grams = item.g
          insertDiet.run(
            date,
            'snack',
            f.id,
            f.name,
            grams,
            Math.round((f.kcal * grams) / 100),
            Math.round(((f.protein * grams) / 100) * 10) / 10,
            Math.round(((f.carb * grams) / 100) * 10) / 10,
            Math.round(((f.fat * grams) / 100) * 10) / 10,
            Math.round(((f.fiber * grams) / 100) * 10) / 10,
            `${date}T16:20:00.000Z`,
          )
        }
      }

      // 运动：周一/周三/周五晚间，周六下午快走
      if (!isToday && [1, 3, 5].includes(dow) && rand() > 0.15) {
        const isStrength = dow !== 5
        const name = isStrength ? '力量训练（全身）' : '慢跑（8 km/h）'
        const met = isStrength ? 5 : 8.3
        const minutes = isStrength ? 45 : 35
        const kcal = Math.round(((met * 3.5 * 62) / 200) * minutes)
        insertWorkout.run(date, '19:30', null, name, minutes, isStrength ? 'moderate' : 'moderate', met, kcal, null, null, `${date}T19:30:00.000Z`)
      }
      if (!isToday && dow === 6) {
        insertWorkout.run(date, '15:00', null, '快走（6 km/h）', 60, 'low', 4.3, Math.round(((4.3 * 3.5 * 62) / 200) * 60), 5.2, null, `${date}T15:00:00.000Z`)
      }
    }

    db.prepare('DELETE FROM goals').run()
    db.prepare(
      `INSERT INTO goals (start_weight, target_weight, target_date, start_date, weekly_target, status, note, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      startWeight,
      58,
      shiftDate(todayStr, 100),
      shiftDate(todayStr, -21),
      0.5,
      '演示目标：3 个月减到 58 kg',
      now,
    )
  })
  run()

  saveSettings({ demoSeeded: true })
}

export function seedAll(): void {
  seedLibraries()
  if (SEED_DEMO) seedDemo()
}

export { MEAL_TYPES }
