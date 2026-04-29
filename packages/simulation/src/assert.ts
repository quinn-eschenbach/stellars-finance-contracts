const timestamp = () => new Date().toISOString().slice(11, 23);

export function log(label: string, value: unknown): void {
  console.log(`  [${timestamp()}] ${label}: ${String(value)}`);
}

export function assertEqual<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    const detail = `got ${String(actual)}, expected ${String(expected)}`;
    throw new Error(msg ? `${msg} — ${detail}` : `assertEqual failed: ${detail}`);
  }
}

export function assertGt(actual: bigint, threshold: bigint, msg?: string): void {
  if (actual <= threshold) {
    throw new Error(
      msg ?? `assertGt failed: ${actual} is not > ${threshold}`,
    );
  }
}

export function assertLt(actual: bigint, threshold: bigint, msg?: string): void {
  if (actual >= threshold) {
    throw new Error(
      msg ?? `assertLt failed: ${actual} is not < ${threshold}`,
    );
  }
}

export function assertGte(actual: bigint, threshold: bigint, msg?: string): void {
  if (actual < threshold) {
    throw new Error(
      msg ?? `assertGte failed: ${actual} is not >= ${threshold}`,
    );
  }
}

export function assertApprox(
  actual: bigint,
  expected: bigint,
  toleranceBps: number,
  msg?: string,
): void {
  const diff = actual > expected ? actual - expected : expected - actual;
  const maxDiff = (expected * BigInt(toleranceBps)) / 10_000n;
  if (diff > maxDiff) {
    throw new Error(
      msg ??
        `assertApprox failed: ${actual} not within ${toleranceBps}bps of ${expected} (diff=${diff}, max=${maxDiff})`,
    );
  }
}

export async function assertThrows(
  fn: () => Promise<unknown>,
  msg?: string,
): Promise<void> {
  try {
    await fn();
    throw new Error(msg ?? "assertThrows: expected function to throw");
  } catch (e: unknown) {
    if (e instanceof Error && e.message === (msg ?? "assertThrows: expected function to throw")) {
      throw e; // re-throw our own assertion error
    }
    // swallow the expected error
  }
}
