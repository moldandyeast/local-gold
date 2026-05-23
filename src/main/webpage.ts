/** Maximum characters of page text sent to the model. */
export const MAX_PAGE_TEXT = 6000;

/** Reduce raw HTML to plain readable text, collapsed and length-capped. */
export function extractText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > MAX_PAGE_TEXT) text = text.slice(0, MAX_PAGE_TEXT);
  return text;
}
