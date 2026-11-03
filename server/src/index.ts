import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import { PORT, ROOT_DIR, SERVE_WEB_DIST, UPLOAD_DIR } from './config'
import { initSchema, db } from './db'
import { seedAll } from './db/seed'
import { getSessionUser } from './services/auth'
import { coreRouter } from './routes/core'
import { dietRouter } from './routes/diet'
import { nutritionRouter } from './routes/nutrition'
import { workoutRouter } from './routes/workout'
import { insightsRouter } from './routes/insights'
import { assistantRouter } from './routes/assistant'
import { analysisRouter } from './routes/analysis'
import { authRouter } from './routes/auth'

initSchema()
seedAll()

const app = express()
app.use(cors())
app.use(express.json({ limit: '25mb' }))
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'fat-loss-admin', time: new Date().toISOString(), port: PORT })
})

/**
 * 全局鉴权中间件：除 /api/health 与 /api/auth/* 外，所有接口都要求携带有效会话令牌。
 * 未携带 / 已失效 → 401，前端拦截器据此跳回登录页。
 */
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') return next()
  const p = req.path
  if (p === '/health' || p.startsWith('/auth/')) return next()
  const auth = req.headers.authorization
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const user = token ? getSessionUser(token) : null
  if (!user) {
    return res.status(401).json({ ok: false, error: '未登录或登录已失效', code: 'UNAUTHENTICATED' })
  }
  ;(req as unknown as { userId: number }).userId = user.id
  next()
})

app.use('/api/auth', authRouter)
app.use('/api', coreRouter)
app.use('/api', dietRouter)
app.use('/api', nutritionRouter)
app.use('/api', workoutRouter)
app.use('/api', insightsRouter)
app.use('/api', assistantRouter)
app.use('/api', analysisRouter)

// 生产模式：如果前端已构建，直接由同一个端口托管
const distDir = path.join(ROOT_DIR, 'web', 'dist')
if (SERVE_WEB_DIST && fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^\/(?!api|uploads).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server error]', err)
  res.status(err?.status || 500).json({ ok: false, error: err?.message || '服务器内部错误' })
})

app.listen(PORT, () => {
  console.log(`\n  🥗  个人 AI 减脂管理后台 API`)
  console.log(`  ➜  接口地址: http://localhost:${PORT}/api/health`)
  if (fs.existsSync(distDir) && SERVE_WEB_DIST) console.log(`  ➜  生产预览: http://localhost:${PORT}`)
  console.log('')
})

/**
 * 退出前把 WAL 里的数据 checkpoint 回主库。
 * 开发时 tsx watch 会频繁重启，不做这一步虽然也不会丢（-wal 保留着），
 * 但主库文件会显得很旧，备份时容易只拷走一个落后的 .db。
 */
let closing = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) return
    closing = true
    try {
      db.pragma('wal_checkpoint(TRUNCATE)')
      db.close()
    } catch {
      /* 关闭失败就让进程直接退 */
    }
    process.exit(0)
  })
}
