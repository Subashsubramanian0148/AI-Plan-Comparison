// Domain logic for the plan comparison prototype (no DOM access here).

export type User = { name: string; email: string; initials: string };
export type Doc = { name: string; size: number; demo?: boolean; kind?: string };

/** How a provision moved between the two plan years. */
export type Change = 'added' | 'removed' | 'modified' | 'unchanged';
/** What the change means for participants. */
export type Effect = 'benefit' | 'disadvantage' | 'neutral' | 'mixed';
export type Confidence = 'high' | 'medium' | 'low';
export type Side = 'prior' | 'current';
/** Where a value was read: document, page, section and the supporting text. */
export type SourceRef = { page: number; section: string; quote: string };
/** The fields a reviewer can correct. The AI's version is kept separately and never overwritten. */
export type FindingText = { prior: string; current: string; summary: string; why: string; participants: string; effect: Effect };
export type Provision = FindingText & {
  id: string; name: string; category: string; change: Change; confidence: Confidence; confidenceNote?: string;
  // The takeover review SOP rule this finding was compared under.
  sop?: string;
  refs: { prior?: SourceRef; current?: SourceRef };
  ai: FindingText;
  note: string;
  // Reviewer decision: verified, or flagged for follow-up with a reason.
  review?: { state: 'verified' | 'flagged'; reason?: string; by: User; at: string };
  // Sides whose source the reviewer has checked.
  sourceChecked?: Side[];
};

export type PlanRecord = {
  id: string; planName: string; planId: string; priorProvider: string; currentProvider: string;
  priorYear: number; currentYear: number;
  processDate: string; processDay: string; modifiedAt: string; modifiedBy: User; notes: string;
  status: 'completed' | 'cancelled'; documents: { prior: Doc[]; current: Doc[] };
  provisions: Provision[];
  // Parts of a document the AI couldn't read; findings there may be incomplete.
  unreadable?: { side: Side; section: string; pages: string }[];
  failure?: { doc: string; reason: string };
  submittedAt?: string; submittedBy?: User;
};
export type Request = { prior: Doc[]; current: Doc[] };
export type Bucket = keyof Request;
export type Filters = { plan: string; review: string; date: string; status: string };

export const DEMO_USER: User = { name: 'Alex Morgan', email: 'alex.morgan@example.com', initials: 'AM' };
export const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const xml = (value: unknown) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
export const localDate = (value: string) => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const dateLabel = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(new Date(value));
export const timeLabel = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
export const fileSize = (size: number) => size >= 1048576 ? (size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(size / 1024)) + ' KB';
/** Page count shown for a document (sample data: derived from its size). */
export const pageCount = (doc?: Doc) => doc ? Math.min(120, Math.max(12, Math.round(doc.size / 52000))) : 0;

