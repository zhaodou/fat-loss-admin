/**
 * 「演示模式」回答引擎
 * ---------------------------------------------------------------------------
 * 存在的意义：让人**不花钱、不注册、不填 Key** 就能看到助手的完整输出形态——
 * 四段式结构、热量拆解表、营养成分表、结合本机档案的个性化建议。
 *
 * 诚实性红线（很重要，不要为了"像模型"而含糊）：
 *   1) 这**不是**真实大模型，是本机内置的样例知识 + 规则拼装；
 *   2) 前端会打「演示」徽标，回答正文里也会写明；
 *   3) 食物覆盖只有内置的几十种，匹配不到就直说，绝不硬编一个数字蒙过去；
 *   4) 营养数据来自中国食物成分表量级的常识值，标注为估算。
 *
 * 唯一"真"的部分是**你的数据**：档案、TDEE、今日已摄入、近 7 天均值都实时读库，
 * 所以「蛋白还差多少」这类结论是准的，不是编的。
 */
import { ACTIVITY_LEVELS } from '../config'
import { db, getSettings } from '../db'
import { ageFromBirth, bmi, bmiCategory, calcBmr, round } from './energy'
import { getActiveGoal, getPlan, getProfile, weightOn } from './data'
import { localDateStr, shiftDate } from './trend'
import type { ChatMessage } from './assistant'

export const DEMO_MODEL = 'demo-nutrition-v1'

/* ------------------------------- 内置食物表 ------------------------------- */

interface DemoFood {
  name: string
  aliases: string[]
  /** 以下均为每 100 g 可食部 */
  kcal: number
  protein: number
  carb: number
  fat: number
  fiber: number
  /** 常见单位换算成克 */
  units?: Record<string, number>
  /** 没写重量时的默认假设 */
  portion: { label: string; grams: number }
  /** 代表性微量营养素：[名称, 每 100g 含量, 在这份食物里的作用] */
  micros: Array<[string, string, string]>
  /** 营养特点 */
  trait: string
  good: string
  caution: string
  /** 生熟差异提示 */
  cookedNote?: string
}

const F = (
  name: string,
  aliases: string[],
  kcal: number,
  protein: number,
  carb: number,
  fat: number,
  fiber: number,
  portion: [string, number],
  units: Record<string, number>,
  micros: Array<[string, string, string]>,
  trait: string,
  good: string,
  caution: string,
  cookedNote?: string,
): DemoFood => ({
  name,
  aliases,
  kcal,
  protein,
  carb,
  fat,
  fiber,
  portion: { label: portion[0], grams: portion[1] },
  units,
  micros,
  trait,
  good,
  caution,
  cookedNote,
})

