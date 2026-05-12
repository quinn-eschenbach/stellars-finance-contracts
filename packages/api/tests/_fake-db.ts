/**
 * In-memory `QueryRunner` fake.
 *
 * `buildRestRoutes(db)` and `buildSseRoutes(db, br)` accept a `QueryRunner`
 * (the `select` + `execute` slice of drizzle's `Db`). This fake is the
 * second adapter at that seam — drizzle's real `Db` is the first — so the
 * routes can be driven without a Postgres.
 *
 *   - `enqueueSelect(rows)` and `enqueueExecute(rows)` push pre-baked
 *     responses onto a FIFO queue.
 *   - Each chain method returns the same builder so the chain is awaitable
 *     at any stop; awaiting the builder resolves to the next queued response.
 *   - `db.calls` records every operation so tests can assert query shape
 *     (e.g. "second select went through .where then .limit(1)") without
 *     coupling to drizzle internals.
 */

export interface SelectCall {
  kind: "select";
  fields?: unknown;
  ops: SelectOp[];
}

export type SelectOp =
  | { op: "from"; arg: unknown }
  | { op: "where"; arg: unknown }
  | { op: "orderBy"; arg: unknown }
  | { op: "limit"; arg: unknown };

export interface ExecuteCall {
  kind: "execute";
  sql: unknown;
}

export type RecordedCall = SelectCall | ExecuteCall;

type QueueItem =
  | { kind: "select"; rows: unknown[] }
  | { kind: "execute"; result: { rows: unknown[] } };

export class FakeDb {
  private queue: QueueItem[] = [];
  public calls: RecordedCall[] = [];

  enqueueSelect(rows: unknown[]) {
    this.queue.push({ kind: "select", rows });
    return this;
  }

  enqueueExecute(rows: unknown[]) {
    this.queue.push({ kind: "execute", result: { rows } });
    return this;
  }

  reset() {
    this.queue = [];
    this.calls = [];
  }

  /** Last recorded call (helper for terse assertions). */
  lastCall(): RecordedCall | undefined {
    return this.calls.at(-1);
  }

  /** Drizzle calls .select() with no args OR with a partial-fields object. */
  select(fields?: unknown): SelectBuilder {
    const item = this.queue.shift();
    if (!item || item.kind !== "select") {
      throw new Error(
        `FakeDb: no select queued (queue head = ${item?.kind ?? "empty"})`,
      );
    }
    const call: SelectCall = { kind: "select", fields, ops: [] };
    this.calls.push(call);
    return makeBuilder(item.rows, call);
  }

  execute(sql: unknown): Promise<{ rows: unknown[] }> {
    const item = this.queue.shift();
    if (!item || item.kind !== "execute") {
      throw new Error(
        `FakeDb: no execute queued (queue head = ${item?.kind ?? "empty"})`,
      );
    }
    this.calls.push({ kind: "execute", sql });
    return Promise.resolve(item.result);
  }
}

interface SelectBuilder extends PromiseLike<unknown[]> {
  from: (t: unknown) => SelectBuilder;
  where: (c: unknown) => SelectBuilder;
  orderBy: (c: unknown) => SelectBuilder;
  limit: (n: unknown) => SelectBuilder;
}

function makeBuilder(rows: unknown[], call: SelectCall): SelectBuilder {
  const builder: SelectBuilder = {
    from(arg) {
      call.ops.push({ op: "from", arg });
      return builder;
    },
    where(arg) {
      call.ops.push({ op: "where", arg });
      return builder;
    },
    orderBy(arg) {
      call.ops.push({ op: "orderBy", arg });
      return builder;
    },
    limit(arg) {
      call.ops.push({ op: "limit", arg });
      return builder;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

/**
 * The fake implements `QueryRunner` structurally, but drizzle's chainable
 * select type is generated from the schema and is too rich to model exactly
 * here. We narrow via a tiny `unknown` round-trip rather than `as any` so
 * the lie is contained to this one helper instead of leaking into every
 * test call site.
 */
import type { QueryRunner } from "@stellars/db";

export const asDb = (fake: FakeDb): QueryRunner => fake as unknown as QueryRunner;
