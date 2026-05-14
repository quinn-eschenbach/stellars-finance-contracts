import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { CHANNELS, type ChannelPayloads } from "@stellars/db";
import {
  SSE_BUFFER_MAX_LEN,
  SSE_HEARTBEAT_INTERVAL_MS,
} from "@stellars/config";
import type { Notification, Subscribable } from "./broadcaster.js";

/**
 * The shared pipeline behind every Postgres-NOTIFY → SSE endpoint.
 *
 * Each route used to copy the same 15-line scaffold: make a queue, subscribe,
 * register onAbort, run a `for await`, write to the stream, run a `finally`
 * unsub. The variable parts were tiny — channel name, optional payload
 * filter, how to project a notification into an event. We just shipped a
 * subscriber-leak fix because that scaffold was duplicated five ways; one
 * caller forgot the cleanup wiring and only got noticed in tests.
 *
 * `streamFromChannel` owns the queue, the onAbort cleanup, the for-await
 * loop, and the finally unsub. Callers supply only the variable parts: the
 * channel key (which types the payload via `ChannelPayloads[K]`), an
 * optional filter, and a projector that returns the SSE event spec or
 * `null` to skip the notification.
 */

type ChannelKey = keyof typeof CHANNELS;

export interface SseEventSpec {
  event: string;
  id: string;
  /** Helper JSON.stringifies this before writing. */
  data: unknown;
}

export interface StreamFromChannelOpts<K extends ChannelKey> {
  channelKey: K;
  /**
   * Synchronous filter applied at the broadcaster callback — before the
   * notification ever hits the consumer queue. Use this when most events
   * aren't for this client (e.g. filtering on `symbol`); it avoids waking
   * the consumer for a notification it would only drop anyway.
   */
  filter?: (payload: ChannelPayloads[K] | null) => boolean;
  /** Build the SSE event from the (typed) payload, or return null to skip. */
  project: (payload: ChannelPayloads[K] | null) => Promise<SseEventSpec | null>;
}

export function streamFromChannel<K extends ChannelKey>(
  c: Context,
  br: Subscribable,
  opts: StreamFromChannelOpts<K>,
) {
  return streamSSE(c, async (s) => {
    const queue = makeQueue<Notification>(SSE_BUFFER_MAX_LEN);
    const unsub = await br.subscribe(CHANNELS[opts.channelKey], (n) => {
      const payload = n.payload as ChannelPayloads[K] | null;
      if (opts.filter && !opts.filter(payload)) return;
      queue.push(n);
    });
    // 15s heartbeat keeps the connection alive through load balancers /
    // proxies that idle-close silent streams. Browsers also use ping events
    // to detect a dead connection earlier than the TCP timeout.
    const heartbeat = setInterval(() => {
      s.writeSSE({ event: "ping", data: "" }).catch(() => {
        // Write failures here mean the stream is dead — the for-await loop
        // will surface that on its next iteration; nothing for us to do here.
      });
    }, SSE_HEARTBEAT_INTERVAL_MS);
    // s.onAbort fires when the client disconnects (or hono aborts the
    // stream); closing the queue unblocks the for-await so the `finally`
    // below runs and unsub() removes our broadcaster handle.
    s.onAbort(() => queue.close());
    try {
      for await (const n of queue) {
        const payload = n.payload as ChannelPayloads[K] | null;
        // A broadcaster resync notification means the LISTEN socket
        // reconnected — the client may have missed events while we were
        // down. Surface as an SSE `resync` event so the consumer can
        // re-fetch state.
        if (payload && typeof payload === "object" && "__resync" in payload) {
          await s.writeSSE({ event: "resync", data: "" });
          continue;
        }
        const ev = await opts.project(payload);
        if (!ev) continue;
        await s.writeSSE({ event: ev.event, id: ev.id, data: JSON.stringify(ev.data) });
      }
    } finally {
      clearInterval(heartbeat);
      unsub();
    }
  });
}

/**
 * Tiny single-producer/single-consumer async queue. Private to this module —
 * its only correctness obligation is "push from a sync callback, consume via
 * for-await, close to unblock a pending next()." Promoting it to a public
 * module would buy nothing today (one consumer); keeping it local keeps the
 * abort/cleanup invariants concentrated here.
 *
 * `maxLen` caps the buffered backlog so a slow consumer + busy channel
 * cannot OOM the API. Drop-oldest policy: the newest events are the most
 * relevant to a real-time SSE consumer, so we discard the oldest pending
 * notifications when overrun.
 */
function makeQueue<T>(maxLen: number): AsyncIterable<T> & { push: (v: T) => void; close: () => void } {
  const buf: T[] = [];
  const waiters: Array<(v: IteratorResult<T>) => void> = [];
  let closed = false;
  let dropped = 0;
  const push = (v: T) => {
    if (closed) return;
    if (waiters.length > 0) {
      waiters.shift()!({ value: v, done: false });
    } else {
      if (buf.length >= maxLen) {
        // Drop oldest. Count drops to surface in logs periodically.
        buf.shift();
        dropped += 1;
        if (dropped === 1 || dropped % 100 === 0) {
          console.warn(`[sse-stream] queue overflow — dropped=${dropped}`);
        }
      }
      buf.push(v);
    }
  };
  const close = () => {
    if (closed) return;
    closed = true;
    while (waiters.length > 0) {
      waiters.shift()!({ value: undefined as never, done: true });
    }
  };
  const iter: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (buf.length > 0) {
            return Promise.resolve({ value: buf.shift()!, done: false });
          }
          if (closed) return Promise.resolve({ value: undefined as never, done: true });
          return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve));
        },
        return() {
          close();
          return Promise.resolve({ value: undefined as never, done: true });
        },
      };
    },
  };
  return Object.assign(iter, { push, close });
}
