/**
 * Serialize async actions through a single FIFO chain. Used to keep all
 * keeper submissions sequential under one Stellar account so the SDK's
 * sequence-number tracking doesn't race when both the hot and cold loops
 * want to submit at the same instant.
 *
 * Errors are isolated — one rejected action does not prevent the next
 * action from running, but the original promise still rejects so the
 * caller can react.
 */
export type Serialize = <T>(action: () => Promise<T>) => Promise<T>;

export function createSerializer(): Serialize {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(action: () => Promise<T>): Promise<T> => {
    const next = chain.then(action);
    chain = next.catch(() => undefined);
    return next;
  };
}
