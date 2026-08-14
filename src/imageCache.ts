export interface ImageRevision {
  fileSize: number;
  modifiedTimeNs: string;
}

export function revisionsMatch(left: ImageRevision, right: ImageRevision): boolean {
  return (
    left.fileSize === right.fileSize &&
    left.modifiedTimeNs === right.modifiedTimeNs
  );
}

interface CacheRecord<T> {
  revision: ImageRevision;
  value: T;
  weight: number;
}

export class RevisionLruCache<T> {
  private readonly entries = new Map<string, CacheRecord<T>>();
  private readonly capacity: number;
  private readonly maxWeight: number;
  private readonly weigh: (value: T) => number;
  private currentWeight = 0;

  constructor(
    capacity: number,
    maxWeight = Number.POSITIVE_INFINITY,
    weigh: (value: T) => number = () => 1
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Cache capacity must be a positive integer.');
    }
    if (!(maxWeight > 0)) {
      throw new Error('Cache weight limit must be positive.');
    }
    this.capacity = capacity;
    this.maxWeight = maxWeight;
    this.weigh = weigh;
  }

  private remove(key: string): void {
    const record = this.entries.get(key);
    if (!record) return;
    this.currentWeight -= record.weight;
    this.entries.delete(key);
  }

  get(key: string, revision: ImageRevision): T | undefined {
    const record = this.entries.get(key);
    if (!record) return undefined;

    if (!revisionsMatch(record.revision, revision)) {
      this.remove(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, record);
    return record.value;
  }

  isCurrent(key: string, revision: ImageRevision): boolean {
    const record = this.entries.get(key);
    return Boolean(record && revisionsMatch(record.revision, revision));
  }

  set(key: string, revision: ImageRevision, value: T): void {
    this.remove(key);
    const measuredWeight = this.weigh(value);
    const weight = Number.isFinite(measuredWeight)
      ? Math.max(0, measuredWeight)
      : Number.POSITIVE_INFINITY;
    if (weight > this.maxWeight) return;

    while (
      this.entries.size >= this.capacity ||
      this.currentWeight + weight > this.maxWeight
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.remove(oldestKey);
    }

    this.entries.set(key, { revision, value, weight });
    this.currentWeight += weight;
  }

  delete(key: string): void {
    this.remove(key);
  }

  get size(): number {
    return this.entries.size;
  }

  get totalWeight(): number {
    return this.currentWeight;
  }
}
