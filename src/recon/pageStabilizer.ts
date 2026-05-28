import type { Page } from '@playwright/test';

export interface SnapshotStabilizationOptions {
  mutationQuietWindowMs?: number;
  hardTimeoutMs?: number;
  rafCycles?: number;
}

export interface SnapshotStabilizationResult {
  durationMs: number;
  mutationQuietWindowMs: number;
  timedOut: boolean;
}

const DEFAULT_QUIET_WINDOW_MS = 500;
const DEFAULT_HARD_TIMEOUT_MS = 3_000;
const DEFAULT_RAF_CYCLES = 3;

export async function waitForSnapshotStability(
  page: Page,
  options: SnapshotStabilizationOptions = {}
): Promise<SnapshotStabilizationResult> {
  const mutationQuietWindowMs = options.mutationQuietWindowMs ?? DEFAULT_QUIET_WINDOW_MS;
  const hardTimeoutMs = options.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS;
  const rafCycles = options.rafCycles ?? DEFAULT_RAF_CYCLES;

  const startedAt = Date.now();
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await waitForRafCycles(page, rafCycles);

  const timedOut = !(await page
    .evaluate(
      ({ quietWindowMs, timeoutMs }) =>
        new Promise<boolean>((resolve) => {
          const start = performance.now();
          let lastMutationAt = performance.now();
          let done = false;
          let observer: MutationObserver | null = null;

          const finish = (stable: boolean) => {
            if (done) return;
            done = true;
            observer?.disconnect();
            resolve(stable);
          };

          observer = new MutationObserver(() => {
            lastMutationAt = performance.now();
          });
          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true
          });

          const tick = () => {
            const now = performance.now();
            if (now - start >= timeoutMs) {
              finish(false);
              return;
            }
            if (now - lastMutationAt >= quietWindowMs) {
              finish(true);
              return;
            }
            requestAnimationFrame(tick);
          };

          requestAnimationFrame(tick);
        }),
      { quietWindowMs: mutationQuietWindowMs, timeoutMs: hardTimeoutMs }
    )
    .catch(() => false));

  return {
    durationMs: Date.now() - startedAt,
    mutationQuietWindowMs,
    timedOut
  };
}

export async function waitForRafCycles(page: Page, cycles: number): Promise<void> {
  if (cycles <= 0) {
    return;
  }

  await page
    .evaluate(
      (rafCycles) =>
        new Promise<void>((resolve) => {
          let count = 0;
          const step = () => {
            count += 1;
            if (count >= rafCycles) {
              resolve();
              return;
            }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }),
      cycles
    )
    .catch(() => undefined);
}