export const DEMO_FOODS: DemoFood[] = [
  F(
    '西红柿',
    ['番茄', '圣女果', '小番茄'],
    20, 0.9, 4.0, 0.2, 0.5,
    ['中等大小 1 个', 150],
    { 个: 150, 只: 150, 颗: 15, 斤: 500 },
    [
      ['维生素 C', '14 mg', '参与胶原合成与抗氧化，熟吃损失约 1/4'],
      ['番茄红素', '2.5 mg', '脂溶性类胡萝卜素，加热并配油后吸收率明显提高'],
      ['钾', '163 mg', '帮助维持血压，减脂期蔬菜摄入不足时容易缺'],
    ],
    '水分 94% 以上，热量密度极低（20 kcal/100 g），是减脂期最典型的「占体积不占热量」食物。',
    '几乎所有人，尤其想吃点有味道又不想超热量的时候。',
    '空腹大量吃可能刺激胃；肾功能不全需要限钾的人要算进每日钾总量。',
    '生吃 20 kcal/100 g；炒蛋或做汤时热量主要来自油，不是番茄本身。',
  ),
  F(
    '鸡蛋',
    ['土鸡蛋', '柴鸡蛋', '水煮蛋', '煎蛋', '荷包蛋', '炒蛋', '蛋花', '蒸蛋', '茶叶蛋'],
    143, 13.3, 2.8, 8.8, 0,
    ['1 个（可食部）', 50],
    { 个: 50, 只: 50, 枚: 50 },
    [
      ['维生素 A', '234 μgRAE', '维持黏膜与视觉功能，蛋黄是主要来源'],
      ['胆碱', '250 mg', '神经递质合成原料，一个鸡蛋约提供 125 mg'],
      ['叶黄素/玉米黄质', '约 0.3 mg', '集中在蛋黄，与眼部黄斑健康相关'],
    ],
    '优质蛋白的代表：氨基酸评分接近满分，生物利用率高；蛋黄同时带来脂肪与卵磷脂，饱腹感强。',
    '几乎所有减脂人群，早餐吃 1–2 个比只吃碳水更抗饿。',
    '血脂异常者不必完全戒蛋黄，但要控制总量（每日 1 个较稳妥）；生鸡蛋吸收率反而低且有沙门氏菌风险。',
    '水煮 1 个约 72 kcal；煎蛋另计油（1 勺油约 90 kcal），一个煎蛋常在 160 kcal 上下。',
  ),
  F(
    '鸡胸肉',
    ['鸡胸', '鸡脯肉', '鸡大胸'],
    118, 24.6, 0.6, 1.9, 0,
    ['1 块（约手掌大）', 150],
    { 块: 150, 片: 30, 份: 120 },
    [
      ['维生素 B6', '0.6 mg', '参与蛋白质代谢，蛋白吃得多时需求量上升'],
      ['磷', '200 mg', '与蛋白质共存，参与能量代谢'],
      ['硒', '约 12 μg', '抗氧化酶组分'],
    ],
    '蛋白质密度最高的常见肉类之一：24.6 g 蛋白只带 118 kcal，脂肪不到 2 g，减脂期「补蛋白不补热量」的首选。',
    '需要提高蛋白摄入又不想超热量的人；力量训练后补充尤其合适。',
    '生鸡胸偏柴，久煮或高温煎容易变硬，反而让人坚持不下去；建议腌 15 分钟或低温慢煎。',
    '生 118 kcal/100 g；水煮后约 165 kcal/100 g（水分流失、营养浓缩），称重时注意生熟差别。',
  ),
  F(
    '米饭',
    ['白米饭', '熟米饭', '大米饭', '饭'],
    116, 2.6, 25.9, 0.3, 0.3,
    ['1 小碗（约 150 g）', 150],
    { 碗: 150, 小碗: 130, 大碗: 220, 份: 150, 两: 50 },
    [
      ['维生素 B1', '0.02 mg', '精白米加工中损失约 70%，长期只吃白米要注意'],
      ['镁', '15 mg', '参与能量代谢'],
    ],
    '几乎纯淀粉，消化快、饱腹感维持短；热量密度中等但极易吃过量（一碗 150 g 就 174 kcal）。',
    '训练日、需要快速补充糖原时很合适。',
    '减脂期常见问题是「菜少饭多」——先保证菜和蛋白，再定饭量；混一半糙米或杂豆能明显提升纤维和饱腹感。',
    '生米 346 kcal/100 g，熟米饭约 116 kcal/100 g，生熟比约 1:2.3，别把生米重量当熟饭算。',
  ),
  F(
    '全麦面包',
    ['全麦吐司', '黑麦面包', '吐司'],
    246, 8.8, 43.0, 3.5, 6.0,
    ['1 片', 35],
    { 片: 35, 袋: 350 },
    [
      ['膳食纤维', '6 g', '主要是阿拉伯木聚糖，帮助延缓餐后血糖上升'],
      ['维生素 B 族', '约 0.3 mg', '参与碳水代谢'],
      ['镁', '80 mg', '全谷物保留了麸皮中的矿物质'],
    ],
    '比白吐司多 2–3 倍纤维，升糖更平缓；但市售「全麦」很多只加了焦糖色素，要看配料表第一位是不是全麦粉。',
    '早餐主食替换白吐司的首选，也适合做三明治打底。',
    '热量并不比白吐司低（246 vs 280 kcal/100 g 很接近），减脂靠的是饱腹感和纤维，不是「全麦=低卡」。',
  ),
  F(
    '白吐司',
    ['面包', '白面包', '切片面包', '吐司片'],
    280, 8.5, 50.0, 4.5, 2.5,
    ['1 片', 30],
    { 片: 30, 袋: 400 },
    [
      ['钙', '约 40 mg', '强化面粉或加奶的配方会更高'],
      ['钠', '约 480 mg', '面包是「隐形盐」的常见来源之一'],
    ],
    '精制面粉 + 油脂 + 少量糖，热量 280 kcal/100 g，蛋白质只有 8.5 g——它是碳水，不是蛋白来源。',
    '方便、需要快速解决一餐时。',
    '两片白吐司的热量等于一碗半米饭，但饱腹感差得多；夹蛋、夹菜能显著改善这一点。',
  ),
  F(
    '火腿片',
    ['火腿', '午餐肉片', '火腿肠'],
    218, 15.0, 3.0, 16.0, 0,
    ['1 片', 22],
    { 片: 22, 包: 100 },
    [
      ['钠', '约 900 mg', '加工肉制品的主要问题来源'],
      ['维生素 B12', '0.5 μg', '来自动物性原料'],
    ],
    '蛋白不算低但脂肪和钠都偏高，一片 22 g 约 48 kcal，两片就把一个三明治的热量推高近 100 kcal。',
    '偶尔吃、想提升风味时用 1 片即可。',
    '加工肉制品被列为「限制摄入」类别，不建议作为每日蛋白来源；高血压人群尤其注意钠。',
  ),
  F(
    '奶酪片',
    ['芝士', '芝士片', '奶酪', '起司'],
    328, 22.0, 3.5, 26.0, 0,
    ['1 片', 20],
    { 片: 20, 块: 30 },
    [
      ['钙', '约 600 mg', '一片 20 g 约提供 120 mg，接近每日需求的 15%'],
      ['维生素 A', '约 200 μgRAE', '来自乳脂'],
      ['钠', '约 500 mg', '再制奶酪的钠普遍偏高'],
    ],
    '钙密度高，但脂肪占热量 70% 以上，属于「体积小、热量集中」的食物——一片 20 g 就有 66 kcal。',
    '想补钙、或做三明治需要风味时用 1 片。',
    '一次两三片很容易在不知不觉中加进 150–200 kcal；减脂期建议控制在 1 片。',
  ),
  F(
    '牛奶',
    ['全脂牛奶', '纯牛奶', '鲜奶'],
    65, 3.3, 4.8, 3.6, 0,
    ['1 盒 / 1 杯', 250],
    { 杯: 250, 盒: 250, 袋: 200, 毫升: 1, ml: 1 },
    [
      ['钙', '104 mg', '一杯 250 ml 约 260 mg，占每日需求的 1/3'],
      ['维生素 B2', '0.15 mg', '参与能量代谢'],
      ['优质蛋白', '3.3 g', '乳清+酪蛋白组合，饱腹感强'],
    ],
    '液体蛋白+钙的稳定来源，250 ml 只有 163 kcal，是加餐里最容易执行的选择之一。',
    '几乎所有人群；乳糖不耐受者改无乳糖奶或酸奶。',
    '「低脂奶」减的主要是热量（约 100 kcal/250 ml）而非蛋白，减脂期如果当天脂肪已超标，换低脂更划算。',
  ),
  F(
    '无糖豆浆',
    ['豆浆', '豆奶'],
    31, 3.0, 1.2, 1.6, 0.6,
    ['1 杯', 250],
    { 杯: 250, 碗: 250, 袋: 200 },
    [
      ['大豆异黄酮', '约 10 mg', '植物雌激素，对更年期女性骨代谢有一定意义'],
      ['钾', '110 mg', '高于牛奶'],
      ['膳食纤维', '0.6 g', '牛奶没有的部分'],
    ],
    '蛋白密度与牛奶接近但热量更低（31 vs 65 kcal/100 g），适合把早餐热量压下来。',
    '减脂期早餐、乳糖不耐受人群。',
    '「无糖」是关键，市售甜豆浆常加 5–8% 糖，一杯能多出 100 kcal 以上。',
  ),
  F(
    '无糖酸奶',
    ['酸奶', '希腊酸奶', '原味酸奶'],
    72, 3.2, 4.5, 3.7, 0,
    ['1 杯', 150],
    { 杯: 150, 盒: 130, 罐: 200 },
    [
      ['钙', '118 mg', '发酵后钙的吸收率略高于牛奶'],
      ['益生菌', '活菌数不定', '对肠道菌群有潜在益处，但不宜夸大为「调理肠胃治病」'],
    ],
    '蛋白+钙+发酵风味，作为下午加餐比饼干强得多；希腊酸奶蛋白可达 8–10 g/100 g。',
    '想吃甜食又不想超热量时的替代品，加 10 g 坚果或半份水果口感更好。',
    '「风味酸奶」含糖常达 10 g/100 g 以上，务必看配料表；无糖原味才是减脂版。',
  ),
  F(
    '生菜',
    ['球生菜', '生菜叶'],
    15, 1.4, 2.0, 0.2, 1.3,
    ['一把', 50],
    { 把: 50, 片: 10 },
    [
      ['维生素 K', '约 100 μg', '参与凝血与骨代谢，一份即可满足日需'],
      ['叶酸', '约 60 μg', '参与细胞分裂'],
    ],
    '热量密度极低（15 kcal/100 g），主要价值是体积、水分和脆感，让三明治「咬起来满足」。',
    '所有人，尤其是需要增加蔬菜体积但不想加热量时。',
    '不建议靠沙拉酱调味——1 勺沙拉酱 15 g 就有 110 kcal，比整份生菜高 10 倍以上。',
  ),
  F(
    '西兰花',
    ['绿花菜', '青花菜'],
    34, 2.8, 6.6, 0.4, 2.6,
    ['1 份', 150],
    { 份: 150, 朵: 15, 颗: 300 },
    [
      ['维生素 C', '51 mg', '焯水 2 分钟损失约 30%，蒸损失更少'],
      ['维生素 K', '101 μg', '一份 150 g 远超日需'],
      ['萝卜硫素', '含量与品种相关', '十字花科特征成分，研究集中在抗氧化通路，不宜当作治疗手段'],
    ],
    '在蔬菜里蛋白和纤维都算高的（2.8 g 蛋白 + 2.6 g 纤维/100 g），饱腹感强，是减脂餐的标配。',
    '所有人；主食减量时用它填体积最稳。',
    '水煮超过 5 分钟会发黄发软、维生素 C 流失明显，建议蒸 3–4 分钟或焯水后过凉。',
  ),
  F(
    '菠菜',
    ['菠菜叶'],
    28, 2.6, 4.5, 0.3, 1.7,
    ['一把', 100],
    { 把: 100, 份: 100 },
    [
      ['叶酸', '194 μg', '一把 100 g 接近成人日需的一半'],
      ['维生素 K', '483 μg', '远超日需，服用抗凝药者需保持摄入稳定'],
      ['铁', '2.9 mg', '非血红素铁，吸收率低，配维生素 C 可提升'],
      ['草酸', '约 600 mg', '影响钙铁吸收，焯水可去除 50–70%'],
    ],
    '叶酸和维生素 K 密度突出，热量极低；但草酸高，生吃或直接炒会影响矿物质吸收。',
    '需要补叶酸、想吃深色叶菜的人。',
    '肾结石（草酸钙型）病史者要控制量；服用华法林的人不要突然大幅改变菠菜摄入。',
  ),
  F(
    '胡萝卜',
    ['红萝卜', '胡萝卜丝'],
    39, 1.0, 8.8, 0.2, 2.8,
    ['1 根', 120],
    { 根: 120, 个: 120, 份: 80 },
    [
      ['β-胡萝卜素', '约 4100 μg', '按需转化为维生素 A，油炒后吸收率显著提高'],
      ['钾', '190 mg', ''],
      ['膳食纤维', '2.8 g', '以果胶为主'],
    ],
    'β-胡萝卜素的代表食物，碳水略高于叶菜但仍有大量纤维，生吃脆、熟吃甜。',
    '用眼多、想增加蔬菜种类的人。',
    '榨汁会丢掉纤维并让糖分吸收变快，减脂期建议吃整根而不是喝汁。',
  ),
  F(
    '黄瓜',
    ['青瓜'],
    16, 0.8, 2.9, 0.2, 0.5,
    ['1 根', 200],
    { 根: 200, 个: 200, 片: 5 },
    [
      ['钾', '102 mg', ''],
      ['水分', '96 g', '补水与体积感的主要来源'],
    ],
    '95% 以上是水，热量几乎可以忽略，但营养密度也低——它的定位是「占位置」，不是「补营养」。',
    '晚上想吃东西时的替代品，咔嚓感能缓解嘴巴寂寞。',
    '别用「黄瓜减肥法」代替正餐，蛋白质严重不足会导致掉肌肉、掉头发。',
  ),
  F(
    '土豆',
    ['马铃薯', '土豆丝', '薯仔'],
    81, 2.0, 17.8, 0.2, 2.2,
    ['1 个中等', 150],
    { 个: 150, 只: 150, 份: 150 },
    [
      ['钾', '342 mg', '在常见食物里钾含量突出'],
      ['维生素 C', '27 mg', '比多数主食高，但油炸后大幅下降'],
      ['抗性淀粉', '放凉后增加', '冷却的土豆抗性淀粉升高，升糖反应略降'],
    ],
    '被误解的主食：81 kcal/100 g 比米饭（116）还低，饱腹感指数在同类里很高；问题几乎都出在「怎么做」。',
    '想换主食种类、又怕饿的人。',
    '土豆丝、薯条、薯片把热量放大 3–10 倍；蒸煮烤整颗才是减脂版；吃了土豆就要相应减米饭。',
  ),
  F(
    '红薯',
    ['地瓜', '番薯'],
    106, 1.6, 24.6, 0.2, 1.6,
    ['1 个中等', 200],
    { 个: 200, 根: 200, 块: 100 },
    [
      ['β-胡萝卜素', '约 750 μg', '橙心品种含量更高'],
      ['钾', '130 mg', ''],
      ['膳食纤维', '1.6 g', '含果胶，蒸后更易消化'],
    ],
    '甜但升糖并不算高（蒸煮 GI 约 55–70），纤维和钾都不错，是很好的主食替换项。',
    '想吃甜味主食的人；便秘时也有效。',
    '烤红薯 GI 更高、更易吃过量；一次 200 g 已相当于一碗饭的热量，别当「零食」额外吃。',
  ),
  F(
    '香蕉',
    ['芭蕉'],
    93, 1.4, 22.0, 0.2, 1.2,
    ['1 根中等', 100],
    { 根: 100, 个: 100, 把: 500 },
    [
      ['钾', '358 mg', '运动后补钾的常见选择'],
      ['维生素 B6', '0.4 mg', '参与蛋白与糖原代谢'],
      ['抗性淀粉', '青香蕉更高', '成熟后转成糖，甜度上升'],
    ],
    '碳水密度不低（22 g/100 g），但携带方便、含钾，训练前后吃比当零食吃更合理。',
    '运动前后、早餐搭配蛋白时。',
    '一根中等香蕉约 93 kcal，两根就接近一碗饭；减脂期当加餐建议半根到一根。',
  ),
  F(
    '苹果',
    ['红富士', '青苹果'],
    53, 0.4, 13.7, 0.2, 1.7,
    ['1 个中等', 200],
    { 个: 200, 只: 200, 斤: 500 },
    [
      ['膳食纤维', '1.7 g', '果胶为主，主要在皮里'],
      ['维生素 C', '4 mg', '含量并不高，别指望靠苹果补 C'],
      ['多酚', '含量与品种相关', '抗氧化，但不足以抵消其他饮食问题'],
    ],
    '水分和纤维带来的饱腹感不错，但「一天一苹果」不能替代蔬菜——维生素和矿物质种类差得远。',
    '想吃甜食时的替代选项。',
    '榨汁等于喝糖水（丢掉纤维、升糖变快）；一个 200 g 苹果约 106 kcal，一天 1–2 个足够。',
  ),
  F(
    '牛肉',
    ['瘦牛肉', '牛里脊', '牛腱'],
    106, 20.2, 1.2, 2.3, 0,
    ['1 份', 120],
    { 份: 120, 块: 50, 片: 20 },
    [
      ['血红素铁', '2.8 mg', '吸收率约 15–25%，远高于植物铁'],
      ['锌', '3.7 mg', '参与免疫与蛋白合成'],
      ['维生素 B12', '1.8 μg', '几乎只存在于动物性食物'],
    ],
    '蛋白高、脂肪低（瘦部位），铁锌密度是植物性食物难替代的，减脂期红肉每周 2–3 次较合理。',
    '女性、易缺铁人群、力量训练者。',
    '「雪花牛肉」「肥牛卷」脂肪可达 20–30 g/100 g，热量翻倍；选里脊、腱子、后腿更稳。',
  ),
  F(
    '猪里脊',
    ['里脊肉', '瘦猪肉'],
    155, 20.2, 0.7, 7.9, 0,
    ['1 份', 100],
    { 份: 100, 块: 50, 片: 20 },
    [
      ['维生素 B1', '0.5 mg', '猪肉是 B1 的最好来源之一'],
      ['锌', '2.3 mg', ''],
      ['铁', '1.5 mg', '血红素铁'],
    ],
    '猪肉里最瘦的部位，蛋白 20 g/100 g；比五花肉（395 kcal）低一半以上热量，是「吃猪肉」的正确打开方式。',
    '想吃猪肉又怕热量的人。',
    '「里脊」常被用来做糖醋、锅包肉，一裹粉一油炸热量就翻 2–3 倍，做法比部位更关键。',
  ),
  F(
    '五花肉',
    ['肥肉', '三层肉', '红烧肉'],
    395, 14.0, 0, 37.0, 0,
    ['1 份', 80],
    { 份: 80, 块: 30, 片: 15 },
    [
      ['脂肪', '37 g', '其中饱和脂肪约 13 g'],
      ['维生素 B1', '0.3 mg', ''],
    ],
    '热量密度极高：100 g 就 395 kcal，接近一顿减脂午餐的全部预算。',
    '偶尔解馋，控制在 50 g 以内。',
    '红烧做法通常再加糖和油，一份红烧肉常在 600–800 kcal；减脂期建议每月 1–2 次而非每周。',
  ),
  F(
    '三文鱼',
    ['鲑鱼', '挪威三文鱼'],
    139, 17.2, 0, 7.8, 0,
    ['1 份', 120],
    { 份: 120, 块: 100, 片: 20 },
    [
      ['EPA/DHA', '约 1.8 g', 'Omega-3 长链脂肪酸，与血脂和炎症反应相关'],
      ['维生素 D', '约 11 μg', '天然食物中少见的维生素 D 来源'],
      ['虾青素', '含量与养殖方式相关', '使鱼肉呈橙红色'],
    ],
    '少见的「高蛋白 + 有益脂肪」组合，7.8 g 脂肪里大部分是不饱和的，饱腹感和风味都好。',
    '想改善脂肪质量、不爱吃鸡胸的人。',
    '热量比鸡胸高约 20%，但脂肪质量不同；避免用大量黄油煎，否则优点会被抵消。',
  ),
  F(
    '虾',
    ['基围虾', '白虾', '虾仁'],
    93, 18.6, 2.8, 0.8, 0,
    ['1 份', 100],
    { 只: 12, 份: 100, 斤: 500 },
    [
      ['硒', '约 33 μg', '抗氧化酶组分'],
      ['碘', '含量随产地差异大', '近海虾是碘的来源之一'],
      ['胆固醇', '约 190 mg', '但膳食胆固醇对血脂影响小于饱和脂肪'],
    ],
    '蛋白 18.6 g 只带 93 kcal，脂肪不到 1 g，是「高蛋白低热」的另一个极端选择。',
    '需要换口味的高蛋白需求者。',
    '油焖、椒盐、蒜蓉开背做法用油量常达 15–25 g，热量直接翻倍；白灼、清蒸最稳。',
  ),
  F(
    '豆腐',
    ['北豆腐', '老豆腐', '南豆腐', '嫩豆腐'],
    116, 12.2, 3.0, 4.8, 0.5,
    ['1 块', 150],
    { 块: 150, 份: 100 },
    [
      ['钙', '138 mg', '卤水/石膏点制的钙含量高于内酯豆腐'],
      ['大豆异黄酮', '约 20 mg', '植物雌激素，适量摄入对骨代谢有益'],
      ['植物蛋白', '12.2 g', '氨基酸组成较完整'],
    ],
    '植物蛋白里少见的「完整氨基酸 + 高钙」组合，适合作为部分肉类的替代。',
    '素食者、想降低饱和脂肪摄入的人。',
    '内酯豆腐钙含量只有北豆腐的 1/5 左右；麻婆豆腐、红烧豆腐的油和盐常是主要热量来源。',
  ),
  F(
    '食用油',
    ['食用油', '花生油', '橄榄油', '菜籽油', '大豆油', '玉米油', '色拉油', '葵花籽油', '猪油', '黄油'],
    899, 0, 0, 99.9, 0,
    ['1 勺', 10],
    { 勺: 10, 汤匙: 10, 茶匙: 5, 克: 1, g: 1 },
    [
      ['维生素 E', '约 15 mg', '植物油是主要来源'],
      ['不饱和脂肪', '占比 80% 以上', '替代饱和脂肪对血脂更友好'],
    ],
    '纯脂肪，899 kcal/100 g——一勺 10 g 就是 90 kcal，比 100 g 西红柿高 4.5 倍。减脂期最大的隐形热量来源。',
    '必需，但要计量。',
    '「健康油」不等于低热量，橄榄油一样是 899 kcal/100 g；外食的炒菜用油常在 15–30 g/份。',
  ),
  F(
    '沙拉酱',
    ['蛋黄酱', '美乃滋', '千岛酱'],
    724, 1.5, 3.0, 78.0, 0,
    ['1 勺', 15],
    { 勺: 15, 汤匙: 15 },
    [
      ['脂肪', '78 g', '以植物油为主'],
      ['钠', '约 600 mg', ''],
    ],
    '78% 是脂肪，一勺 15 g 约 110 kcal——一份看起来很「轻」的沙拉，常常因为两勺酱变成 400 kcal。',
    '想调味时用 1 茶匙（5 g）以内。',
    '减脂期最容易被忽略的热量陷阱；换成无糖酸奶 + 芥末 + 柠檬汁，热量能降到 1/10。',
  ),
  F(
    '挂面',
    ['面条', '挂面', '干面', '拌面', '刀削面', '阳春面', '炒面'],
    286, 10.3, 74.5, 0.6, 0.8,
    ['1 把（干重）', 100],
    { 把: 100, 份: 80, 碗: 100, 克: 1 },
    [
      ['钠', '约 200 mg', '挂面制作常加盐，煮面水会带走一部分'],
      ['维生素 B1', '0.2 mg', ''],
    ],
    '干重热量高（286 kcal/100 g），煮熟吸水后约 110 kcal/100 g；一碗面 100 g 干面就是 286 kcal，还没算浇头。',
    '主食替换，但要注意份量和浇头。',
    '拌面的酱料（芝麻酱、葱油、辣椒油）常再加 150–300 kcal；建议面 80 g 干重 + 大量蔬菜 + 一份蛋白。',
    '生 286 kcal/100 g，煮熟约 110 kcal/100 g（吸水约 2.5 倍），称重时说明生熟。',
  ),
  F(
    '馒头',
    ['白馒头', '花卷'],
    223, 7.0, 47.0, 1.1, 1.3,
    ['1 个', 100],
    { 个: 100, 只: 100 },
    [
      ['维生素 B1', '0.05 mg', '发酵后略有增加'],
      ['钠', '约 165 mg', ''],
    ],
    '纯碳水主食，一个 100 g 约 223 kcal，饱腹感不如同热量米饭（体积更小）。',
    '早餐主食，配蛋白和蔬菜。',
    '一个馒头常被当成「没吃多少」，实际热量等于一碗半米饭。',
  ),
  F(
    '水饺',
    ['饺子', '猪肉水饺', '速冻饺子'],
    240, 9.0, 28.0, 10.0, 1.0,
    ['1 个', 20],
    { 个: 20, 只: 20, 盘: 300 },
    [
      ['钠', '约 500 mg', '馅料调味+蘸料叠加'],
      ['蛋白质', '9 g', '肉馅提供，但低于同重量纯肉'],
    ],
    '皮是精制碳水、馅含肥肉，10 个约 480 kcal，接近一顿减脂午餐；好处是「蛋白+碳水+菜」一体，容易控制份量。',
    '想吃面食又想要蛋白的人，10–12 个配一碗蔬菜汤较合理。',
    '蘸料（醋+辣椒油）会额外加油；煎饺比水饺多 30% 以上热量。',
  ),
  F(
    '燕麦片',
    ['燕麦', '即食燕麦', '燕麦粥'],
    377, 15.0, 66.0, 6.7, 10.0,
    ['1 份（干重）', 40],
    { 份: 40, 勺: 10, 杯: 80 },
    [
      ['β-葡聚糖', '约 4 g', '可溶性纤维，有助延缓餐后血糖上升、结合胆汁酸'],
      ['镁', '177 mg', '全谷物中含量较高'],
      ['铁', '4.7 mg', '植物铁，配维生素 C 提升吸收'],
    ],
    '纤维密度突出（10 g/100 g），β-葡聚糖是它区别于其他主食的核心；40 g 干燕麦约 151 kcal，饱腹感能撑 3 小时以上。',
    '早餐想吃得抗饿、血糖波动大的人。',
    '「水果燕麦」「坚果燕麦」常加糖和油，热量可达 450 kcal/100 g；选配料表只有燕麦的。',
  ),
  F(
    '坚果',
    ['混合坚果', '每日坚果', '核桃', '杏仁', '腰果', '巴旦木'],
    600, 20.0, 20.0, 50.0, 8.0,
    ['1 小把', 15],
    { 把: 15, 小把: 15, 颗: 2, 袋: 25 },
    [
      ['不饱和脂肪', '约 35 g', '以单不饱和、多不饱和为主'],
      ['维生素 E', '约 8 mg', '抗氧化'],
      ['镁', '约 200 mg', ''],
    ],
    '热量密度最高的「健康食物」：600 kcal/100 g，一小把 15 g 就有 90 kcal，但蛋白、纤维、镁、维生素 E 都密集。',
    '作为加餐替代饼干很合适，前提是**称重**。',
    '「每日坚果」一袋 25 g 约 150 kcal，边看剧边吃三袋就是 450 kcal；这是减脂期最常见的失控点之一。',
  ),
  F(
    '奶茶',
    ['珍珠奶茶', '波霸奶茶', '全糖奶茶'],
    70, 1.0, 13.0, 1.8, 0,
    ['1 杯中杯（500 ml）', 500],
    { 杯: 500, 大杯: 700, 中杯: 500 },
    [
      ['添加糖', '约 50 g', '一杯全糖常超过每日建议上限（25–50 g）'],
      ['咖啡因', '含量不定', ''],
    ],
    '液体热量：500 ml 全糖奶茶约 350 kcal，加珍珠再 +150 kcal，喝下去几乎没有饱腹感。',
    '偶尔喝，选无糖/三分糖、不加料。',
    '「无糖」奶茶仍有奶精和珍珠的热量；奶精含反式脂肪，选鲜奶茶更好。',
  ),
  F(
    '可乐',
    ['汽水', '碳酸饮料', '雪碧'],
    43, 0, 10.6, 0, 0,
    ['1 罐', 330],
    { 罐: 330, 瓶: 500, 杯: 250 },
    [
      ['添加糖', '10.6 g', '一罐 330 ml 约 35 g 糖'],
      ['磷', '约 10 mg', '可乐含磷酸'],
    ],
    '纯糖液体：一罐 330 ml 约 142 kcal，零饱腹感，是「液体热量」的典型。',
    '不建议日常饮用；换零度可乐可省下这部分热量。',
    '「果汁饮料」并不比可乐好，含糖量接近；真正的水果才有纤维。',
  ),
  F(
    '白粥',
    ['粥', '大米粥', '稀饭'],
    46, 1.1, 9.8, 0.2, 0.1,
    ['1 碗', 250],
    { 碗: 250, 小碗: 200 },
    [
      ['水分', '88 g', ''],
      ['维生素 B1', '微量', '久煮损失'],
    ],
    '热量低（46 kcal/100 g）但营养密度也低，主要是水和糊化淀粉；升糖快、饱腹感维持短。',
    '胃口不好、需要易消化时。',
    '「喝粥养胃」被过度神化；减脂期把粥当正餐会导致蛋白严重不足、两小时就饿。',
  ),
  F(
    '鸡腿',
    ['鸡腿肉', '琵琶腿'],
    181, 16.0, 0, 13.0, 0,
    ['1 个', 100],
    { 个: 100, 只: 100, 份: 100 },
    [
      ['铁', '1.3 mg', '高于鸡胸'],
      ['锌', '1.3 mg', ''],
      ['脂肪', '13 g', '主要在皮和皮下'],
    ],
    '带皮鸡腿 181 kcal/100 g，去皮后约 120 kcal——比鸡胸香、比五花肉瘦，是「好吃与热量」的中间选项。',
    '觉得鸡胸太柴、坚持不下去的人。',
    '油炸（炸鸡）会到 250–300 kcal/100 g；卤、烤、去皮炖更合适。',
  ),
  F(
    '培根',
    ['烟肉', '培根片'],
    181, 22.0, 1.5, 10.0, 0,
    ['1 片', 15],
    { 片: 15, 条: 15 },
    [
      ['钠', '约 1200 mg', '极高，一片约 180 mg'],
      ['脂肪', '10 g', '饱和脂肪占比高'],
      ['亚硝酸盐', '加工肉制品特征', '高温煎会产生亚硝胺'],
    ],
    '蛋白密度不低但钠和脂肪都高，且属加工肉制品，一片 15 g 约 27 kcal——问题不在单片，在于通常一次吃 3–4 片。',
    '偶尔提味，一次 1–2 片。',
    '世界卫生组织将加工肉制品列为 1 类致癌物（指证据强度，不是风险大小），建议限制而非日常食用。',
  ),
]

