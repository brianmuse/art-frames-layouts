import sample from '../fixtures/sample.json';

export function pageContext(locals: Record<string, unknown>) {
  const serverRendered = Boolean(locals.snapshot);
  const snapshot = (locals.snapshot || sample) as Record<string, any>;
  const now = new Date(snapshot.now);
  const timezone = snapshot.timezone || 'UTC';
  const format = (options: Intl.DateTimeFormatOptions) => now.toLocaleDateString('en-US', { timeZone: timezone, ...options });
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const number = (name: string) => Number(parts.find(part => part.type === name)?.value);
  const year = number('year'), month = number('month'), day = number('day');
  const start = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthCells = [...Array(start).fill(''), ...Array.from({ length: count }, (_, index) => String(index + 1))];
  return { snapshot, serverRendered, timeline: locals.timeline as string | undefined, format, monthCells, day };
}
