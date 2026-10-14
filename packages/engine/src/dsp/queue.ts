/**
 * Fixed-capacity FIFO used between pipeline stages. It never grows: when full, it applies the
 * configured drop policy and counts the drop. This is the backpressure primitive of the engine.
 */
export type DropPolicy = "drop-oldest" | "drop-newest";

export class BoundedQueue<T> {
  private buf: Array<T | undefined>;
  private head = 0;
  private size = 0;
  drops = 0;
  pushed = 0;
  popped = 0;

  constructor(readonly capacity: number, readonly policy: DropPolicy = "drop-oldest") {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("capacity must be a positive integer");
    this.buf = new Array(capacity);
  }

  get length() {
    return this.size;
  }

  push(item: T): boolean {
    this.pushed++;
    if (this.size === this.capacity) {
      this.drops++;
      if (this.policy === "drop-newest") return false;
      this.buf[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.size--;
    }
    this.buf[(this.head + this.size) % this.capacity] = item;
    this.size++;
    return true;
  }

  shift(): T | undefined {
    if (this.size === 0) return undefined;
    const v = this.buf[this.head];
    this.buf[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.size--;
    this.popped++;
    return v;
  }

  /** Snapshot of the queued items, oldest first, without consuming them. */
  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.size; i++) out.push(this.buf[(this.head + i) % this.capacity] as T);
    return out;
  }

  peek(): T | undefined {
    return this.size ? this.buf[this.head] : undefined;
  }

  clear() {
    this.buf = new Array(this.capacity);
    this.head = 0;
    this.size = 0;
  }
}

/** Fixed-length ring of numbers (Float64), used for per-link time series. */
export class RingSeries {
  readonly data: Float64Array;
  private start = 0;
  length = 0;
  constructor(readonly capacity: number) {
    this.data = new Float64Array(capacity);
  }
  push(v: number) {
    if (this.length < this.capacity) {
      this.data[(this.start + this.length) % this.capacity] = v;
      this.length++;
    } else {
      this.data[this.start] = v;
      this.start = (this.start + 1) % this.capacity;
    }
  }
  at(i: number) {
    return this.data[(this.start + i) % this.capacity];
  }
  toArray(): Float64Array {
    const out = new Float64Array(this.length);
    for (let i = 0; i < this.length; i++) out[i] = this.at(i);
    return out;
  }
  clear() {
    this.start = 0;
    this.length = 0;
  }
}
