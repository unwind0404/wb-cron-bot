// Доступ к БД (Postgres, бесплатный тариф Neon).
// Если DATABASE_URL не задан, приложение работает в режиме env-only:
// один магазин из переменной окружения, без истории отзывов.

import postgres from 'postgres'

type Sql = ReturnType<typeof postgres>

let client: Sql | null = null

/** Возвращает подключение к БД или null, если DATABASE_URL не задан. */
export function getDb(): Sql | null {
  const url = process.env.DATABASE_URL
  if (!url) return null
  if (!client) {
    client = postgres(url, { ssl: 'require', max: 1 })
  }
  return client
}

/** Создаёт таблицы, если их ещё нет. Идемпотентно. */
export async function initDb(): Promise<void> {
  const db = getDb()
  if (!db) return

  await db`
    CREATE TABLE IF NOT EXISTS shops (
      id         SERIAL PRIMARY KEY,
      name       TEXT        NOT NULL,
      token      TEXT        NOT NULL,
      mode       TEXT        NOT NULL DEFAULT 'templates',
      enabled    BOOLEAN     NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `

  await db`
    CREATE TABLE IF NOT EXISTS feedbacks (
      id            TEXT        NOT NULL,
      shop_id       INTEGER     NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      nm_id         INTEGER,
      product_name  TEXT,
      subject_name  TEXT,
      user_name     TEXT,
      rating        INTEGER,
      text          TEXT,
      pros          TEXT,
      cons          TEXT,
      photo_links   JSONB       NOT NULL DEFAULT '[]',
      video_url     TEXT,
      video_preview TEXT,
      created_date  TIMESTAMPTZ,
      status        TEXT        NOT NULL DEFAULT 'answered',
      answer        TEXT,
      source        TEXT,
      error         TEXT,
      processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (id, shop_id)
    )
  `

  await db`CREATE INDEX IF NOT EXISTS idx_feedbacks_shop ON feedbacks (shop_id, processed_at DESC)`
}

// ---------- Магазины ----------

export type ShopMode = 'templates' | 'llm'

export type Shop = {
  id: number
  name: string
  token: string
  mode: ShopMode
  enabled: boolean
}

export async function listShops(): Promise<Shop[]> {
  const db = getDb()
  if (!db) return []
  return await db`
    SELECT id, name, token, mode, enabled
    FROM shops
    ORDER BY id
  ` as Shop[]
}

export async function addShop(name: string, token: string, mode: ShopMode): Promise<number> {
  const db = getDb()
  if (!db) throw new Error('БД не настроена (DATABASE_URL)')
  const rows = await db`
    INSERT INTO shops (name, token, mode)
    VALUES (${name}, ${token}, ${mode})
    RETURNING id
  ` as { id: number }[]
  return rows[0].id
}

export async function updateShopMode(id: number, mode: ShopMode): Promise<void> {
  const db = getDb()
  if (!db) throw new Error('БД не настроена (DATABASE_URL)')
  await db`UPDATE shops SET mode = ${mode} WHERE id = ${id}`
}

export async function setShopEnabled(id: number, enabled: boolean): Promise<void> {
  const db = getDb()
  if (!db) throw new Error('БД не настроена (DATABASE_URL)')
  await db`UPDATE shops SET enabled = ${enabled} WHERE id = ${id}`
}

export async function deleteShop(id: number): Promise<void> {
  const db = getDb()
  if (!db) throw new Error('БД не настроена (DATABASE_URL)')
  await db`DELETE FROM shops WHERE id = ${id}`
}

// ---------- Отзывы ----------

export type FeedbackRow = {
  id: string
  shop_id: number
  shop_name: string | null
  nm_id: number | null
  product_name: string | null
  subject_name: string | null
  user_name: string | null
  rating: number | null
  text: string | null
  pros: string | null
  cons: string | null
  photo_links: string[]
  video_url: string | null
  video_preview: string | null
  status: string
  answer: string | null
  source: string | null
  error: string | null
  processed_at: string
}

export type FeedbackInput = {
  id: string
  nmId?: number
  productName?: string
  subjectName?: string
  userName?: string
  rating?: number
  text?: string
  pros?: string
  cons?: string
  photoLinks?: string[]
  videoUrl?: string | null
  videoPreview?: string | null
  createdDate?: string
}

export async function saveFeedback(
  shopId: number,
  fb: FeedbackInput,
  answer: string | null,
  source: string | null,
  error: string | null,
): Promise<void> {
  const db = getDb()
  if (!db) return

  await db`
    INSERT INTO feedbacks
      (id, shop_id, nm_id, product_name, subject_name, user_name, rating, text, pros, cons,
       photo_links, video_url, video_preview, created_date, status, answer, source, error)
    VALUES
      (${fb.id}, ${shopId}, ${fb.nmId ?? null}, ${fb.productName ?? null}, ${fb.subjectName ?? null},
       ${fb.userName ?? null}, ${fb.rating ?? null}, ${fb.text ?? null}, ${fb.pros ?? null}, ${fb.cons ?? null},
       ${db.json(fb.photoLinks ?? [])}, ${fb.videoUrl ?? null}, ${fb.videoPreview ?? null},
       ${fb.createdDate ? new Date(fb.createdDate) : null},
       ${error ? 'error' : 'answered'}, ${answer}, ${source}, ${error})
    ON CONFLICT (id, shop_id) DO NOTHING
  `
}

export async function listFeedbacks(
  shopId: number | null,
  status: string | null,
  limit = 200,
): Promise<FeedbackRow[]> {
  const db = getDb()
  if (!db) return []

  const conditions = [db`true`]
  if (shopId !== null) conditions.push(db`f.shop_id = ${shopId}`)
  if (status) conditions.push(db`f.status = ${status}`)

  return await db`
    SELECT f.id, f.shop_id, s.name AS shop_name, f.nm_id, f.product_name, f.subject_name,
           f.user_name, f.rating, f.text, f.pros, f.cons, f.photo_links, f.video_url,
           f.video_preview, f.status, f.answer, f.source, f.error, f.processed_at
    FROM feedbacks f
    JOIN shops s ON s.id = f.shop_id
    WHERE ${db.join(conditions, db` AND `)}
    ORDER BY f.processed_at DESC
    LIMIT ${limit}
  ` as FeedbackRow[]
}
}
