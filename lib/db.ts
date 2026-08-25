// Работа с БД (Postgres через Vercel Postgres / Neon — бесплатный тариф)
// Если DATABASE_URL не задан, работаем в режиме "env-only" (один магазин из env)

import postgres from 'postgres'

let sql: ReturnType<typeof postgres> | null = null

export function getDb() {
  const url = process.env.DATABASE_URL
  if (!url) return null
  if (!sql) {
    sql = postgres(url, { ssl: 'require', max: 1 })
  }
  return sql
}

export async function initDb() {
  const db = getDb()
  if (!db) return false
  await db`
    CREATE TABLE IF NOT EXISTS shops (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      token TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'templates',
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `
  await db`
    CREATE TABLE IF NOT EXISTS feedbacks (
      id TEXT NOT NULL,
      shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      nm_id INTEGER,
      product_name TEXT,
      user_name TEXT,
      rating INTEGER,
      text TEXT,
      pros TEXT,
      cons TEXT,
      created_date TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'answered',
      answer TEXT,
      source TEXT,
      error TEXT,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (id, shop_id)
    )
  `
  await db`CREATE INDEX IF NOT EXISTS idx_feedbacks_shop ON feedbacks(shop_id, processed_at DESC)`
  return true
}

export type Shop = {
  id: number
  name: string
  token: string
  mode: 'templates' | 'llm'
  enabled: boolean
}

export async function listShops(): Promise<Shop[]> {
  const db = getDb()
  if (!db) return []
  return (await db`SELECT id, name, token, mode, enabled FROM shops ORDER BY id`) as Shop[]
}

export async function getShop(id: number): Promise<Shop | undefined> {
  const db = getDb()
  if (!db) return undefined
  const rows = (await db`SELECT id, name, token, mode, enabled FROM shops WHERE id = ${id}`) as Shop[]
  return rows[0]
}

export async function addShop(name: string, token: string, mode: string): Promise<number> {
  const db = getDb()
  if (!db) throw new Error('БД не настроена')
  const rows = await db`
    INSERT INTO shops (name, token, mode) VALUES (${name}, ${token}, ${mode})
    RETURNING id
  `
  return (rows[0] as { id: number }).id
}

export async function updateShopMode(id: number, mode: string) {
  const db = getDb()
  if (!db) throw new Error('БД не настроена')
  await db`UPDATE shops SET mode = ${mode} WHERE id = ${id}`
}

export async function toggleShop(id: number, enabled: boolean) {
  const db = getDb()
  if (!db) throw new Error('БД не настроена')
  await db`UPDATE shops SET enabled = ${enabled} WHERE id = ${id}`
}

export async function deleteShop(id: number) {
  const db = getDb()
  if (!db) throw new Error('БД не настроена')
  await db`DELETE FROM shops WHERE id = ${id}`
}

export type FeedbackRow = {
  id: string
  shop_id: number
  shop_name?: string
  nm_id: number | null
  product_name: string | null
  user_name: string | null
  rating: number | null
  text: string | null
  status: string
  answer: string | null
  source: string | null
  error: string | null
  processed_at: string
}

export async function saveFeedback(shopId: number, fb: {
  id: string
  nmId?: number
  productName?: string
  userName?: string
  rating?: number
  text?: string
  pros?: string
  cons?: string
  createdDate?: string
}, answer: string | null, source: string | null, error: string | null) {
  const db = getDb()
  if (!db) return
  await db`
    INSERT INTO feedbacks (id, shop_id, nm_id, product_name, user_name, rating, text, pros, cons, created_date, status, answer, source, error)
    VALUES (${fb.id}, ${shopId}, ${fb.nmId ?? null}, ${fb.productName ?? null}, ${fb.userName ?? null},
            ${fb.rating ?? null}, ${fb.text ?? null}, ${fb.pros ?? null}, ${fb.cons ?? null},
            ${fb.createdDate ? new Date(fb.createdDate) : null},
            ${error ? 'error' : 'answered'}, ${answer}, ${source}, ${error})
    ON CONFLICT (id, shop_id) DO NOTHING
  `
}

export async function listFeedbacks(shopId: number | null, status: string | null, limit = 200): Promise<FeedbackRow[]> {
  const db = getDb()
  if (!db) return []
  const conditions = [db`1=1`]
  if (shopId) conditions.push(db`f.shop_id = ${shopId}`)
  if (status) conditions.push(db`f.status = ${status}`)
  return (await db`
    SELECT f.id, f.shop_id, s.name AS shop_name, f.nm_id, f.product_name, f.user_name,
           f.rating, f.text, f.status, f.answer, f.source, f.error, f.processed_at
    FROM feedbacks f JOIN shops s ON s.id = f.shop_id
    WHERE ${db.join(conditions, db` AND `)}
    ORDER BY f.processed_at DESC
    LIMIT ${limit}
  `) as FeedbackRow[]
}