const ref = (page: number, section: string, quote: string): SourceRef => ({ page, section, quote });
type Seed = Omit<Provision, 'ai' | 'note' | 'review' | 'sourceChecked'>;
// Sample findings. Unchanged provisions are kept so the overview can say what stayed the same.
const FINDINGS: Seed[] = [
  { id: 'eligibility-service', sop: 'SOP 8.I', name: 'Service requirement', category: 'Eligibility', change: 'modified', effect: 'disadvantage', confidence: 'high',
    prior: '2 months of service', current: '4 months of service',
    summary: 'The service needed to join the plan rises from 2 months to 4 months.',
    why: 'New hires wait 2 months longer before they can save and receive the employer match.',
    participants: 'Employees hired on or after the effective date. Current participants keep their eligibility.',
    refs: { prior: ref(4, '1.03 Eligibility service', 'An Employee shall become an Eligible Employee upon completion of 2 months of Service.'),
      current: ref(3, '2.01 Eligibility service', 'An Employee shall become an Eligible Employee upon completion of 4 months of Service.') } },
  { id: 'entry-date', sop: 'SOP 1 and 7', name: 'Entry dates', category: 'Eligibility', change: 'modified', effect: 'benefit', confidence: 'high',
    prior: 'First day of each quarter', current: 'First day of each month',
    summary: 'Entry dates move from quarterly to monthly.',
    why: 'Eligible employees can join within a month instead of waiting up to 3 months.',
    participants: 'Employees who become eligible during the year.',
    refs: { prior: ref(4, '1.05 Entry dates', 'The Entry Date shall be the first day of each Plan Year quarter coinciding with or next following eligibility.'),
      current: ref(3, '2.03 Entry dates', 'The Entry Date shall be the first day of each month coinciding with or next following eligibility.') } },
  { id: 'auto-enroll', sop: 'SOP 7', name: 'Automatic enrollment', category: 'Contributions', change: 'added', effect: 'benefit', confidence: 'high',
    prior: '', current: 'New employees are enrolled at 3% of pay, rising 1% a year to 6%. They can opt out within 90 days.',
    summary: 'Automatic enrollment is new. New hires start saving 3% of pay unless they opt out.',
    why: 'Automatic enrollment raises participation, especially among younger and lower-paid employees.',
    participants: 'New hires from the effective date. Existing employees are not enrolled unless the employer runs a sweep.',
    refs: { current: ref(6, '4.02 Automatic contribution arrangement', 'The Employer will automatically enroll each Eligible Employee at a deferral rate of 3% of Compensation, increasing by 1% each Plan Year to a maximum of 6%, unless the Employee elects otherwise within 90 days.') } },
  { id: 'employer-match', sop: 'SOP 7', name: 'Employer match', category: 'Contributions', change: 'modified', effect: 'disadvantage', confidence: 'high',
    prior: '100% of the first 4% of pay', current: '50% of the first 6% of pay',
    summary: 'The most the employer matches falls from 4% to 3% of pay, and employees must save 6% to get it.',
    why: 'Someone earning $50,000 and saving 6% gets $1,500 a year instead of $2,000.',
    participants: 'Everyone who receives the match. Those saving less than 4% lose half of their match.',
    refs: { prior: ref(7, '3.01 Matching contributions', 'The Employer shall contribute a Matching Contribution equal to 100% of Elective Deferrals not exceeding 4% of Compensation.'),
      current: ref(8, '4.05 Matching contributions', 'The Employer shall contribute a Matching Contribution equal to 50% of Elective Deferrals not exceeding 6% of Compensation.') } },
  { id: 'match-allocation', sop: 'SOP 8.II', name: 'Match hours requirement', category: 'Contributions', change: 'modified', effect: 'disadvantage', confidence: 'medium',
    confidenceNote: 'The 1,000-hour rule is in the summary plan description but not in the adoption agreement.',
    prior: 'No minimum hours', current: '1,000 hours of service in the plan year',
    summary: 'Employees now need 1,000 hours in the plan year to receive the match.',
    why: 'Part-time and seasonal employees may get no match at all.',
    participants: 'Employees working fewer than about 20 hours a week, from the next plan year.',
    refs: { prior: ref(7, '3.04 Allocation conditions', 'Matching Contributions shall be allocated to all Participants without regard to Hours of Service.'),
      current: ref(9, '4.08 Allocation conditions', 'A Participant must complete at least 1,000 Hours of Service during the Plan Year to share in the Matching Contribution.') } },
  { id: 'vesting', sop: 'SOP 8', name: 'Vesting schedule', category: 'Vesting', change: 'modified', effect: 'disadvantage', confidence: 'high',
    prior: '3-year cliff: 100% after 3 years', current: '6-year graded: 20% a year from year 2, 100% after 6 years',
    summary: 'Full vesting moves from 3 years to 6 years.',
    why: 'Employees who leave in their first 6 years keep less of the employer money.',
    participants: 'New employer contributions for all participants. Amounts already vested stay vested.',
    refs: { prior: ref(11, '5.02 Vesting schedule', 'A Participant shall be 100% vested in Matching Contributions upon completion of 3 Years of Vesting Service.'),
      current: ref(12, '6.02 Vesting schedule', 'Vested percentage: 2 years 20%; 3 years 40%; 4 years 60%; 5 years 80%; 6 years 100%.') } },
  { id: 'predecessor-service', sop: 'SOP 8.III', name: 'Prior employer service', category: 'Service crediting', change: 'modified', effect: 'mixed', confidence: 'high',
    prior: 'Service with the predecessor employer counts', current: 'Service with the predecessor employer does not count',
    summary: 'Service with the predecessor employer no longer counts for new joiners.',
    why: 'Current participants keep the service already credited, but rehires from the predecessor start from zero.',
    participants: 'Rehires and employees joining from the predecessor company.',
    refs: { prior: ref(5, '1.09 Predecessor service', 'Service with Harbor Holdings, Inc. shall be credited for eligibility and vesting purposes.'),
      current: ref(5, '2.07 Predecessor service', 'Service with any predecessor employer shall not be credited.') } },
  { id: 'loans', sop: 'SOP 7', name: 'Participant loans', category: 'Loans and withdrawals', change: 'removed', effect: 'disadvantage', confidence: 'low',
    confidenceNote: 'No loan section was found in the current documents. Loans may be in a separate loan policy that wasn\'t uploaded.',
    prior: 'Available: up to 50% of the vested balance, $50,000 maximum', current: '',
    summary: 'Participant loans weren\'t found in the current plan.',
    why: 'If loans end, participants lose a way to borrow from their savings without tax or penalty.',
    participants: 'Participants with an outstanding loan, or who rely on loans for emergencies.',
    refs: { prior: ref(15, '8.01 Participant loans', 'Loans shall be made available to Participants in an amount not exceeding the lesser of 50% of the vested Account balance or $50,000.') } },
  { id: 'in-service', sop: 'SOP 7', name: 'In-service withdrawals at 59½', category: 'Loans and withdrawals', change: 'removed', effect: 'disadvantage', confidence: 'medium',
    confidenceNote: 'The current summary mentions "other withdrawals" without saying at what age.',
    prior: 'Available from age 59½', current: '',
    summary: 'Withdrawals while still working, from age 59½, weren\'t found in the current plan.',
    why: 'Older employees may lose access to their savings until they leave or retire.',
    participants: 'Employees aged 59½ and over.',
    refs: { prior: ref(16, '8.04 In-service withdrawals', 'A Participant who has attained age 59½ may withdraw all or part of the vested Account while employed.') } },
  { id: 'valuation', sop: 'SOP 7', name: 'Account valuation', category: 'Administration', change: 'modified', effect: 'neutral', confidence: 'high',
    prior: 'Accounts valued quarterly', current: 'Accounts valued daily',
    summary: 'Accounts are valued daily instead of quarterly.',
    why: 'An administrative change. It doesn\'t change what participants receive.',
    participants: 'No direct effect. Statements and trades use up-to-date values.',
    refs: { prior: ref(18, '9.02 Valuation date', 'Accounts shall be valued as of the last day of each Plan Year quarter.'),
      current: ref(20, '10.02 Valuation date', 'Accounts shall be valued as of each business day.') } },
  ...([
    ['eligibility-age', 'Eligibility age', 'Eligibility', 'Age 21'],
    ['elective-deferrals', 'Pre-tax deferrals', 'Contributions', 'Permitted'],
    ['roth', 'Roth contributions', 'Contributions', 'Permitted'],
    ['profit-sharing', 'Profit sharing', 'Contributions', 'Discretionary employer contribution'],
    ['hardship', 'Hardship withdrawals', 'Loans and withdrawals', 'Permitted under plan terms'],
    ['retirement-age', 'Normal retirement age', 'Retirement', 'Age 65'],
  ] as const).map(([id, name, category, value]): Seed => ({ id, name, category, change: 'unchanged', effect: 'neutral', confidence: 'high',
    prior: value, current: value, summary: 'No change.', why: '', participants: '', refs: {} })),
];

