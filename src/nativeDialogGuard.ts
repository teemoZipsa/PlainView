export type NativeDialogResult<T> =
  | { started: false }
  | { started: true; value: T };

export class NativeDialogGuard {
  private active = false;
  private releaseTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  get isActive(): boolean {
    return this.active;
  }

  tryEnter(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  releaseAfter(delayMs: number): void {
    if (this.releaseTimer) globalThis.clearTimeout(this.releaseTimer);
    this.releaseTimer = globalThis.setTimeout(() => {
      this.releaseTimer = null;
      this.active = false;
    }, delayMs);
  }

  dispose(): void {
    if (this.releaseTimer) globalThis.clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    this.active = false;
  }
}

export async function runWithNativeDialogGuard<T>(
  guard: NativeDialogGuard,
  operation: () => T | Promise<T>,
  releaseDelayMs = 250
): Promise<NativeDialogResult<T>> {
  if (!guard.tryEnter()) return { started: false };

  try {
    return { started: true, value: await operation() };
  } finally {
    // Windows can forward the Escape that dismissed a native dialog back to
    // the WebView. Keep app shortcuts blocked through that queued key event.
    guard.releaseAfter(releaseDelayMs);
  }
}