const FOOD_INDEX: Array<{ food: DemoFood; key: string }> = DEMO_FOODS.flatMap((food) =>
  [food.name, ...food.aliases].map((key) => ({ food, key })),
).sort((a, b) => b.key.length - a.key.length)

/** 按关键词找食物，长词优先（避免「牛奶」吃掉「无糖豆浆」这类误匹配） */
function findFoods(text: string): DemoFood[] {
  const hits: DemoFood[] = []
  let rest = text
  for (const { food, key } of FOOD_INDEX) {
    if (rest.includes(key) && !hits.some((h) => h.name === food.name)) {
      hits.push(food)
      rest = rest.replace(key, ' ')
    }
  }
  return hits
}

/* ------------------------------- 份量与做法 ------------------------------- */

const CN_NUM: Record<string, number> = {
  半: 0.5, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

interface Parsed {
  grams: number
  /** 这个克数是怎么来的，写进「估算依据」 */
  basis: string
  /** 用户是否明确给了重量 */
  explicit: boolean
}

interface ParsedItem extends Parsed {
  food: DemoFood
}

interface RawAmount {
  index: number
  value: number
  unit: string
}

const WEIGHT_UNITS = ['g', '克', 'ml', '毫升']

/** 扫出句子里所有「数量 + 单位」，并记住位置，用来把数量分给正确的食材 */
function scanAmounts(text: string): RawAmount[] {
  const out: RawAmount[] = []
  const re = /(\d+(?:\.\d+)?|[半一两二三四五六七八九十])\s*(g|克|ml|毫升|个|只|片|碗|杯|根|块|勺|把|盒|袋|颗|张|条|盘|枚|罐|瓶)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const raw = m[1]
    const value = Number.isFinite(Number(raw)) ? Number(raw) : CN_NUM[raw] ?? 1
    out.push({ index: m.index, value, unit: m[2].toLowerCase() })
  }
  return out
}

