import { describe, it, expect } from 'vitest';
import { extractText, MAX_PAGE_TEXT } from '../src/main/webpage';

describe('extractText', () => {
  it('strips tags and keeps text', () => {
    expect(extractText('<h1>Title</h1><p>Body text</p>')).toBe('Title Body text');
  });

  it('removes script and style content entirely', () => {
    const html = '<style>.x{color:red}</style><p>keep</p><script>alert(1)</script>';
    expect(extractText(html)).toBe('keep');
  });

  it('decodes basic HTML entities', () => {
    expect(extractText('<p>a &amp; b &lt;c&gt; &quot;d&quot;</p>')).toBe('a & b <c> "d"');
  });

  it('collapses runs of whitespace', () => {
    expect(extractText('<p>a\n\n   b\t c</p>')).toBe('a b c');
  });

  it('truncates to MAX_PAGE_TEXT characters', () => {
    const html = `<p>${'x'.repeat(MAX_PAGE_TEXT + 500)}</p>`;
    expect(extractText(html).length).toBe(MAX_PAGE_TEXT);
  });
});
