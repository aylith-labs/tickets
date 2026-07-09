import type { StorageAdapter } from '@aylith/tickets-core';
import { EventBus } from './events';
import { createAdapter } from './registry';
import type { DaemonConfig } from './types/DaemonConfig';

export type ServerContext = {
	config: DaemonConfig;
	adapters: Map<string, StorageAdapter>;
	events: EventBus;
};

export const createContext = (config: DaemonConfig): ServerContext => {
	const adapters = new Map<string, StorageAdapter>();
	for (const project of config.projects) {
		adapters.set(project.name, createAdapter(project));
	}
	return { config, adapters, events: new EventBus() };
};