const AI_KEYS = ['prior', 'current', 'summary', 'why', 'participants', 'effect'] as const;
const aiOf = (p: FindingText): FindingText => ({ prior: p.prior, current: p.current, summary: p.summary, why: p.why, participants: p.participants, effect: p.effect });
export function findings(): Provision[] {
  return FINDINGS.map(f => ({ ...clone(f), ai: aiOf(f), note: '' }));
}
/** True when the reviewer changed any AI field. */
export const isEdited = (p: Provision) => AI_KEYS.some(k => p[k] !== p.ai[k]);
export const editedKeys = (p: Provision) => AI_KEYS.filter(k => p[k] !== p.ai[k]);
export const changes = (r: PlanRecord) => r.provisions.filter(p => p.change !== 'unchanged');
/** Findings to look at closely: the AI was unsure, or a provision went missing. */
export const needsAttention = (p: Provision) => p.change !== 'unchanged' && (p.confidence !== 'high' || p.change === 'removed');

export function setReview(record: PlanRecord, id: string, review: Provision['review'] | null, now = new Date().toISOString()): PlanRecord {
  const next = clone(record);
  next.provisions = next.provisions.map(p => p.id !== id ? p : { ...p, review: review ?? undefined });
  next.modifiedAt = now; next.modifiedBy = clone(DEMO_USER);
  return next;
}
export function updateFinding(record: PlanRecord, id: string, patch: Partial<Provision>, now = new Date().toISOString()): PlanRecord {
  const next = clone(record);
  next.provisions = next.provisions.map(p => p.id === id ? { ...p, ...clone(patch) } : p);
  next.modifiedAt = now; next.modifiedBy = clone(DEMO_USER);
  return next;
}

