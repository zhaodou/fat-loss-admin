import { Router, type Request } from 'express'
import { asyncRoute } from './helpers'
import {
  authenticate,
  createSession,
  createUser,
  deleteSession,
  findUserById,
  findUserByUsername,
  getSessionUser,
  toPublicUser,
  updateNickname,
  updatePassword,
  validateNewUser,
} from '../services/auth'
import { validatePassword, verifyPassword } from '../services/password'

export const authRouter = Router()

/** 从 Authorization: Bearer <token> 取令牌 */
function bearer(req: Request): string | null {
  const h = req.headers.authorization
  if (!h) return null
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null
}

function currentUser(req: Request) {
  const token = bearer(req)
  return token ? getSessionUser(token) : null
}

/* 注册：成功直接返回登录态（token + 用户信息） */
authRouter.post(
  '/register',
  asyncRoute((req, res) => {
    const b = req.body ?? {}
    const username = String(b.username ?? '').trim()
    const password = String(b.password ?? '')
    const nickname = String(b.nickname ?? '').trim()

    const err = validateNewUser(username, password)
    if (err) throw new Error(err)
    if (findUserByUsername(username)) throw new Error('该账号已存在')

    const user = createUser(username, password, nickname || username)
    const token = createSession(user.id)
    res.json({ ok: true, token, user: toPublicUser(user) })
  }),
)

/* 登录 */
authRouter.post(
  '/login',
  asyncRoute((req, res) => {
    const b = req.body ?? {}
    const username = String(b.username ?? '').trim()
    const password = String(b.password ?? '')

    const user = authenticate(username, password)
    if (!user) throw new Error('账号或密码错误')
    const token = createSession(user.id)
    res.json({ ok: true, token, user })
  }),
)

/* 退出登录 */
authRouter.post(
  '/logout',
  asyncRoute((req, res) => {
    const token = bearer(req)
    if (token) deleteSession(token)
    res.json({ ok: true })
  }),
)

/* 当前登录用户 */
authRouter.get(
  '/me',
  asyncRoute((req, res) => {
    const user = currentUser(req)
    if (!user) return res.status(401).json({ ok: false, error: '未登录或登录已失效' })
    res.json(user)
  }),
)

/* 修改密码 */
authRouter.put(
  '/password',
  asyncRoute((req, res) => {
    const user = currentUser(req)
    if (!user) return res.status(401).json({ ok: false, error: '未登录或登录已失效' })
    const b = req.body ?? {}
    const oldPassword = String(b.oldPassword ?? '')
    const newPassword = String(b.newPassword ?? '')

    const record = findUserById(user.id)!
    if (!verifyPassword(oldPassword, record.password_hash, record.password_salt)) {
      throw new Error('原密码错误')
    }
    const pErr = validatePassword(newPassword)
    if (pErr) throw new Error(pErr)
    updatePassword(user.id, newPassword)
    res.json({ ok: true })
  }),
)

/* 修改昵称 */
authRouter.put(
  '/profile',
  asyncRoute((req, res) => {
    const user = currentUser(req)
    if (!user) return res.status(401).json({ ok: false, error: '未登录或登录已失效' })
    const nickname = String(req.body?.nickname ?? '').trim()
    if (!nickname) throw new Error('昵称不能为空')
    if (nickname.length > 20) throw new Error('昵称最多 20 个字符')
    const updated = updateNickname(user.id, nickname)
    res.json({ ok: true, user: updated })
  }),
)
