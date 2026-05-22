import { describe, it, expect } from 'vitest';
import { buildMessages } from '../src/main/answer';
import type { Card } from '../src/shared/types';

function card(id: string, body: string): Card {
  return { id, created: '2026-05-22T09:00:00.000Z', body, tags: [], attachments: [] };
}

describe('buildMessages', () => {
  it('numbers cards [1..n] and includes the question', () => {
    const msgs = buildMessages([card('a', 'first note'), card('b', 'second note')], 'what?');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toMatch(/\[n\]/);
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('[1] first note');
    expect(msgs[1].content).toContain('[2] second note');
    expect(msgs[1].content).toContain('what?');
  });
});