/** Sample data: the first `keep` changes stay changed, the rest read as unchanged, so records differ. */
function keepChanges(list: Provision[], keep: number) {
  let n = 0;
  return list.map(p => p.change === 'unchanged' || ++n <= keep ? p
    : (v => ({ ...p, change: 'unchanged' as const, prior: v, current: v, ai: { ...p.ai, prior: v, current: v }, effect: 'neutral' as const, refs: {} }))(p.prior || p.current));
}

export function seedRecords(): PlanRecord[] {
  const data = [
    ['PC-1036', 'Harbor Manufacturing 401(k)', 'PL-20481', 'Ascensus', 'Lincoln Financial', '2026-11-06T10:25:00', 'Alex Morgan', 10, 'draft'],
    ['PC-1035', 'Cedar Valley Services 401(k)', 'PL-20465', 'Voya', 'Empower', '2026-11-05T14:10:00', 'Sarah Chen', 6, 'partial'],
    ['PC-1034', 'Northstar Technologies 401(k)', 'PL-20422', 'Fidelity Workplace Investing Retirement Services', 'Voya Financial Retirement Plan Services', '2026-11-04T11:45:00', 'Michael Lee', 8, 'draft'],
    ['PC-1033', 'Oakridge Consulting 401(k)', 'PL-20390', 'Empower', 'Principal', '2026-11-03T09:32:00', 'Alex Morgan', 5, 'submitted'],
    ['PC-1032', 'Summit Healthcare 401(k)', 'PL-20371', 'Principal', 'Fidelity', '2026-10-30T16:05:00', 'Sarah Chen', 7, 'flagged'],
    ['PC-1031', 'Brookfield Industries 401(k)', 'PL-20314', 'Ascensus', 'Empower', '2026-10-28T13:50:00', 'Michael Lee', 4, 'submitted'],
  ] as const;
  const records: PlanRecord[] = data.map(([id, planName, planId, priorProvider, currentProvider, processDate, name, keep, state]) => {
    const by: User = { name, email: name.toLowerCase().replace(' ', '.') + '@example.com', initials: name.split(' ').map(p => p[0]).join('') };
    const slug = planName.split(' ')[0];
    let provisions = keepChanges(findings(), keep);
    const done = (p: Provision, i: number): Provision => p.change === 'unchanged' ? p
      : state === 'flagged' && i === 7 ? { ...p, review: { state: 'flagged', reason: 'Asked the provider for the loan policy.', by, at: processDate } }
      : { ...p, review: { state: 'verified', by, at: processDate } };
    if (state === 'submitted' || state === 'flagged') provisions = provisions.map(done);
    if (state === 'partial') provisions = provisions.map((p, i) => i < 3 ? done(p, i) : p);
    const submitted = state === 'submitted' || state === 'flagged';
    return {
      id, planName, planId, priorProvider, currentProvider, priorYear: 2025, currentYear: 2026, processDate, processDay: localDate(processDate),
      modifiedAt: processDate, modifiedBy: by, notes: '', status: 'completed',
      documents: { prior: [{ name: `${slug}_2025_Plan_Document.pdf`, size: 2400000, demo: true, kind: 'Plan document' }],
        current: [{ name: `${slug}_2026_Plan_Document.pdf`, size: 2700000, demo: true, kind: 'Plan document' }] },
      provisions, unreadable: id === 'PC-1036' ? [{ side: 'current', section: 'Appendix B, Investment policy', pages: '41–43' }] : undefined,
      ...(submitted ? { submittedAt: processDate, submittedBy: by } : {}),
    };
  });
  records.push({
    id: 'PC-1030', planName: 'Riverstone Design 401(k)', planId: 'PL-20295', priorProvider: 'Voya', currentProvider: 'Principal', priorYear: 2025, currentYear: 2026,
    processDate: '2026-10-27T10:20:00', processDay: '2026-10-27', modifiedAt: '2026-10-27T10:20:00', modifiedBy: clone(DEMO_USER), notes: '', status: 'cancelled',
    documents: { prior: [{ name: 'Riverstone_2025_Plan_Document.pdf', size: 2300000, demo: true }], current: [{ name: 'Riverstone_2026_Plan_Scan.pdf', size: 8800000, demo: true }] },
    provisions: [], failure: { doc: 'Riverstone_2026_Plan_Scan.pdf', reason: 'It is a scanned image, so there is no text to read.' },
  });
  return records;
}

