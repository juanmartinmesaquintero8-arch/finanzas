type Listener = () => void;

/**
 * Observer: los servicios avisan aquí tras cada escritura y las pantallas se vuelven a calcular.
 * `version` sube con cada cambio y sirve de llave para invalidar cálculos memoizados.
 */
export class ChangeBus {
  private listeners = new Set<Listener>();
  private current = 0;

  get version(): number {
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(): void {
    this.current += 1;
    for (const listener of [...this.listeners]) listener();
  }
}