/** 食物在句子里第一次出现的位置；找不到就当 0 */
function foodPos(text: string, food: DemoFood): number {
  let best = -1
  for (const key of [food.name, ...food.aliases]) {
    const i = text.indexOf(key)
    if (i >= 0 && (best < 0 || i < best)) best = i
  }
  return best < 0 ? 0 : best
}

/** 某个食材没给可识别重量时的兜底，并说明假设 */
function fallbackAmount(food: DemoFood, hint?: string): Parsed {
  return {
    grams: food.portion.grams,
    basis: hint ?? `没写重量，按${food.portion.label}约 ${food.portion.grams} g 估`,
    explicit: false,
  }
}

/**
 * 把一句话拆成「食材 + 克数」。
 * ★ 关键：数量要按**位置最近**分配给对应食材，否则「两个鸡蛋加一片面包」
 *   会把「两个」套到面包上，热量和营养素就全错了。
 */
function parseItems(question: string, foods: DemoFood[]): ParsedItem[] {
  const tokens = scanAmounts(question)
  const used = new Set<number>()

  return foods.map((food) => {
    const pos = foodPos(question, food)
    let pick = -1
    let bestDist = Infinity
    tokens.forEach((t, i) => {
      if (used.has(i)) return
      const d = Math.abs(t.index - pos)
      if (d < bestDist) {
        bestDist = d
        pick = i
      }
    })

    /* 距离超过 14 个字就不认，避免把「我今年 32 岁」里的数字当成重量 */
    if (pick < 0 || bestDist > 14) return { food, ...fallbackAmount(food) }

    const t = tokens[pick]
    used.add(pick)

    if (WEIGHT_UNITS.includes(t.unit)) {
      return { food, grams: t.value, basis: `你给的 ${t.value} g`, explicit: true }
    }

    const per = food.units?.[t.unit]
    if (per) {
      const grams = Math.round(t.value * per)
      return { food, grams, basis: `${t.value} ${t.unit} × ${per} g/${t.unit}`, explicit: true }
    }

    /* 单位不认识（比如面包说「2 个」），退回默认份量并如实说明 */
    return {
      food,
      ...fallbackAmount(food, `「${t.value} ${t.unit}」这个单位对它不常用，按${food.portion.label}≈${food.portion.grams} g 处理，给克数更准`),
    }
  })
}

