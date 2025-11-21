/**
 * Filters incoming data arrays to only emit items with monotonic field values greater than last seen.
 * Useful for time-series data where you only want new items based on an increasing field.
 */
export class LastSeenFilter<T, M = number> {
  private lastSeen: M | undefined;

  constructor(
    private fieldExtractor: (item: T) => M,
    private compareFn: (a: M, b: M) => number = (a, b) =>
      (a as any) - (b as any)
  ) {}

  /**
   * Process incoming data and return only items with field values greater than last seen.
   * Updates last seen to the maximum value encountered.
   */
  filter(data: T[]): T[] {
    const filtered: T[] = [];
    let maxValue = this.lastSeen;

    for (const item of data) {
      const value = this.fieldExtractor(item);

      if (
        this.lastSeen === undefined ||
        this.compareFn(value, this.lastSeen) > 0
      ) {
        filtered.push(item);

        if (maxValue === undefined || this.compareFn(value, maxValue) > 0) {
          maxValue = value;
        }
      }
    }

    if (maxValue !== undefined) {
      this.lastSeen = maxValue;
    }

    return filtered;
  }

  /** Reset to initial state. */
  clear(): void {
    this.lastSeen = undefined;
  }

  /** Get the last seen value. */
  getLastSeen(): M | undefined {
    return this.lastSeen;
  }
}
