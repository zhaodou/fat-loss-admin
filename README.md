# FitPilot · 个人 AI 减脂管理后台

一个可以完全跑在本机的减脂管理系统：记录每天吃了什么、动了什么、体重怎么变，然后算出**真实的**热量缺口，并基于长期趋势给出有数据依据的建议。

前后端一体，`npm install && npm run dev` 即可启动，数据存在本机 SQLite，不依赖任何外部服务。

---

## 1. 技术栈

| 层  | 选型                                                                                                 |
| -- | -------------------------------------------------------------------------------------------------- |
| 前端 | Vue 3.5（`<script setup>`）+ TypeScript + Vite 6 + Element Plus 2.9 + ECharts 5 + Pinia + Vue Router |
| 后端 | Node.js + Express 4 + better-sqlite3（同步 SQLite）+ tsx（直接跑 TS，无需编译）                                  |
| 数据 | 单文件 SQLite `data/fatloss.db`，餐食照片存 `data/uploads/`                                                 |
| 工程 | npm workspaces（`server` / `web`），concurrently 同时起前后端                                               |



---

## 2. 快速开始

```bash
cd fat-loss-admin
npm install          # 首次安装，约 250 个包
npm run dev          # 同时启动 API(4318) 和前端(5173)
```

打开 <http://localhost:5173>。

其它命令：

```bash
npm run dev:server      # 只起后端（tsx watch，改代码自动重启）
npm run dev:web         # 只起前端
npm run build           # 前端类型检查 + 生产构建（产物 web/dist）
npm start               # 生产模式：后端同时托管 web/dist，单端口 4318
npm run typecheck       # 前后端类型检查
npm run reset:db -w server    # 清空业务数据，保留食物库/运动库
npm run seed:demo -w server   # 重新生成 21 天演示数据
```

首次启动会自动建库，并写入 **76 种食物、31 种运动、21 天演示数据**（体重、三餐、运动、目标），所以一打开就有东西看。  
不想要演示数据：`SEED_DEMO=false npm run dev`，或启动后在「系统设置 → 数据管理 → 清空业务数据」。

> 端口被占用时：后端改 `PORT=4319 npm run dev`，前端改 `web/vite.config.ts` 里的 `server.port` 与 proxy 目标。

---

## 3. 目录结构

```
fat-loss-admin/
├─ server/
│  └─ src/
│     ├─ config.ts              # 常量、活动系数、默认设置
│     ├─ db/
│     │  ├─ index.ts            # 连接、建表、设置读写（日志模式自动降级）
│     │  └─ seed.ts             # 食物库 / 运动库 / 演示数据
│     ├─ services/
│     │  ├─ energy.ts           # ★ 能量计算引擎（唯一口径）
│     │  ├─ trend.ts            # 线性回归 / 指数平滑 / 日期工具
│     │  ├─ data.ts             # 数据访问 + 日维度聚合
│     │  ├─ stats.ts            # 日/周/月/年统计
│     │  ├─ schedule.ts         # ★ 作息感知的运动排期
│     │  ├─ advice.ts           # ★ AI 建议规则引擎
│     │  ├─ assistant.ts        # ★ 我的助手：LLM 连接 / 系统提示词 / 流式调用
│     │  ├─ recipe.ts           # 组合餐食计算（食材清单 → 营养）
│     │  ├─ servings.ts         # 「片/个/碗 → 克」单位换算
│     │  └─ recognizer.ts       # 餐食照片识别（启发式 + 可选视觉模型）
│     ├─ routes/                # core / diet / dishes / workout / insights / assistant
│     ├─ scripts/               # reset-db / reseed
│     └─ index.ts               # Express 入口
└─ web/
   └─ src/
      ├─ api/index.ts           # axios 封装 + 全部接口
      ├─ types/api.ts           # 与后端对齐的类型
      ├─ stores/app.ts          # 全局：profile / settings / plan
      ├─ utils/                 # 日期、格式化、图表主题、markdown 渲染
      ├─ components/            # Chart / StatCard / SectionCard / AdviceCard / RouteMap / QuickLogDialog / MealComposer
      ├─ layouts/AppLayout.vue  # 侧边栏 + 顶栏 + 快速记录
      └─ views/                 # 12 个页面（含我的助手）
```

---

## 4. 三个关键设计（重点）

### 4.1 热量缺口 = 总日消耗 − 摄入，不是「基础代谢 − 摄入」

