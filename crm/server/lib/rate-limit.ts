/**
 * Лимит попыток входа (в памяти процесса: сервис один, этого достаточно).
 * Считаем все попытки с IP и неудачные попытки на логин в скользящем окне.
 */

type Bucket = { hits: number[] };

export class SlidingWindowLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  private prune(key: string, now: number): Bucket {
    const bucket = this.buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((t) => now - t < this.windowMs);
    if (bucket.hits.length === 0) this.buckets.delete(key);
    else this.buckets.set(key, bucket);
    return bucket;
  }

  /** Сколько миллисекунд ждать до следующей попытки (0 — можно). */
  retryAfter(key: string, now = Date.now()): number {
    const bucket = this.prune(key, now);
    if (bucket.hits.length < this.max) return 0;
    return this.windowMs - (now - bucket.hits[0]);
  }

  hit(key: string, now = Date.now()): void {
    const bucket = this.prune(key, now);
    bucket.hits.push(now);
    this.buckets.set(key, bucket);
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Периодическая чистка устаревших ключей. */
  sweep(now = Date.now()): void {
    for (const key of [...this.buckets.keys()]) this.prune(key, now);
  }
}