interface Cooking {
  label: string
  factor: number
  /** 额外吸附/加入的油，克 */
  oil: number
  keyword: string
}

const COOKING_RULES: Array<{ keys: string[]; label: string; factor: number; oil: number }> = [
  { keys: ['油炸', '炸', '天妇罗', '油条'], label: '油炸', factor: 1.35, oil: 8 },
  { keys: ['红烧', '干锅', '糖醋', '爆炒', '回锅'], label: '红烧/干锅', factor: 1.2, oil: 10 },
  { keys: ['炒', '煎', '煸', '爆香'], label: '炒/煎', factor: 1.1, oil: 7 },
  { keys: ['烤', '焗', '空气炸'], label: '烤', factor: 1.05, oil: 1 },
  { keys: ['蒸', '煮', '白灼', '焯', '水煮'], label: '蒸/煮', factor: 1.0, oil: 0 },
]

function parseCooking(text: string): Cooking | null {
  for (const rule of COOKING_RULES) {
    const hit = rule.keys.find((k) => text.includes(k))
    if (hit) return { label: rule.label, factor: rule.factor, oil: rule.oil, keyword: hit }
  }
  return null
}

/** 额外加的油：一勺、两勺、放了很多油 */
function parseOil(text: string): number {
  if (/很多油|大量油|宽油|半锅油/.test(text)) return 20
  const m = text.match(/(\d+(?:\.\d+)?|[半一两二三])\s*(?:勺|汤匙|匙)\s*(?:油|食用油|橄榄油|花生油)?/)
  if (m) {
    const n = Number.isFinite(Number(m[1])) ? Number(m[1]) : CN_NUM[m[1]] ?? 1
    return Math.round(n * 10)
  }
  return 0
}

/* ------------------------------- 本机真实数据 ------------------------------- */

interface RealContext {
  nick: string
  gender: 'male' | 'female'
  age: number
  height: number
  weight: number
  bmiValue: number
  bmiLabel: string
  bmr: number
  tdee: number
  targetWeight: number | null
  proteinTarget: number
  minIntake: number
  today: { kcal: number; protein: number; fiber: number; items: number }
  avg7: { kcal: number; protein: number; fiber: number; days: number } | null
  vegDays: number
  mealHint: string
}

function readRealContext(): RealContext {
  const profile = getProfile()
  const settings = getSettings()
  const plan = getPlan()
  const today = localDateStr(new Date())
  const from = shiftDate(today, -6)

  const bmr = calcBmr(profile, settings, new Date()).bmr
  const factor = ACTIVITY_LEVELS[settings.energy.activityLevel]?.factor ?? 1.3
  const weight = weightOn(today).weight_kg
  const bmiValue = bmi(weight, profile.height_cm)
  const goal = getActiveGoal()

  const t = db
    .prepare(
      `SELECT COALESCE(SUM(kcal),0) AS kcal, COALESCE(SUM(protein),0) AS protein,
              COALESCE(SUM(fiber),0) AS fiber, COUNT(*) AS items
       FROM diet_entries WHERE date = ?`,
    )
    .get(today) as { kcal: number; protein: number; fiber: number; items: number }

  const days = db
    .prepare(
      `SELECT date, SUM(kcal) AS kcal, SUM(protein) AS protein, SUM(fiber) AS fiber
       FROM diet_entries WHERE date >= ? AND date <= ? GROUP BY date`,
    )
    .all(from, today) as { date: string; kcal: number; protein: number; fiber: number }[]

  const workouts = db
    .prepare(`SELECT COALESCE(SUM(kcal),0) AS kcal FROM workouts WHERE date >= ? AND date <= ?`)
    .get(from, today) as { kcal: number }

  const avg7 = days.length
    ? {
        kcal: Math.round(days.reduce((s, d) => s + d.kcal, 0) / days.length),
        protein: round(days.reduce((s, d) => s + d.protein, 0) / days.length, 1),
        fiber: round(days.reduce((s, d) => s + d.fiber, 0) / days.length, 1),
        days: days.length,
      }
    : null

  const vegDays = days.filter((d) => d.fiber >= 15).length
  const hour = new Date().getHours()
  const mealHint =
    hour < 10 ? '早餐' : hour < 14 ? '午餐' : hour < 17 ? '下午加餐' : hour < 21 ? '晚餐' : '睡前'

  return {
    nick: profile.nickname || '你',
    gender: profile.gender,
    age: ageFromBirth(profile.birth_date),
    height: profile.height_cm,
    weight,
    bmiValue,
    bmiLabel: bmiCategory(bmiValue).label,
    bmr: Math.round(bmr),
    tdee: round(bmr * factor + workouts.kcal / 7),
    targetWeight: goal?.target_weight ?? null,
    proteinTarget: round(weight * settings.energy.proteinPerKg, 1),
    minIntake: profile.gender === 'male' ? settings.energy.minIntakeMale : settings.energy.minIntakeFemale,
    today: { kcal: Math.round(t.kcal), protein: round(t.protein, 1), fiber: round(t.fiber, 1), items: t.items },
    avg7,
    vegDays,
    mealHint: `${mealHint}（${plan.dinner_time} 晚餐，${plan.sleep_time} 睡）`,
  }
}