```
BMR（Mifflin-St Jeor，有体脂率时用 Katch-McArdle）
日常活动 NEAT = BMR × (活动系数 − 1)
运动消耗 = MET × 3.5 × 体重(kg) ÷ 200 × 分钟 × 强度系数

TDEE = BMR×非运动分钟占比 + NEAT×非运动分钟占比 + 运动消耗
缺口 = TDEE − 摄入
```

**如何避免运动被算两次**：活动系数采用的是**不含运动的 NEAT 系数**（1.2 / 1.3 / 1.4 / 1.5），  
并且计算 TDEE 时会把运动分钟数从「日常消耗」里剔除，运动那一小时只按 MET 计一次。  
设置页的「运动时段去重」开关就是这个逻辑（默认开启，关闭后会明确提示「会重复计算」）。

演示数据里：62.4 kg / 164 cm / 32 岁女性，BMR ≈ 1308，系数 1.3，TDEE ≈ 1700（无运动日约 1698）。  
若按「BMR − 摄入」算，吃掉 1450 kcal 会被误判成「缺口 −142」，而真实情况是缺口 +248。

### 4.2 运动建议必须符合作息

`services/schedule.ts` 是硬约束，不是文案：

1. **午休先吃饭**：`12:00–14:00` 里先扣掉 `meal_minutes`（默认 40 分钟），吃完饭再歇 10 分钟，剩余时间才排「饭后散步」，且午间不排中高强度（没条件洗澡）。剩余不足 15 分钟就明确返回「这个时段只保证吃饭」。
2. **晚间不早于 18:00**：晚间方案在「下班后先练再吃」和「饭后 1 小时再练」之间取一个塞得进日程的；两者都不足 25 分钟，就返回「今天没有空档，建议改成 10 分钟居家核心」。
3. **早上只排低强度**：起床到出门要留够通勤+早餐（50 分钟），不足 20 分钟不安排。
4. **睡眠优先**：任何运动不晚于睡前 1 小时结束。

生成后还会做一次冲突校验：任何与午餐窗口重叠、或早于 18:00 的晚间时段都会被标记为不可用。

### 4.3 AI 建议必须有数据依据

`services/advice.ts` 里每条建议都带 `evidence`（具体区间、样本量、数字）和 `confidence`，并有硬闸门：

- **单日体重永不作为调整依据**。所有趋势结论用 **14 天线性回归斜率 + 7 日指数平滑（EMA）**；单日与趋势偏差 ≥0.5 kg 时，只会输出一条「这是水分波动，不改方案」的说明。
- **数据不足直接拒绝调整**：近 14 天饮食记录 < 5 天，或体重记录 < 4 条时，禁止输出「减少摄入/增加运动」，只给「继续记录 7 天」。
- **调整幅度封顶**：单次摄入调整 ≤ 150 kcal/天；运动增量 ≤ 90 分钟/周；摄入不低于安全下限（女 1200 / 男 1500，可改）；缺口不超过 TDEE 的 25% 或 750 kcal。
- **今天没记完不算节食**：当天 21:00 前，当天数据不进入摄入均值，避免「晚餐还没吃」被判定为过度节食。
- 会主动识别**记录偏差**：用「理论周变化 vs 实际周变化」的比值，判断是摄入低估还是运动消耗高估。

建议类型：过度节食、数据不足、掉秤过快、节奏良好、平台期（先排除记录误差再谈减碳）、体重上升、缺口完成度不足、蛋白质不足、脂肪/碳水占比失衡、晚餐过晚、运动缺勤、训练刺激单一、目标日期不可行、记录偏差、正向反馈。

---

### 4.4 食物库的两层结构：先食材、再组合成餐食

用户说的是「一片面包、两片火腿、一片芝士、一个煎鸡蛋」，不是「每 100 g 多少千卡」。所以食物库分两层：

- **食材（ingredient）**：每 100 g 的营养 + 一组「单位 → 克数」换算表（`servings`），例如全麦面包 `1 片 = 35 g`、鸡蛋 `1 个 = 50 g`。没有显式单位时会从「1 小碗 150 g」这类描述自动反推，再不行按分类兜底（主食 1 碗 150 g、乳品 1 杯 250 g……）。
- **餐食（dish）**：由多个食材组成（`recipe` 存明细），营养 = 逐行按克重算再求和，`serving_g` 是整份克数。记录饮食时**按「份」一键加入**，一次记完一整顿饭。

两种新增餐食的方式：

