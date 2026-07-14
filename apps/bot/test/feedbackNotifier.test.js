import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildEmbed } = require('../src/notifiers/feedback.js');

describe('feedback notifier · buildEmbed', () => {
  it('formats a bug report with subject, message, and sender', () => {
    const embed = buildEmbed({
      kind: 'bug',
      subject: 'Sheet crashes',
      message: 'Opening the feats tab throws.',
      name: 'Ava',
      email: 'ava@example.com',
      page: 'https://pathway/vault/x',
      created_at: '2026-07-14T00:00:00.000Z',
    });
    const d = embed.data;
    expect(d.title).toContain('Bug report');
    expect(d.title).toContain('Sheet crashes');
    expect(d.description).toBe('Opening the feats tab throws.');
    const from = d.fields.find((f) => f.name === 'From');
    expect(from.value).toBe('Ava · ava@example.com');
    expect(d.fields.some((f) => f.name === 'Page')).toBe(true);
  });

  it('falls back to Anonymous and a default kind', () => {
    const embed = buildEmbed({ message: 'hi' });
    const d = embed.data;
    expect(d.title).toContain('Feedback'); // 'other' label
    expect(d.fields.find((f) => f.name === 'From').value).toBe('Anonymous');
    expect(d.description).toBe('hi');
  });

  it('never leaves an empty description (Discord rejects it)', () => {
    const embed = buildEmbed({ kind: 'suggestion', message: '' });
    expect(embed.data.description).toBe('(no message)');
  });
});