/* ------------------------------- 文案拼装 ------------------------------- */

const REF = { protein: 60, carb: 275, fat: 60, fiber: 25 }

function pct(value: number, ref: number): string {
  return `${Math.round((value / ref) * 100)}%`
}

function num(v: number, digits = 1): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(digits)
}

const DEMO_BANNER = `> 演示模式 · 以下由本机内置营养样例生成，用于预览输出格式，不是真实大模型的结果。换成免费模型后同样的问法会得到更完整的推理。

`

function notFoundBlock(question: string, ctx: RealContext): string {
  const covered = DEMO_FOODS.slice(0, 12)
    .map((f) => f.name)
    .join('、')
  return `你问的是「${question}」，但演示模式内置的食物表里没有匹配到对应条目。

## 演示模式能做什么
- 已内置 ${DEMO_FOODS.length} 种常见食物：${covered} 等
- 能算份量换算（「两个」「一碗」「150 g」）、能区分生熟、能叠加烹饪用油
- 会真的读你的档案和记录，所以「我今天蛋白还差多少」这类问题是准的

## 想要真正什么都能问
演示模式的边界就是内置表。换成下面任一个**免费**的真实模型后，你问「凉拌木耳多少卡」「学校食堂的土豆烧牛肉」它也能推理：

| 平台 | 费用 | 需要做什么 |
| --- | --- | --- |
| 智谱 GLM-4-Flash | 永久免费 | 手机号注册拿 Key，填入「助手设置」 |
| 本地 Ollama | 完全免费 | 装 Ollama 后执行 \`ollama pull qwen2.5:7b\` |
| 火山方舟（豆包） | 每天 200 万 token 免费 | 注册并手动开通模型 |

以你现在的数据（${ctx.weight} kg，BMR ${ctx.bmr} kcal，日均总消耗约 ${ctx.tdee} kcal），先告诉我具体吃了什么，我可以按同样格式算给你看。`
}

/** 单食物分析：主力分支 */
function foodBlock(foods: DemoFood[], question: string, ctx: RealContext): string {
  /* 按食材在句子里出现的先后排序，标题读起来跟说话顺序一致 */
  const items = parseItems(question, foods).sort((a, b) => foodPos(question, a.food) - foodPos(question, b.food))
  const main = items[0].food
  const others = items.slice(1).map((i) => i.food)
  const cook = parseCooking(question)
  const extraOil = parseOil(question)
  const oilFromUser = extraOil > 0

  /* 本身是纯脂肪的食物（油、沙拉酱）不再套烹饪系数、也不叠加「另外用油」，否则算两遍 */
  const isPureFat = main.name === '食用油' || main.name === '沙拉酱'

  /* 同一锅炒的所有食材都套同一个系数；油只加一次 */
  const factor = !isPureFat && cook && cook.factor > 1 ? cook.factor : 1
  const oilGram = isPureFat ? 0 : Math.max(cook?.oil ?? 0, extraOil)
  const oilKcal = oilGram * 9

  const calc = items.map((it) => ({
    ...it,
    kcal: Math.round(((it.food.kcal * it.grams) / 100) * factor),
    protein: ((it.food.protein * it.grams) / 100) * factor,
    carb: ((it.food.carb * it.grams) / 100) * factor,
    fat: ((it.food.fat * it.grams) / 100) * factor,
    fiber: (it.food.fiber * it.grams) / 100,
  }))

  const grand = Math.round(calc.reduce((s, c) => s + c.kcal, 0) + oilKcal)
  const protein = round(calc.reduce((s, c) => s + c.protein, 0), 1)
  const carb = round(calc.reduce((s, c) => s + c.carb, 0), 1)
  const fat = round(calc.reduce((s, c) => s + c.fat, 0) + oilGram, 1)
  const fiber = round(calc.reduce((s, c) => s + c.fiber, 0), 1)

  const headline = calc.map((c) => `${c.food.name} ${c.grams} g`).join(' + ')

  /* 第二块：营养表 */
  const macroRows: Array<[string, string, string, string]> = [
    ['蛋白质', `${num(protein)} g`, pct(protein, REF.protein), '构成肌肉与酶，减脂期最该盯住的指标'],
    ['碳水化合物', `${num(carb)} g`, pct(carb, REF.carb), '主要供能来源，影响饱腹时长与训练表现'],
    ['脂肪', `${num(fat)} g`, pct(fat, REF.fat), '激素合成与脂溶性维生素吸收所需'],
    ['膳食纤维', `${num(fiber)} g`, pct(fiber, REF.fiber), '延缓胃排空、平稳血糖、喂养肠道菌群'],
  ]
  const microTable = main.micros
    .slice(0, 3)
    .map(([name, per100, role]) => `| ${name} | ${per100}（每 100 g） | ${role} |`)
    .join('\n')

  /* 第四块：结合目标的建议 —— 用真实数据算 */
  const remainder = Math.max(0, ctx.tdee - ctx.today.kcal)
  const proteinGap = Math.max(0, round(ctx.proteinTarget - ctx.today.protein, 1))
  const share = Math.round((grand / Math.max(1, ctx.tdee)) * 100)

  const suggests: string[] = []
  if (!ctx.today.items) {
    /* 缺口 300–500 kcal 反推摄入区间，同时不能跌破个人摄入下限 */
    const lo = Math.max(ctx.minIntake, ctx.tdee - 500)
    const hi = Math.max(lo + 100, ctx.tdee - 300)
    suggests.push(
      `你今天还没有任何饮食记录。按你的总消耗 ${ctx.tdee} kcal 算，全天摄入落在 **${lo}–${hi} kcal** 比较稳（对应缺口 300–500 kcal，且不低于你的下限 ${ctx.minIntake} kcal）。这一份 ${grand} kcal，占全天预算的 ${share}%。`,
    )
  } else {
    suggests.push(
      `你今天已记录 ${ctx.today.kcal} kcal，还剩约 **${remainder} kcal** 预算。这一份 ${grand} kcal，占比 ${share}%，${share > 40 ? '偏大——它基本吃掉了一餐的份额，建议相应减少主食或其他油脂。' : share > 20 ? '属于正常一餐的量级。' : '很轻，适合当加餐或配菜，注意别因此漏掉蛋白。'}`,
    )
  }
  if (proteinGap > 5) {
    suggests.push(
      `你的蛋白目标是 ${ctx.proteinTarget} g/天（按 ${ctx.weight} kg × 1.6 g），今天还差 **${proteinGap} g**。这份提供 ${num(protein)} g，${protein > 15 ? '是不错的补充，还能再补一份更好（如 200 g 无糖酸奶）。' : '还不够一顿的蛋白量，建议再搭配一份高蛋白食材。'}`,
    )
  } else if (ctx.today.items) {
    suggests.push(`你今天蛋白已达 ${ctx.today.protein} g，接近目标 ${ctx.proteinTarget} g，保持这个节奏即可，不必再加蛋白粉。`)
  }
  if (fiber < 3 && !['西红柿', '黄瓜', '生菜'].includes(main.name)) {
    suggests.push(`这份纤维只有 ${num(fiber)} g，建议配一份深色叶菜（150 g 西兰花或菠菜），把这一餐的纤维拉到 5 g 以上。`)
  }
  if (oilGram >= 7) {
    suggests.push(
      `这份用了约 ${oilGram} g 油，贡献 **${oilKcal} kcal**，占总热量的 ${Math.round((oilKcal / Math.max(1, grand)) * 100)}%。想减热量优先减油（换成不粘锅 + 喷油壶能省一半），不要减蛋白。`,
    )
  }
  if (!others.length && oilGram > 0 && !isPureFat) {
    suggests.push(
      `我只算了「${main.name} + ${oilGram} g 油」。如果这其实是一道菜（西红柿炒蛋、青椒肉丝这种），把其他食材和用量一起告诉我——只算其中一样会明显低估整盘菜的热量。`,
    )
  }
  if (isPureFat) {
    suggests.push(`把它当「调味成本」单独记账比较可靠：外食的炒菜用油通常按 15 g/份估更接近真实。`)
  }

  const lines: string[] = []
  lines.push(`## 1. 热量与估算依据`)
  lines.push('')
  lines.push(`**${headline} ≈ ${grand} kcal**${cook && cook.factor > 1 ? `（按${cook.label}算）` : ''}`)
  lines.push('')
  lines.push('| 食材 | 重量（依据） | 基准热量 | 这一份 |')
  lines.push('| --- | --- | --- | --- |')
  for (const c of calc) {
    lines.push(`| ${c.food.name} | ${c.grams} g（${c.basis}） | ${c.food.kcal} kcal/100 g | ${c.kcal} kcal |`)
  }
  if (factor > 1 && cook) {
    lines.push(`| ${cook.label}系数 | ×${factor} | 含吸油与水分流失 | 已计入上方 |`)
  }
  if (oilGram > 0) {
    lines.push(`| 另外用油 | ${oilGram} g${oilFromUser ? '' : '（你没说用量，按炒制默认估）'} | 9 kcal/g | +${oilKcal} kcal |`)
  }
  lines.push(`| **合计** | | | **${grand} kcal** |`)
  lines.push('')

  const assumptions = calc.filter((c) => !c.explicit)
  if (assumptions.length) {
    lines.push(
      `> 假设：${assumptions.map((c) => `「${c.food.name}」${c.basis}`).join('；')}。实际大小差别大就告诉我克数，我重算。`,
    )
    lines.push('')
  }
  if (main.cookedNote) {
    lines.push(`> 生熟提醒：${main.cookedNote}`)
    lines.push('')
  }

  lines.push(`## 2. 主要营养成分与营养价值`)
  lines.push('')
  lines.push('| 营养素 | 这一份含量 | 占每日参考 | 作用 |')
  lines.push('| --- | --- | --- | --- |')
  for (const [name, value, p, role] of macroRows) lines.push(`| ${name} | ${value} | ${p} | ${role} |`)
  if (microTable) {
    lines.push('')
    lines.push(`这份食物值得单独看的是：`)
    lines.push('')
    lines.push('| 代表性成分 | 含量 | 在这份食物里的作用 |')
    lines.push('| --- | --- | --- |')
    lines.push(microTable)
  }
  lines.push('')
  lines.push('（参考值按成人 2000 kcal / 蛋白 60 g / 纤维 25 g 计，你的个人目标见第 4 段。）')

  lines.push('')
  lines.push(`## 3. 营养特点与注意事项`)
  lines.push('')
  lines.push(`**特点**：${main.trait}`)
  lines.push('')
  lines.push(`**适合**：${main.good}`)
  lines.push('')
  lines.push(`**注意**：${main.caution}`)
  if (others.length) {
    lines.push('')
    lines.push(`另外你提到的 ${others.map((f) => f.name).join('、')} 也一起算进上面的热量和营养了，单独看它们的特点：`)
    for (const f of others) lines.push(`- **${f.name}**：${f.trait}`)
  }

  lines.push('')
  lines.push(`## 4. 结合你目标的建议`)
  lines.push('')
  lines.push(`你的情况：${ctx.age} 岁，${ctx.height} cm，${ctx.weight} kg，BMI ${ctx.bmiValue}（${ctx.bmiLabel}）；BMR ${ctx.bmr} kcal，日均总消耗约 ${ctx.tdee} kcal。`)
  lines.push('')
  for (const s of suggests) lines.push(`- ${s}`)
  lines.push('')
  lines.push(`> 以上热量与营养值为估算，不能替代医学或临床营养建议。`)

  return lines.join('\n')
}