1. **按食材组合**（`MealComposer` 组件）：搜食材 → 填「2 片」「1 个」→ 实时看到总热量和蛋白/碳水/脂肪/纤维 → 存为「我的餐食」或直接记入某一餐。左侧还内置了 13 道「常吃搭配」模板（自制三明治、番茄炒蛋盖饭、鸡蛋拌面……），点一下整份填进来再微调。
2. **拍照识别**：识别结果不再是一个无法核对的数字，而是**拆成食材 + 克数**（本地菜谱库估算，或配视觉模型）。每一行都能改克数，猜得不像可以一键切换候选菜谱；确认后存成餐食并记录，或只记这一顿。

同名餐食保存时会**更新配方而不是重复新建**；餐食记录在饮食页有「组合餐食」标识。改动餐食配方不会影响已记录的历史（记录时快照营养值）。

---

## 5. 功能与页面

| 页面      | 路径           | 主要能力                                                                  |
| ------- | ------------ | --------------------------------------------------------------------- |
| 今日概览    | `/dashboard` | 体重/摄入/消耗/缺口四卡、目标进度环、14 天体重趋势、7 天摄入vs消耗、今日三餐与运动、今日可用时段                 |
| 每日饮食    | `/diet`      | 四餐卡片、**单一食材 / 我的餐食两种记录方式**、份量快捷按钮、营养实时换算、照片上传识别（拆成食材）、编辑/删除、复制昨天、按餐清空 |
| 运动记录    | `/workout`   | 31 种运动、MET 估算预览、强度系数、起止时间、轨迹（点击绘制 + 距离/配速）、近 4 周运动量与类型分布              |
| 体重与身体   | `/body`      | 30/90/365 天曲线（实测 + 趋势 + 健康区间）、腰围/体脂/肌肉、30 天预测、R²、记录明细                 |
| 热量分析    | `/energy`    | 瀑布图（BMR→NEAT→运动→TDEE→摄入→缺口）、公式逐步代入、运动明细、宏量结构、7 天缺口                    |
| AI 减脂顾问 | `/advisor`   | 评分 + 结论、建议清单（依据/动作/置信度）、今日时段、未来 7 天安排、目标评估、分析边界、历史                    |
| 我的助手    | `/assistant` | **对话式营养问答**：热量计算、营养成分与价值、减脂建议；多会话管理、流式输出、Markdown 表格、内置 DeepSeek/通义/Kimi 等连接预设 |
| 周/月/年统计 | `/stats`     | 区间汇总、与上期对比、体重/摄入消耗/缺口/运动四张图、饮食结构、分区间明细表                               |
| 目标体重    | `/goal`      | 目标进度、系统建议体重（健康区间约束）、可行性计算、目标历史                                        |
| 个人减脂计划  | `/plan`      | 上下班/午休/晚餐/睡眠、训练日、偏好运动、饮食偏好、步数目标、实时时段预览、排期规则说明                         |
| 食物与运动库  | `/library`   | **食材库（每 100 g 营养 + 片/个/碗单位表）**、**我的餐食（多食材组合，营养自动算）**、运动 MET 表、自建条目增删改 |
| 系统设置    | `/settings`  | 个人资料、单位、计算规则（系数/公式/上限/下限/蛋白质）、隐私、导入导出、清空数据                            |

交互细节：顶栏「快速记录」可一键记体重/饮食/运动；所有图表跟随数据自动重绘；空状态都有明确下一步。

---

## 6. 数据模型

| 表              | 说明                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `profile`      | 单行：性别、生日、身高、兜底体重、体脂、生活备注                                                                                            |
| `body_records` | 每日体重/腰围/体脂/肌肉，`date` 唯一                                                                                             |
| `foods`        | 食材库 + 餐食库：`kind` 区分（ingredient / dish），营养值按每 100 g；`servings` 存「片/个/碗 → 克」单位表，`recipe` 存餐食组成明细；`is_builtin` 区分内置/自建 |
| `exercises`    | 运动库，MET + 默认强度                                                                                                      |
| `workouts`     | 运动记录，含 MET、强度、时长、消耗、轨迹 JSON                                                                                         |
| `diet_entries` | 饮食记录，**写入时快照营养值**（改食物库不影响历史）                                                                                        |
| `meal_photos`  | 餐食照片 + 识别结果 JSON                                                                                                    |
| `goals`        | 目标体重/日期，`active` 唯一                                                                                                 |
| `plan`         | 单行：作息、训练日、偏好、饮食偏好                                                                                                   |
| `advice_logs`  | 每次生成的分析快照（评分、结论、完整 payload）                                                                                         |
| `assistant_threads`  | 「我的助手」会话列表（标题 + 时间）                                                                                                |
| `assistant_messages` | 会话消息（role / content / model / tokens）                                                                               |
| `settings`     | 单行 JSON：单位、能量规则、隐私、AI 配置（含助手模型连接，Key 只存本机）                                                                          |

