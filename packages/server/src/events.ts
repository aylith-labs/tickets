export type EventListener = (event: string) => void;

export class EventBus {
	private readonly listeners = new Set<EventListener>();

	subscribe(listener: EventListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(event: string): void {
		for (const listener of this.listeners) listener(event);
	}
}
