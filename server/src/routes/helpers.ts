import type { Request, Response } from 'express'

export function today(): string {
  const d = new Date()
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function reqDate(req: Request, fallback = today()): string {
  const q = (req.query.date as string) || (req.body?.date as string) || fallback
  return /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : fallback
}

export function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function optionalNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

export function asyncRoute(fn: (req: Request, res: Response) => unknown) {
  return (req: Request, res: Response) => {
    try {
      const out = fn(req, res)
      if (out instanceof Promise) out.catch((err) => fail(res, err))
    } catch (err) {
      fail(res, err)
    }
  }
}

export function fail(res: Response, err: unknown, code = 400) {
  const message = err instanceof Error ? err.message : String(err)
  console.error('[api error]', message)
  res.status(code).json({ ok: false, error: message })
}
