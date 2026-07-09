import type { StorageAdapter } from '@aylith/tickets-core';
import { EventBus } from './events';
import { runDetached } from './launch';
import { createAdapter } from './registry';
import type { DaemonConfig } from './types/DaemonConfig';

export type ServerContext = {
	config: DaemonConfig;
	adapters: Map<string, StorageAdapter>;
	events: EventBus;
	/** Executes a launch command on the daemon host (injectable for tests). */
	runCommand: (command: string) => void;
};

export const createContext = (config: DaemonConfig, overrides: Partial<ServerContext> = {}): ServerContext => {
	const adapters = new Map<string, StorageAdapter>();
	for (const project of config.projects) {
		adapters.set(project.name, createAdapter(project));
	}
	return { config, adapters, events: new EventBus(), runCommand: runDetached, ...overrides };
};
