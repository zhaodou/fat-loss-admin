import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/** scrypt 参数：64 字节摘要，足够抵抗离线暴力破解，单次同步耗时 < 50ms */
const KEYLEN = 64

/** 账号规则：1-8 位，只允许字母、数字、下划线 */
export const USERNAME_MAX = 8

/** 密码规则：6-15 位，且必须同时包含字母、数字、特殊字符 */
export const PASSWORD_MIN = 6
export const PASSWORD_MAX = 15

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, KEYLEN).toString('hex')
  return { hash, salt }
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, KEYLEN)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

/** 返回错误文案；null 表示合法 */
export function validateUsername(username: string): string | null {
  if (!username) return '请输入账号'
  if (!/^[A-Za-z0-9_]+$/.test(username)) return '账号只能包含字母、数字和下划线'
  if (username.length > USERNAME_MAX) return `账号最多 ${USERNAME_MAX} 位字符`
  return null
}

/** 返回错误文案；null 表示合法 */
export function validatePassword(password: string): string | null {
  if (!password) return '请输入密码'
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `密码长度需为 ${PASSWORD_MIN}-${PASSWORD_MAX} 位`
  }
  if (!/[A-Za-z]/.test(password)) return '密码需包含字母'
  if (!/[0-9]/.test(password)) return '密码需包含数字'
  if (!/[^A-Za-z0-9]/.test(password)) return '密码需包含特殊字符（如 @ # . ! 等）'
  return null
}