导入导出为整库 JSON（`GET /api/data/export`、`POST /api/data/import`，支持 `replace` / `merge`）。

---

## 7. API 速览

```
GET  /api/health
GET  /api/profile            PUT /api/profile
GET  /api/plan               PUT /api/plan
GET  /api/plan/schedule?date=        # 当日可用运动时段
GET  /api/settings           PUT /api/settings

GET  /api/dashboard?date=
GET  /api/analysis/energy?date=
GET  /api/stats?granularity=week|month|year&date=
GET  /api/timeline?date=

GET  /api/foods?keyword=&category=&kind=ingredient|dish|all&limit=
POST /api/foods              PUT/DELETE /api/foods/:id

GET  /api/dishes             GET /api/dishes/templates    # 常吃搭配模板
GET  /api/dishes/:id         GET /api/dishes/units/:foodId
POST /api/dishes             PUT/DELETE /api/dishes/:id   # 同名自动更新配方
POST /api/dishes/preview     # 传食材清单 → 逐行营养 + 合计（不落库）
POST /api/dishes/recognize   # multipart，餐食照片 → 拆成食材草稿
POST /api/dishes/:id/log     # 按份数记入某天某餐

GET  /api/diet/day?date=
POST /api/diet/entries       PUT/DELETE /api/diet/entries/:id
POST /api/diet/copy          DELETE /api/diet/day
POST /api/diet/photo         # multipart，上传并识别（保留照片）
DELETE /api/diet/photo/:id

GET  /api/exercises          POST/PUT/DELETE
GET  /api/workouts?date=|start=&end=
POST /api/workouts           POST /api/workouts/estimate
PUT/DELETE /api/workouts/:id
GET  /api/workouts/summary?days=28&end=

GET  /api/body?days=&end=    POST /api/body    DELETE /api/body/:id
GET  /api/goals              POST /api/goals   GET /api/goals/suggestion

POST /api/advice             GET /api/advice/latest    GET /api/advice/history

GET  /api/assistant/config   PUT /api/assistant/config    POST /api/assistant/test
GET  /api/assistant/threads  POST /api/assistant/threads
GET/PATCH/DELETE /api/assistant/threads/:id
POST /api/assistant/chat     # SSE 流式：meta → delta* → done | error | aborted
GET  /api/data/export        POST /api/data/import     POST /api/data/reset
```

---

## 8. 照片识别说明

识别的输出&#x662F;**「菜名 + 拆解成食材」**，而不是一个直接的热量数字——这样每一行克数都能核对和修改。

默认走**本地菜谱库估算**：内置 13 道常见家常菜的食材构成（自制三明治、番茄炒蛋盖饭、蛋炒饭、拌面、宫保鸡丁盖饭……），按餐次 + 图片内容哈希挑一道作为候选，返回 `engine: "heuristic"`，前端会标注需要确认。猜得不像时可以一键切换其他候选菜谱。

想接真实视觉模型，配环境变量即可（兼容 OpenAI Chat Completions 图片格式）：

```bash
VISION_ENDPOINT=https://api.openai.com/v1/chat/completions
VISION_API_KEY=sk-xxx
VISION_MODEL=gpt-4o-mini
npm run dev
```

视觉模型的 prompt 要求**先判断是什么菜，再拆成食材 + 克数**，且只允许使用食材库中的名称；调用失败会自动回退到本地菜谱库，不会阻塞记录流程。

---

## 9. 我的助手（对话式营养问答）

`/assistant` 是一个真正的 LLM 对话框：**营养数值来自模型自身的营养学知识（估算），不是查询本机食物库**。它与 `/advisor` 的区别：

| | AI 减脂顾问 `/advisor` | 我的助手 `/assistant` |
| --- | --- | --- |
| 回答来源 | 本地规则引擎，读本机数据计算 | 大模型生成，营养值为估算 |
| 特点 | 结论可追溯、可复现，负责「管住节奏」 | 自由问答，负责「看懂食物」 |
| 是否需要联网 | 否 | 是（调用模型 API） |

助手会自动把你的档案（身高体重/BMI/目标/作息）、最近 7 天的饮食与运动摘要、今天已记录的餐食注入系统提示词，所以能回答「我今天蛋白够不够」这类个性化问题；但问「100g 西红柿多少卡」时，答案仍是模型给的估算（会标注依据与假设），不会去查你的食物库。

### 不花钱怎么用（推荐先看这个）

三条路，按省事程度排：

