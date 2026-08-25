// Клиент WB API «Вопросы и отзывы»
// Документация: WB_API_REFERENCE.md (feedbacks-api.wildberries.ru)

const BASE = 'https://feedbacks-api.wildberries.ru'

export type WbFeedback = {
  id: string
  text?: string
  pros?: string
  cons?: string
  productValuation?: number
  createdDate?: string
  userName?: string
  productDetails?: { nmId?: number; productName?: string }
}

export class WbClient {
  constructor(private token: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: this.token,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })

    if (res.status === 429) throw new Error('WB rate limit (429)')
    if (res.status === 401) throw new Error('Токен WB невалиден или категория не совпадает (401)')
    if (res.status === 402) throw new Error('Требуется оплата тарифа WB API (402)')
    if (!res.ok && res.status !== 204) {
      const body = await res.text().catch(() => '')
      // тело ошибки WB может содержать служебные данные — наружу отдаём только статус
      throw new Error(`WB API ${res.status}: ${body.slice(0, 300)}`)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  /** Неотвеченные отзывы. */
  async getUnansweredFeedbacks(take = 100, skip = 0): Promise<WbFeedback[]> {
    const data = await this.request<{
      data: { feedbacks: WbFeedback[] }
      error: boolean
      errorText: string
    }>(`/api/v1/feedbacks?isAnswered=false&take=${take}&skip=${skip}&order=dateDesc`)
    return data.data?.feedbacks ?? []
  }

  /** Ответить на отзыв. Успех = 204 без тела. */
  async answerFeedback(feedbackId: string, text: string): Promise<boolean> {
    await this.request('/api/v1/feedbacks/answer', {
      method: 'POST',
      body: JSON.stringify({ id: feedbackId, text }),
    })
    return true
  }
}
