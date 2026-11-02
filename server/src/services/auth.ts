import { randomBytes } from 'node:crypto'
import { db, nowIso } from '../db'
import { hashPassword, verifyPassword, validateUsername, validatePassword } from './password'

export interface UserRecord {
  id: number
  username: string
  nickname: string
  password_hash: string
  password_salt: string
  created_at: string
  updated_at: string
}

export interface PublicUser {
  id: number
  username: string
  nickname: string
  created_at: string
}

/** 会话有效期 7 天 */
const SESSION_TTL_DAYS = 7

export function toPublicUser(u: UserRecord): PublicUser {
  return { id: u.id, username: u.username, nickname: u.nickname, created_at: u.created_at }
}

export function findUserByUsername(username: string): UserRecord | null {
  return (db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRecord) || null
}

export function findUserById(id: number): UserRecord | null {
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord) || null
}

export function createUser(username: string, password: string, nickname: string): UserRecord {
  const { hash, salt } = hashPassword(password)
  const now = nowIso()
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, password_salt, nickname, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(username, hash, salt, nickname, now, now)
  return findUserById(Number(info.lastInsertRowid))!
}

export function authenticate(username: string, password: string): PublicUser | null {
  const u = findUserByUsername(username)
  if (!u) return null
  if (!verifyPassword(password, u.password_hash, u.password_salt)) return null
  return toPublicUser(u)
}

export function updatePassword(userId: number, newPassword: string): void {
  const { hash, salt } = hashPassword(newPassword)
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?').run(
    hash,
    salt,
    nowIso(),
    userId,
  )
}

export function updateNickname(userId: number, nickname: string): PublicUser {
  db.prepare('UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?').run(nickname, nowIso(), userId)
  return toPublicUser(findUserById(userId)!)
}

/* ------------------------------- 会话 ------------------------------- */

export function createSession(userId: number): string {
  const token = randomBytes(32).toString('hex')
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_TTL_DAYS * 86400000)
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    now.toISOString(),
    expires.toISOString(),
  )
  return token
}

export function getSessionUser(token: string): PublicUser | null {
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as
    | { token: string; user_id: number; expires_at: string }
    | undefined
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return null
  }
  const u = findUserById(row.user_id)
  return u ? toPublicUser(u) : null
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

/* ------------------------------ 输入校验 ------------------------------ */

export function validateNewUser(username: string, password: string): string | null {
  const uErr = validateUsername(username)
  if (uErr) return uErr
  const pErr = validatePassword(password)
  if (pErr) return pErr
  return null
}
