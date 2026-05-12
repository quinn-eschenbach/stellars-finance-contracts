/**
 * In-memory adapter at the `Subscribable` seam. The real (Postgres-backed)
 * adapter is `Broadcaster`; this is the second one — driven by tests via
 * `dispatch(channel, payload)` to simulate LISTEN/NOTIFY without a database.
 *
 * `FakeBroadcaster` implements `Subscribable` natively, so it can be passed
 * straight to `buildSseRoutes` / `streamFromChannel` with no cast.
 */
import type { Notification, Subscribable } from "../src/broadcaster.js";

type Subscriber = (n: Notification) => void;

export class FakeBroadcaster implements Subscribable {
  subscribers: Map<string, Set<Subscriber>> = new Map();

  async subscribe(channel: string, fn: Subscriber): Promise<() => void> {
    let subs = this.subscribers.get(channel);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(channel, subs);
    }
    subs.add(fn);
    return () => {
      subs!.delete(fn);
    };
  }

  /** Fire a notification to every subscriber on `channel`. */
  dispatch(channel: string, payload: unknown) {
    const subs = this.subscribers.get(channel);
    if (!subs) return;
    for (const s of subs) s({ channel, payload });
  }

  subscriberCount(channel: string): number {
    return this.subscribers.get(channel)?.size ?? 0;
  }
}