| 方式 | 费用 | 需要做什么 | 效果 |
| --- | --- | --- | --- |
| **演示模式** | 0 元、0 配置 | 助手设置里选「演示模式」保存即可（未配置时页面也会给你一键切换按钮） | 本机内置营养样例生成四段式回答，能看排版、交互、热量拆解与结合你真实档案的建议；食物覆盖有限，**不是真实大模型** |
| **智谱 GLM-4-Flash** | 永久免费 | open.bigmodel.cn 手机号注册拿 Key，填入助手设置 | 真实推理，任意食物任意问法 |
| **本地 Ollama** | 完全免费、不联网 | 装 Ollama 后 `ollama pull qwen2.5:7b`（约 4.7 GB），选「本地 Ollama」预设 | 真实推理且数据不出本机；7B 模型在 16 GB 内存的机器上可用 |

另有长期免费额度：火山方舟（豆包，每天 200 万 token，需在控制台手动开通模型）、硅基流动（注册送 2000 万 token）、DeepSeek（新用户有赠送额度）。免费额度政策会变，以各平台当前页面为准。

**演示模式的诚实边界**：它由 `server/src/services/demo-brain.ts` 生成——内置约 50 种常见食物的营养常识值（每 100 g），支持份量换算（「两个」「一碗」「150 g」按位置归属到正确食材）、生熟差异、烹饪用油叠加，并真实读取你的档案与记录来算蛋白缺口和剩余预算；但它不会推理，匹配不到的食物会直说并引导换免费模型。前端全程打「演示」徽标，回答正文也会声明，绝不冒充真实模型。

### 模型连接

在「我的助手 → 助手设置」里配置，支持任何 OpenAI 兼容的 `/chat/completions` 服务，内置预设（按推荐顺序）：

- **演示模式**：零配置零费用，先看效果
- **智谱 GLM**：`glm-4-flash` 永久免费
- **本地 Ollama**：`http://localhost:11434/v1/chat/completions` + `qwen2.5:7b`，不需要 Key
- **火山方舟（豆包）**：每天 200 万 token 免费额度；模型名填控制台的「接入点 ID」（`ep-` 开头）
- **硅基流动**：`Qwen/Qwen2.5-7B-Instruct` 等，注册送 2000 万 token
- **DeepSeek**：`deepseek-chat`，性价比高
- **通义千问 / Kimi / OpenAI / 自定义**

API Key 只存在本机 SQLite，界面上只显示掩码；也可以用环境变量 `ASSISTANT_ENDPOINT` / `ASSISTANT_API_KEY` / `ASSISTANT_MODEL` 覆盖界面配置。填好后点「测试连接」即可验证。

### 回答约定

系统提示词要求模型每次食物分析至少包含四块：**热量与估算依据（含假设与烹饪系数）→ 主要营养成分与营养价值（表格）→ 营养特点与注意事项 → 结合你目标的建议**；信息不足时先给明确假设下的估算，再追问；同时约束了摄入下限（女 1200 / 男 1500 kcal）、不做诊断、不推荐减肥药等安全边界。回答风格（严格 / 鼓励 / 中立）可在设置里切换。

---

## 10. 后续可以怎么扩展

- **换成 SQLite 之外的库**：`server/src/db/index.ts` 只暴露 `db` 实例与设置读写，替换成 Postgres 需改 services 里的 SQL。
- **多用户**：给所有表加 `user_id`，`profile`/`plan` 去掉 `CHECK(id = 1)`，路由前挂鉴权中间件。
- **接 LLM 生成建议**：`advice.ts` 输出的结构化结果可以直接作为 prompt 上下文，让模型润色文案，但数值和判断仍由本地引擎给出，避免模型编数字。
- **加新指标**：在 `services/energy.ts` 加公式 → `data.ts` 的日聚合里带上 → 前端展示；所有页面自动一致。
- **移动端**：`AppLayout.vue` 侧边栏在 820px 以下已隐藏，可替换为 tabbar。

---

## 11. 已知边界

- 单机使用，没有登录与多用户隔离；数据是明文 SQLite。
- 运动消耗按 MET 估算，手环的实际消耗通常高 10%–20%，可用每条记录的 MET 或强度做微调。
- 照片识别默认非 AI 视觉识别，见第 8 节。
- 食物库为常见中餐估算值，精确到「每 100 g」，实际烹饪用油建议单独记录（库里已有「食用油」）。
- 「我的助手」的回答由模型生成，热量与营养值均为估算，不能替代医学建议；未配置模型前该页面只提供引导，不会伪造回答。
