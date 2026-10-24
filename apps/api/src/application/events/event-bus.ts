import { Injectable } from '@nestjs/common';

type EventClass<T> = new (...args: never[]) => T;
type Handler<T> = (event: T) => void | Promise<void>;

/** Observer: publicación/suscripción síncrona-asíncrona de eventos de aplicación. */
@Injectable()
export class EventBus {
  private readonly handlers = new Map<EventClass<unknown>, Set<Handler<never>>>();

  subscribe<T>(type: EventClass<T>, handler: Handler<T>): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler as Handler<never>);
    this.handlers.set(type, set);
    return () => void set.delete(handler as Handler<never>);
  }

  async publish<T extends object>(event: T): Promise<void> {
    const set = this.handlers.get(event.constructor as EventClass<unknown>);
    if (!set) return;
    for (const handler of [...set]) await (handler as Handler<T>)(event);
  }
}