export function filterRecords(records: PlanRecord[]) {
  return records.filter(x => ['completed', 'cancelled'].includes(x.status))
    .sort((a, b) => +new Date(b.processDate) - +new Date(a.processDate));
}

export const newRequest = (): Request => ({ prior: [], current: [] });

export function addDocument(request: Request, bucket: Bucket, file: { name: string; size: number; demo?: boolean }): { request: Request; error?: string } {
  const name = String(file.name ?? ''), size = Number(file.size);
  if (!/\.(pdf|docx)$/i.test(name)) return { request, error: `${name}: only PDF and DOCX files are supported.` };
  if (!Number.isFinite(size) || size <= 0) return { request, error: `${name}: this file is empty or could not be read.` };
  if (size > 50 * 1024 * 1024) return { request, error: `${name}: maximum file size is 50 MB.` };
  return { request: { ...clone(request), [bucket]: [{ name, size, demo: !!file.demo, kind: 'Plan document' }] } };
}

const GENERIC = new Set(['prior', 'previous', 'current', 'new', 'old', 'final', 'draft', 'plan', 'plans', 'document', 'doc', 'documents', '401k', '403b',
  'adoption', 'agreement', 'amendment', 'spd', 'summary', 'scan', 'scanned', 'restated', 'restatement', 'copy', 'v1', 'v2', 'pdf', 'docx']);
const words = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
export const docYear = (name: string) => { const m = name.match(/(?:^|[^0-9])(20\d\d)(?:[^0-9]|$)/); return m ? Number(m[1]) : null; };
const docKey = (name: string) => words(name).find(w => !GENERIC.has(w) && !/^\d+$/.test(w)) ?? null;

/** Checks the two documents look comparable: different files, same plan, previous year before current year. */
export function comparability(request: Request): { ok: boolean; problems: { kind: 'same' | 'plan' | 'order'; text: string }[]; years: [number, number] } {
  const a = request.prior[0], b = request.current[0], problems: { kind: 'same' | 'plan' | 'order'; text: string }[] = [];
  const ya = a ? docYear(a.name) : null, yb = b ? docYear(b.name) : null;
  if (a && b) {
    if (a.name === b.name && a.size === b.size) problems.push({ kind: 'same', text: 'Both slots hold the same file. Upload a different document for the current plan.' });
    else {
      const ka = docKey(a.name), kb = docKey(b.name);
      if (ka && kb && ka !== kb) problems.push({ kind: 'plan', text: `These look like documents for different plans ("${ka}" and "${kb}"). Check you picked the right files.` });
      if (ya && yb && ya >= yb) problems.push({ kind: 'order', text: `The previous plan is dated ${ya} and the current plan ${yb}. The previous plan should be the older one.` });
    }
  }
  return { ok: !!(a && b) && !problems.length, problems, years: [ya ?? (yb ? yb - 1 : 2025), yb ?? (ya ? ya + 1 : 2026)] };
}

export const canStart = (request: Request) => !!(request.prior.length && request.current.length);
export const nextId = (records: PlanRecord[]) => 'PC-' + Math.max(1037, ...records.map(x => Number(x.id.replace('PC-', '')) + 1).filter(Number.isFinite));

/** Varied sample plans: each new comparison ID maps to its own plan and provider pair. */
const PLAN_NAMES = ['Lakeside Logistics', 'Pinecrest Dental Group', 'Meridian Software', 'Granite Peak Construction', 'Bluewater Hospitality',
  'Silverline Pharmacy', 'Evergreen Learning Centers', 'Copperfield Engineering', 'Harborview Medical', 'Redwood Analytics'];