/** 整体饮食结构分析：读真实记录 */
function patternBlock(question: string, ctx: RealContext): string {
  const lines: string[] = []
  const avg = ctx.avg7
  const gap = avg ? Math.round(avg.kcal - ctx.tdee) : 0

  lines.push(`## 1. 你现在的实际情况（记录值）`)
  lines.push('')
  lines.push('| 项目 | 数值 | 判断 |')
  lines.push('| --- | --- | --- |')
  lines.push(`| 身高 / 体重 / BMI | ${ctx.height} cm / ${ctx.weight} kg / ${ctx.bmiValue} | ${ctx.bmiLabel} |`)
  lines.push(`| 基础代谢 BMR | ${ctx.bmr} kcal | Mifflin-St Jeor 公式 |`)
  lines.push(`| 日均总消耗 TDEE | ${ctx.tdee} kcal | 含日常活动与运动，已避免重复计算 |`)
  lines.push(`| 今日已摄入 | ${ctx.today.kcal} kcal（${ctx.today.items} 条记录） | 蛋白 ${ctx.today.protein} g / 纤维 ${ctx.today.fiber} g |`)
  if (avg) {
    lines.push(`| 近 7 天有记录 ${avg.days} 天 | 平均 ${avg.kcal} kcal | ${gap < -600 ? '缺口偏大，有过度节食风险' : gap < 0 ? '缺口合理' : '没有缺口，甚至超出'} |`)
    lines.push(`| 近 7 天平均蛋白 | ${avg.protein} g | 目标 ${ctx.proteinTarget} g，${avg.protein >= ctx.proteinTarget ? '达标' : `缺 ${round(ctx.proteinTarget - avg.protein, 1)} g`} |`)
    lines.push(`| 近 7 天平均纤维 | ${avg.fiber} g | 建议 25 g 以上，${avg.fiber >= 25 ? '达标' : '偏低'} |`)
  } else {
    lines.push(`| 近 7 天 | 没有饮食记录 | 无法评估结构 |`)
  }
  if (ctx.targetWeight) {
    lines.push(`| 目标体重 | ${ctx.targetWeight} kg | 还需减 ${round(ctx.weight - ctx.targetWeight, 1)} kg |`)
  }
  lines.push('')

  lines.push(`## 2. 主要营养素的判断依据`)
  lines.push('')
  lines.push('| 指标 | 你的数值 | 参考标准 | 说明 |')
  lines.push('| --- | --- | --- | --- |')
  lines.push(`| 蛋白 | ${avg ? avg.protein : ctx.today.protein} g/天 | ${ctx.proteinTarget} g | 按体重 × 1.6 g，减脂期保肌肉的关键 |`)
  lines.push(`| 纤维 | ${avg ? avg.fiber : ctx.today.fiber} g/天 | ≥25 g | 决定饱腹感和肠道状态 |`)
  lines.push(`| 摄入下限 | — | ${ctx.minIntake} kcal | 低于这条线会掉肌肉、掉代谢 |`)
  lines.push(`| 缺口 | ${avg ? Math.abs(Math.min(0, gap)) : '—'} kcal | 300–500 kcal | 缺口过大难以持续 |`)
  lines.push('')

  lines.push(`## 3. 营养特点（你的饮食结构问题）`)
  lines.push('')
  const issues: string[] = []
  if (avg) {
    if (avg.protein < ctx.proteinTarget * 0.85) {
      issues.push(`**蛋白长期不足**：平均 ${avg.protein} g，比目标低 ${round(ctx.proteinTarget - avg.protein, 1)} g。这是减脂期最该先修的一项——蛋白不够，掉的主要是肌肉，基础代谢会跟着降。`)
    }
    if (avg.fiber < 20) {
      issues.push(`**纤维偏低**：平均 ${avg.fiber} g，不足 25 g。直接影响是饿得快、加餐多，间接影响是肠道菌群多样性下降。`)
    }
    if (gap < -600) {
      issues.push(`**缺口偏大**：近 7 天平均比总消耗低 ${Math.abs(gap)} kcal，超过 500 kcal 的持续缺口容易带来疲劳、掉发、运动表现下降。`)
    } else if (gap >= 0) {
      issues.push(`**没有形成缺口**：近 7 天平均摄入不低于总消耗，体重不会明显下降——这不是代谢坏了，是账没对上。`)
    }
    if (avg.days < 5) {
      issues.push(`**记录天数只有 ${avg.days}/7**：数据不足时任何结论都不稳，先把记录补齐比调整饮食更重要。`)
    }
    if (ctx.vegDays < 3 && avg.days >= 3) {
      issues.push(`**蔬菜达标天数少**：7 天里只有 ${ctx.vegDays} 天纤维达到 15 g 以上，说明蔬菜量波动大。`)
    }
  } else {
    issues.push(`**还没有可分析的记录**：先连续记 3–5 天（不用完美，尽量全），再谈结构问题才有意义。`)
  }
  if (!issues.length) issues.push('**结构基本合理**：蛋白、纤维、缺口三项都在区间内，接下来是稳定性问题而不是调整问题。')
  for (const i of issues) lines.push(`- ${i}`)
  lines.push('')

  lines.push(`## 4. 结合你目标的建议`)
  lines.push('')
  const actions: string[] = []
  if (avg && avg.protein < ctx.proteinTarget * 0.85) {
    const need = round(ctx.proteinTarget - avg.protein, 1)
    actions.push(`**早餐加一份蛋白**：${need > 25 ? '2 个鸡蛋 + 250 ml 无糖豆浆（约 24 g 蛋白）' : '1 个鸡蛋 + 250 ml 牛奶（约 15 g 蛋白）'}，把缺口从早上补掉，比晚上补更容易执行。`)
    actions.push(`**午餐主食减 30 g、加 100 g 鸡胸或鱼虾**：热量基本不变，蛋白多 20 g。`)
  }
  if (avg && avg.fiber < 20) {
    actions.push(`**每天固定 2 份蔬菜**：午餐 150 g 深色叶菜 + 晚餐 150 g 十字花科，纤维能补 5–7 g。`)
  }
  if (ctx.today.items === 0) {
    actions.push(`**现在就把${ctx.mealHint.split('（')[0]}记上**：你今天的记录还是空的，先记这一餐，剩下的预算才算得准。`)
  } else {
    const left = Math.max(0, ctx.tdee - ctx.today.kcal)
    actions.push(`**今天还剩 ${left} kcal**：${left > 600 ? `可以正常吃${ctx.mealHint.split('（')[0]}，注意蛋白优先` : left > 300 ? '晚餐以蛋白 + 蔬菜为主，主食控制在 100 g 熟重' : '剩余预算不多，晚餐走「蛋白 + 大量蔬菜、少油」路线'}。`)
  }
  actions.push(`**别用「今天少吃一顿」补偿**：跳餐会让下一餐更容易过量，且蛋白更难达标。`)
  for (const a of actions) lines.push(`- ${a}`)
  lines.push('')
  lines.push(`> 结论基于你本机的记录（${avg ? `近 7 天 ${avg.days} 天有记录` : '暂无记录'}）。记录不全时结论会偏，补齐后再看更准。`)

  void question
  return lines.join('\n')
}

