import { describe, expect, test } from 'bun:test';
import { nextTicketId } from '../id';

describe('nextTicketId', () => {
	test('starts at 0001', () => {
		expect(nextTicketId([])).toBe('0001');
	});

	test('increments the highest id', () => {
		expect(nextTicketId(['0001', '0003', '0002'])).toBe('0004');
	});

	test('ignores non-numeric ids', () => {
		expect(nextTicketId(['garbage', '0009'])).toBe('0010');
	});

	test('grows past the pad width', () => {
		expect(nextTicketId(['9999'])).toBe('10000');
	});
});
