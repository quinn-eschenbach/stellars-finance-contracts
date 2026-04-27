/**
 * Per-key TTL dedup. Each entry expires independently, unlike a wholesale
 * Set + timer which can drop entries mid-flight under tight loops.
 *
 * Used to prevent the keeper from re-submitting on a (trader, symbol) pair
 * whose previous submission is still in flight or has recently been
 * processed. Scope is per-keeper-instance only — cross-keeper dedup is the
 * chain's job (the contract rejects duplicate liquidations cheaply).
 *
 *   if (!dedup.claim(key, 60_000)) continue;   // in flight or recently done
 *   try {
 *     await simulate();
 *     await submit();
 *     // success: leave claim, let it expire naturally
 *   } catch (err) {
 *     dedup.release(key);                       // free the slot for next tick
 *     throw err;
 *   }
 */
export class TtlDedup {
  private entries = new Map<string, number>();

  /**
   * Atomically check-and-set. Returns true iff `key` was free and the
   * caller now owns it until `now + ttlMs`. Returns false if the key is
   * currently claimed and not yet expired.
   */
  claim(key: string, ttlMs: number): boolean {
    const now = Date.now();
    const expiresAt = this.entries.get(key);
    if (expiresAt !== undefined && expiresAt > now) return false;
    this.entries.set(key, now + ttlMs);
    return true;
  }

  /** Release a claimed key so the next tick can re-claim it immediately. */
  release(key: string): void {
    this.entries.delete(key);
  }

  /** Returns true iff `key` is currently claimed and not expired. */
  has(key: string): boolean {
    const expiresAt = this.entries.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= Date.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  size(): number {
    return this.entries.size;
  }
}
