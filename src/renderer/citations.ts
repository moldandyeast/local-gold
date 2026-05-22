/** A run of answer text: plain prose, or a [n] citation marker. */
export interface Segment {
  text: string;
  /** The cited card number, or null for plain text. */
  citation: number | null;
}

/** Split answer text into plain segments and [n] citation markers. */
export function parseCitations(answer: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    if (m.index > last) {
      segments.push({ text: answer.slice(last, m.index), citation: null });
    }
    segments.push({ text: m[0], citation: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < answer.length) {
    segments.push({ text: answer.slice(last), citation: null });
  }
  return segments;
}
