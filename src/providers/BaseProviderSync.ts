export abstract class BaseProviderSync<E> {
  callback?: (event: E) => void;

  // Register callback
  connect(callback: (event: E) => void): void {
    this.callback = callback;
  }

  // Emit event
  emit(event: E): void {
    this.callback!(event);
  }

  // Load sync resource
  abstract subscribe(symbols: string[]): void;

  // Get next
  abstract next(): E | undefined;

  // Release sync resource, upon called, next() should always return undefined, this method should not throw
  abstract disconnect(): void;
}
