export type EventListener = (event: string) => void;

export class EventBus {
	private readonly listeners = new Set<EventListener>();

	subscribe(listener: EventListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** One failing subscriber must not stop the rest from seeing the event. */
	emit(event: string): void {
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch (error) {
				console.warn('tickets: event listener failed:', error instanceof Error ? error.message : error);
			}
		}
	}
}
