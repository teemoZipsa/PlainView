export interface ImageRevision {
  fileSize: number;
  modifiedTimeMs: number;
}

export function revisionsMatch(left: ImageRevision, right: ImageRevision): boolean {
  return (
    left.fileSize === right.fileSize &&
    left.modifiedTimeMs === right.modifiedTimeMs
  );
}

interface CacheRecord<T> {
  revision: ImageRevision;
  value: T;
}

export class RevisionLruCache<T> {
  private readonly entries = new Map<string, CacheRecord<T>>();
  private readonly capacity: number;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Cache capacity must be a positive integer.');
    }
    this.capacity = capacity;
  }

  get(key: string, revision: ImageRevision): T | undefined {
    const record = this.entries.get(key);
    if (!record) return undefined;

    if (!revisionsMatch(record.revision, revision)) {
      this.entries.delete(key);
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
    this.entries.delete(key);

    while (this.entries.size >= this.capacity) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }

    this.entries.set(key, { revision, value });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