/** 场景 / 概念类问题 */
function conceptBlock(question: string, ctx: RealContext): string {
  const isNight = /夜宵|晚上|睡前|下班.*饿|加班/.test(question)
  const left = Math.max(0, ctx.tdee - ctx.today.kcal)
  const gap = Math.max(0, round(ctx.proteinTarget - ctx.today.protein, 1))

  if (isNight) {
    return `## 1. 先算你今天的余额
你今天已摄入 ${ctx.today.kcal} kcal，总消耗约 ${ctx.tdee} kcal，**还剩 ${left} kcal**；蛋白还差 ${gap} g。
所以晚上吃不吃，答案取决于这两条线——不是「晚上吃东西会胖」。

## 2. 常见营养成分与饱腹感对比

| 选择 | 热量 | 蛋白 | 为什么 |
| --- | --- | --- | --- |
| 200 g 无糖酸奶 | 144 kcal | 6.4 g | 蛋白 + 钙，体积够，吃完有满足感 |
| 1 个水煮蛋 + 1 根黄瓜 | 88 kcal | 6.7 g | 蛋白密度最高的低热量组合 |
| 150 g 毛豆（水煮） | 195 kcal | 17 g | 植物蛋白 + 纤维双高，咀嚼时间长 |
| 1 小把坚果（15 g） | 90 kcal | 3 g | 只有 90 kcal 但很容易连吃三把 |
| 泡面一桶 | 450–500 kcal | 9 g | 吃掉今天全部余额还不够，且钠极高 |

## 3. 营养特点与注意事项
- **决定长胖的不是时间，是全天总量**。晚上代谢率略低，但差异远小于「多吃一桶泡面」的量级。
- 真正的问题是：晚上饥饿感强时，人更容易选高油高糖、且吃得快、停不下来。
- 高蛋白 + 高纤维 + 需要咀嚼的食物，是压制夜间食欲最有效的三个属性。

## 4. 结合你目标的建议
- 睡前 2 小时内，优先选 **200 g 无糖酸奶** 或 **1 个鸡蛋 + 黄瓜**——都在 150 kcal 以内，还能补 ${Math.min(gap, 7)} g 蛋白。
- 如果今天余额已经不足 ${Math.round(ctx.tdee * 0.15)} kcal，说明白天结构有问题（多半是主食或油偏多），明天从午餐开始修，不要靠饿着睡。
- 家里不要囤饼干、薯片、坚果大袋装——夜间意志力下降是生理规律，靠环境设计比靠自律可靠。`
  }

  return `## 关于你问的这个问题
「${question}」在演示模式下我只能给通用框架，因为内置表主要覆盖具体食物的营养计算。

## 我能确定的（基于你的真实数据）
- 你的 BMR 是 ${ctx.bmr} kcal，日均总消耗约 ${ctx.tdee} kcal
- 今天已摄入 ${ctx.today.kcal} kcal，还剩 ${left} kcal
- 蛋白目标 ${ctx.proteinTarget} g，今天还差 ${gap} g

## 想把这类问题问清楚
换成免费的真实模型（智谱 GLM-4-Flash 永久免费 / 本地 Ollama），它就能做真正的推理和开放式回答。

或者你直接把问题问具体一些，比如：
- 「100 g 西红柿多少 kcal」
- 「我今天吃得怎么样」
- 「晚上 8 点饿了吃什么」`
}

/* ------------------------------- 主入口 ------------------------------- */

/** 问题分类 */
function classify(question: string): 'food' | 'pattern' | 'concept' {
  const foods = findFoods(question)
  if (foods.length) return 'food'
  if (/吃得怎么样|还行吗|结构|够不够|还差|总结|分析一下|评估|今天.*(吃|记录)|明日|明天.*吃|怎么调整/.test(question)) return 'pattern'
  return 'concept'
}

/** 生成完整回答（不含流式） */
export function buildDemoAnswer(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const question = (lastUser?.content ?? '').trim()
  const ctx = readRealContext()

  /* 多轮：如果当前问题里没有食物，但上一轮问过，就沿用上一轮的食物（支持「炒着吃呢」这类追问） */
  const direct = findFoods(question)
  let foods = direct
  if (!foods.length) {
    const prevUser = [...messages].reverse().filter((m) => m.role === 'user')[1]
    const carried = prevUser ? findFoods(prevUser.content) : []
    if (carried.length && /炒|煎|炸|蒸|煮|油|热量|多少|呢|那/.test(question)) {
      foods = carried
    }
  }

  const kind = foods.length ? 'food' : classify(question)

  let body: string
  if (kind === 'food') body = foodBlock(foods, question, ctx)
  else if (kind === 'pattern') body = patternBlock(question, ctx)
  else if (/夜宵|晚上|睡前|下班.*饿|加班/.test(question)) body = conceptBlock(question, ctx)
  else body = notFoundBlock(question, ctx)

  return `${DEMO_BANNER}${body}`
}

/** 逐字吐字，模拟流式；支持中断 */
export async function streamDemo(opts: {
  messages: ChatMessage[]
  onDelta: (text: string) => void
  signal?: AbortSignal
}): Promise<{ content: string; model: string; tokens: number }> {
  const full = buildDemoAnswer(opts.messages)
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  /* 先给一小段"思考"停顿，让交互感觉自然 */
  await sleep(280)

  let i = 0
  /* 中文按 2–5 字一块吐，比逐字更像真实流式 */
  while (i < full.length) {
    if (opts.signal?.aborted) {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }
    const step = 2 + Math.floor(Math.random() * 4)
    const chunk = full.slice(i, i + step)
    i += step
    opts.onDelta(chunk)
    /* 标点处停久一点，接近真实打字的节奏 */
    const pause = /[。！？\n]/.test(chunk) ? 26 : 9
    await sleep(pause)
  }

  return { content: full, model: DEMO_MODEL, tokens: Math.round(full.length / 1.6) }
}
