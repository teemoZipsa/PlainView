/**
 * Monotonic intent tokens let asynchronous work prove that it still belongs
 * to the latest user action before it mutates visible state.
 */
export class LatestIntent {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  snapshot(): number {
    return this.generation;
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }
}