const PROVIDERS = ['Ascensus', 'Empower', 'Voya', 'Principal', 'Fidelity', 'Lincoln Financial', 'Nationwide', 'John Hancock'];
export function samplePlan(id: string): [string, string, string, string] {
  const n = parseInt(id.replace(/\D/g, ''), 10) || 0;
  const P = PROVIDERS.length;
  return [PLAN_NAMES[(n * 7) % PLAN_NAMES.length] + ' 401(k)', `PL-${20500 + n * 7}`, PROVIDERS[n % P], PROVIDERS[(n + 3) % P]];
}

/** Outcome of the simulated analysis for a request. */
export function analyse(request: Request, records: PlanRecord[], now = new Date().toISOString()): PlanRecord {
  if (!canStart(request)) throw new Error('Both documents are required.');
  const id = nextId(records), [planName, planId, priorProvider, currentProvider] = samplePlan(id);
  const [priorYear, currentYear] = comparability(request).years;
  const all = [...request.prior, ...request.current];
  const base: PlanRecord = {
    id, planName, planId, priorProvider, currentProvider, priorYear, currentYear, processDate: now, processDay: localDate(now), modifiedAt: now,
    modifiedBy: clone(DEMO_USER), notes: '', status: 'completed', documents: { prior: clone(request.prior), current: clone(request.current) }, provisions: [],
  };
  // Negative scenario: a scanned document has no text, so the analysis fails.
  const scan = all.find(d => /scan/i.test(d.name));
  if (scan) return { ...base, status: 'cancelled', failure: { doc: scan.name, reason: 'It is a scanned image, so there is no text to read.' } };
  // Sample scenario: an identical restatement finds no changes.
  if (all.some(d => /same|nochange/i.test(d.name))) return { ...base, provisions: keepChanges(findings(), 0) };
  return { ...base, provisions: findings(), unreadable: [{ side: 'current', section: 'Appendix B, Investment policy', pages: '41–43' }] };
}

/** Plain-text review report (downloaded after submission). */
export function reportText(r: PlanRecord) {
  const list = changes(r), line = '-'.repeat(60);
  const out = [`Plan comparison review: ${r.planName} (${r.planId})`, `${r.priorYear} plan (${r.priorProvider}) compared with ${r.currentYear} plan (${r.currentProvider})`,
    r.submittedAt ? `Submitted ${timeLabel(r.submittedAt)} by ${r.submittedBy?.name}` : 'Not submitted', 'Sample data for a prototype. Documents were not analysed.', line];
  list.forEach(p => {
    out.push(`${p.name} [${p.change}, ${p.effect}]${isEdited(p) ? ' [corrected by reviewer]' : ''}`,
      `  Previous: ${p.prior || 'Not in previous plan'}`, `  Current: ${p.current || 'Not found in current plan'}`,
      `  What changed: ${p.summary}${p.sop ? ` (compared under ${p.sop})` : ''}`, `  Why it matters: ${p.why}`, `  Participants: ${p.participants}`,
      `  Review: ${p.review ? `${p.review.state} by ${p.review.by.name}${p.review.reason ? ` (${p.review.reason})` : ''}` : 'not reviewed'}`);
    if (p.note) out.push(`  Reviewer note: ${p.note}`);
    out.push('');
  });
  out.push(line, `Comments: ${r.notes || 'None'}`);
  return out.join('\n');
}

export function zipStore(entries: Record<string, string>) {
  const encoder = new TextEncoder(), locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  const crc32 = (data: Uint8Array) => { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
  for (const [path, content] of Object.entries(entries)) {
    const name = encoder.encode(path), data = encoder.encode(content);
    const crc = crc32(data), local = new Uint8Array(30 + name.length + data.length), v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true); v.setUint16(12, 0x21, true);
    v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true); v.setUint16(26, name.length, true);
    local.set(name, 30); local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const centralLength = centrals.reduce((s, a) => s + a.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, locals.length, true); e.setUint16(10, locals.length, true); e.setUint32(12, centralLength, true); e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralLength + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, at); at += part.length; }
  return out;
}

/** Word report of the submitted review. */
export function reportDocx(record: PlanRecord): Record<string, string> {
  const p = (text: string, style = 'Normal') => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
  const body = reportText(record).split('\n').map((l, i) => p(l, i === 0 ? 'Title' : 'Normal')).join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1440" w:bottom="1080" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`;
  return {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': doc,
    'word/styles.xml': styles,
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  };
}
