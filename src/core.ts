// Domain logic ported from the original prototype (no DOM access here).

export type Status = 'match' | 'difference' | 'missing';
export type User = { name: string; email: string; initials: string };
export type Doc = { name: string; size: number; demo?: boolean; kind?: string };
export type Provision = {
  id: string; name: string; category: string; prior: string; current: string; comment: string;
  attention: boolean; sopRule: string; impact: string; edited: boolean; status: Status;
  // Human review sign-off: every change is checked against its sources before submit.
  reviewedAt?: string; reviewedBy?: User;
  // For Missing rows: what the reviewer did about it (missing text isn't treated as removal).
  resolution?: string;
};

export const RESOLUTIONS = ['Requested from the current provider', 'Found in another document', 'Confirmed not offered in the current plan'];
export const needsReview = (p: Provision) => !p.reviewedAt || (p.status === 'missing' && !p.resolution);

/** Mark one provision reviewed (or not), with the resolution chosen for a Missing row. */
export function setReview(record: PlanRecord, id: string, reviewed: boolean, resolution: string, now = new Date().toISOString()): PlanRecord {
  const next = clone(record);
  next.provisions = next.provisions.map(p => p.id !== id ? p : reviewed
    ? { ...p, reviewedAt: p.reviewedAt ?? now, reviewedBy: p.reviewedBy ?? clone(DEMO_USER), resolution: resolution || undefined }
    : { ...p, reviewedAt: undefined, reviewedBy: undefined, resolution: resolution || undefined });
  next.modifiedAt = now; next.modifiedBy = clone(DEMO_USER);
  return next;
}
export type PlanRecord = {
  id: string; planName: string; planId: string; priorProvider: string; currentProvider: string;
  processDate: string; processDay: string; modifiedAt: string; modifiedBy: User; notes: string;
  status: 'completed' | 'cancelled'; template: Doc | null; documents: { prior: Doc[]; current: Doc[] };
  provisions: Provision[]; contentRevision: number;
  startedAt?: string; cancelledAt?: string; cancelledBy?: User; cancelledStage?: number;
  cancelledProgress?: number; metadataExtracted?: boolean;
  submittedAt?: string; submittedBy?: User;
};
export type Request = { prior: Doc[]; current: Doc[]; template: Doc[] };
export type Bucket = keyof Request;
export type Processing = {
  requestId: string; startedAt: string; elapsed: number; duration: number;
  paused: boolean; cancelled: boolean; stageIndex?: number;
};
export type Filters = { plan: string; review: string; date: string; status: string };

export const DEMO_USER: User = { name: 'Alex Morgan', email: 'alex.morgan@example.com', initials: 'AM' };
export const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const xml = (value: unknown) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
export const localDate = (value: string) => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const dateLabel = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(new Date(value));
export const timeLabel = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
export const fileSize = (size: number) => size >= 1048576 ? (size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(size / 1024)) + ' KB';

const PROVISIONS: [string, string, string, string, string, string, boolean, string, string][] = [
  ['eligibility-age', 'Eligibility age', 'Eligibility', 'Age 21', 'Age 21', 'The eligibility age remains 21. There is no age-related change to who can enter the plan.', false, 'SOP 1 and 7', ''],
  ['eligibility-service', 'Service requirement', 'Eligibility', '2 months of service', '4 months of service', 'The service requirement increases by 2 months. Under SOP 8.I, the 4-month requirement applies to employees hired after takeover; existing eligible participants retain their prior eligibility.', true, 'SOP 8.I', 'Non-affecting'],
  ['entry-date', 'Entry dates', 'Eligibility', 'First day of each quarter', 'First day of each month', 'Entry opportunities increase from 4 to 12 per year. Employees who satisfy eligibility can enter the plan monthly, reducing the wait for the next entry date.', false, 'SOP 1 and 7', ''],
  ['elective-deferrals', 'Pre-tax deferrals', 'Contributions', 'Permitted', 'Permitted', 'Pre-tax employee deferrals remain permitted. The availability of this contribution type is unchanged.', false, 'SOP 7', ''],
  ['roth', 'Roth contributions', 'Contributions', 'Permitted', 'Permitted', 'Roth employee contributions remain permitted. Participants retain the same choice between pre-tax and Roth deferrals.', false, 'SOP 7', ''],
  ['employer-match', 'Employer match', 'Contributions', '100% of the first 4% of compensation', '50% of the first 6% of compensation', 'The maximum employer match decreases from 4% to 3% of compensation. At a 6% deferral rate and $50,000 in compensation, the match decreases from $2,000 to $1,500 per year, a $500 reduction.', false, 'SOP 7 · Formula example', ''],
  ['vesting', 'Vesting schedule', 'Vesting', '3-year cliff: 100% at year 3', '6-year graded: 20% at year 2; 40% at 3; 60% at 4; 80% at 5; 100% at 6', 'Full vesting moves from year 3 to year 6. Employees nearing 3 years are 40% vested at year 3, instead of 100%, on post-change contributions governed by the new schedule. In this worked example, pre-change balances retain the more favorable schedule as service accrues, and already vested amounts remain vested.', true, 'SOP 8 · Vesting example', 'Long-term'],
  ['match-allocation', 'Match allocation requirement', 'Contributions', 'No minimum service hours for allocation', '1,000 service hours per plan year', 'A 1,000-hour condition is added for receiving the employer match. Under SOP 8.II, existing participants retain the prior allocation conditions in the takeover plan year. From the following plan year, the condition applies to all employees; those below 1,000 hours do not receive a match allocation.', true, 'SOP 8.II', 'Short-term'],
  ['predecessor-service', 'Predecessor service credit', 'Service crediting', 'Previously recognized employer service is credited', 'Predecessor service is not recognized', 'The current election stops recognizing predecessor service. Under SOP 8.III, service already recognized for existing participants remains credited after takeover; it is not reset to zero. This preserves the eligibility and vesting service those participants have already accumulated.', true, 'SOP 8.III', 'Long-term'],
  ['loans', 'Participant loans', 'Loans and withdrawals', 'Available under the loan policy', 'Not found', 'The prior plan permits participant loans, but the current document set contains no loan provision. Loan availability and operating terms are missing from the current takeover specification; the missing text does not establish that loans are prohibited.', false, 'SOP 7 · Missing provision', ''],
  ['hardship', 'Hardship withdrawals', 'Loans and withdrawals', 'Permitted under plan terms', 'Permitted under plan terms', 'Hardship withdrawals remain permitted under the stated plan terms. The availability of this withdrawal feature is unchanged.', false, 'SOP 7', ''],
  ['in-service', 'In-service withdrawals', 'Loans and withdrawals', 'Available from age 59½', 'Not found', 'The prior plan permits in-service withdrawals from age 59½; the current documents do not state an equivalent provision. Access for participants aged 59½ and above is undocumented in the current specification. Missing text is not treated as removal of an existing right.', false, 'SOP 7 · Missing provision', ''],
  ['retirement-age', 'Normal retirement age', 'Retirement', 'Age 65', 'Age 65', 'Normal retirement age remains 65. The retirement-age threshold is unchanged.', false, 'SOP 7', ''],
  ['profit-sharing', 'Profit sharing', 'Contributions', 'Discretionary employer contribution', 'Discretionary employer contribution', 'Profit sharing remains a discretionary employer contribution. The stated contribution type is unchanged and does not establish a fixed annual contribution amount.', false, 'SOP 7', ''],
];

export function provisions(): Provision[] {
  return PROVISIONS.map(([id, name, category, prior, current, comment, attention, sopRule, impact]) =>
    ({ id, name, category, prior, current, comment, attention, sopRule, impact, edited: false, status: classify(prior, current) }));
}

export function classify(prior: string, current: string): Status {
  const norm = (s: string) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const a = norm(prior), b = norm(current);
  if (!a || !b || a === 'not found' || b === 'not found') return 'missing';
  return a === b ? 'match' : 'difference';
}

export function seedRecords(): PlanRecord[] {
  const data = [
    ['PC-1036', 'Harbor Manufacturing 401(k)', 'PL-20481', 'Ascensus', 'Lincoln Financial', '2026-10-08T10:25:00', 'Alex Morgan', 'alex.morgan@example.com', 'Takeover example separates pre-change balances from post-change employer contributions.'],
    ['PC-1035', 'Cedar Valley Services 401(k)', 'PL-20465', 'Voya', 'Empower', '2026-10-07T14:10:00', 'Sarah Chen', 'sarah.chen@example.com', ''],
    ['PC-1034', 'Northstar Technologies 401(k)', 'PL-20422', 'Fidelity Workplace Investing Retirement Services', 'Voya Financial Retirement Plan Services', '2026-10-06T11:45:00', 'Michael Lee', 'michael.lee@example.com', 'Review includes an example amendment in the prior-provider document set.'],
    ['PC-1033', 'Oakridge Consulting 401(k)', 'PL-20390', 'Empower', 'Principal', '2026-10-05T09:32:00', 'Alex Morgan', 'alex.morgan@example.com', ''],
    ['PC-1032', 'Summit Healthcare 401(k)', 'PL-20371', 'Principal', 'Fidelity', '2026-10-02T16:05:00', 'Sarah Chen', 'sarah.chen@example.com', 'Template selection demonstrated using a sample TOR format.'],
    ['PC-1031', 'Brookfield Industries 401(k)', 'PL-20314', 'Ascensus', 'Empower', '2026-10-01T13:50:00', 'Michael Lee', 'michael.lee@example.com', ''],
    ['PC-1030', 'Riverstone Design 401(k)', 'PL-20295', 'Voya', 'Principal', '2026-09-30T10:20:00', 'Alex Morgan', 'alex.morgan@example.com', ''],
  ];
  const records: PlanRecord[] = data.map(([id, planName, planId, priorProvider, currentProvider, processDate, name, email, notes], i) => ({
    id, planName, planId, priorProvider, currentProvider, processDate, processDay: localDate(processDate), modifiedAt: processDate,
    modifiedBy: { name, email, initials: name.split(' ').map(p => p[0]).join('') }, notes, status: 'completed',
    template: i === 4 ? { name: 'Sample_TOR_Format.docx', size: 24576, demo: true } : null,
    documents: { prior: [{ name: 'Prior_Adoption_Agreement.pdf', size: 2400000, demo: true }], current: [{ name: 'Current_Adoption_Agreement.pdf', size: 2100000, demo: true }] },
    provisions: provisions(), contentRevision: 2,
  }));
  records.unshift(cancelRequest(demoRequest(), records, { requestId: 'PC-1029', startedAt: '2026-10-08T15:10:00', elapsed: 2500, duration: 12000, stageIndex: 1, paused: false, cancelled: false }, '2026-10-08T15:10:03'));
  return records;
}

export function filterRecords(records: PlanRecord[], filters: Filters) {
  const p = filters.plan.trim().toLowerCase(), r = filters.review.trim().toLowerCase();
  return records.filter(x => ['completed', 'cancelled'].includes(x.status)
    && (!p || `${x.planName} ${x.planId} ${x.id}`.toLowerCase().includes(p))
    && (!r || x.id.toLowerCase().includes(r))
    && (!filters.date || x.processDay === filters.date))
    .sort((a, b) => +new Date(b.processDate) - +new Date(a.processDate));
}

export function filterProvisions(rows: Provision[], filter: string, search: string) {
  const q = search.trim().toLowerCase();
  return rows.filter(p => (filter === 'all' || filter === 'attention' && p.attention || p.status === filter)
    && (!q || `${p.name} ${p.category} ${p.prior} ${p.current} ${p.comment}`.toLowerCase().includes(q)));
}

export const newRequest = (): Request => ({ prior: [], current: [], template: [] });

function fileKind(name: string) {
  if (/adoption/i.test(name)) return 'Adoption agreement';
  if (/amendment/i.test(name)) return 'Amendment';
  if (/spd|summary/i.test(name)) return 'Summary plan description';
  if (/plan/i.test(name)) return 'Plan document';
  return 'Supporting document';
}

export function addDocuments(request: Request, bucket: Bucket, files: { name: string; size: number; demo?: boolean }[]) {
  const next = clone(request), errors: string[] = [];
  if (bucket === 'template' && files.length > 1) return { request: next, errors: ['Upload only one TOR template. Select a single file.'] };
  for (const f of files) {
    const name = String(f.name ?? ''), size = Number(f.size);
    if (!/\.(pdf|doc|docx)$/i.test(name)) { errors.push(`${name}: only PDF, DOC and DOCX files are supported.`); continue; }
    if (!Number.isFinite(size) || size <= 0) { errors.push(`${name}: this file is empty or could not be read.`); continue; }
    if (size > 50 * 1024 * 1024) { errors.push(`${name}: maximum file size is 50 MB.`); continue; }
    if (bucket === 'template' && next.template.length) { errors.push('Remove the current TOR template before adding a different one.'); continue; }
    if (next[bucket].some(x => x.name === name && x.size === size)) { errors.push(`${name}: this document has already been added.`); continue; }
    next[bucket].push({ name, size, demo: !!f.demo, kind: bucket === 'template' ? 'TOR template' : fileKind(name) });
  }
  return { request: next, errors };
}

export function demoRequest(): Request {
  return {
    prior: [
      { name: 'Harbor_Prior_Adoption_Agreement.pdf', size: 2486272, demo: true, kind: 'Adoption agreement' },
      { name: 'Harbor_Prior_Plan_Document.pdf', size: 3124224, demo: true, kind: 'Plan document' },
      { name: 'Harbor_Prior_Amendment.docx', size: 246784, demo: true, kind: 'Amendment' },
    ],
    current: [
      { name: 'Harbor_Current_Adoption_Agreement.pdf', size: 2236416, demo: true, kind: 'Adoption agreement' },
      { name: 'Harbor_Current_SPD.pdf', size: 1841152, demo: true, kind: 'Summary plan description' },
    ],
    template: [],
  };
}

export const canStart = (request: Request) => !!(request.prior.length && request.current.length);
export const nextId = (records: PlanRecord[]) => 'PC-' + Math.max(1037, ...records.map(x => Number(x.id.replace('PC-', '')) + 1).filter(Number.isFinite));

/** Varied sample plans: each review ID maps to its own plan, provider pair and date. */
const PLAN_NAMES = ['Lakeside Logistics', 'Pinecrest Dental Group', 'Meridian Software', 'Granite Peak Construction', 'Bluewater Hospitality',
  'Silverline Pharmacy', 'Evergreen Learning Centers', 'Copperfield Engineering', 'Harborview Medical', 'Redwood Analytics',
  'Stonebridge Foods', 'Clearwater Utilities', 'Maplewood Senior Living', 'Ironclad Security', 'Sunrise Credit Union',
  'Northgate Retail', 'Bayside Marine', 'Frontier Aerospace', 'Willow Creek Farms', 'Crescent Legal Partners',
  'Highland Transport', 'Oakmont Architects', 'Prairie Wind Energy', 'Seaside Resorts', 'Cobalt Robotics'];
const PROVIDERS = ['Ascensus', 'Empower', 'Voya', 'Principal', 'Fidelity', 'Lincoln Financial', 'Nationwide', 'John Hancock', 'Prudential', 'T. Rowe Price'];
export function samplePlan(id: string): [string, string, string, string, string] {
  const n = parseInt(id.replace(/\D/g, ''), 10) || 0;
  const name = PLAN_NAMES[(n * 7) % PLAN_NAMES.length] + (n % 5 === 0 ? ' 403(b)' : ' 401(k)');
  // Walk through every ordered provider pair (90) before any pair repeats.
  const P = PROVIDERS.length, prior = PROVIDERS[n % P], current = PROVIDERS[(n % P + 1 + Math.floor(n / P) % (P - 1)) % P];
  const d = new Date('2026-11-02T09:00:00'); d.setDate(d.getDate() - Math.max(0, 1056 - n)); d.setHours(9 + (n % 8), (n * 13) % 60);
  return [name, `PL-${20500 + n * 7}`, prior, current, d.toISOString()];
}

export function completeRequest(request: Request, records: PlanRecord[], now = new Date().toISOString(), requestId: string | null = null): PlanRecord {
  if (!canStart(request)) throw new Error('Both provider document sets are required.');
  const id = requestId || nextId(records);
  if (records.some(r => r.id === id)) throw new Error('Request already recorded.');
  return {
    id, ...(([planName, planId, priorProvider, currentProvider]) => ({ planName, planId, priorProvider, currentProvider }))(samplePlan(id)),
    processDate: now, processDay: localDate(now), modifiedAt: now, modifiedBy: clone(DEMO_USER), notes: '', status: 'completed',
    template: request.template[0] ? clone(request.template[0]) : null, documents: { prior: clone(request.prior), current: clone(request.current) },
    provisions: provisions(), contentRevision: 2,
  };
}

export function cancelRequest(request: Request, records: PlanRecord[], processing: Processing, now = new Date().toISOString()): PlanRecord {
  const id = processing.requestId || nextId(records);
  if (records.some(r => r.id === id)) throw new Error('Request already recorded.');
  const extracted = processing.elapsed >= processing.duration / 2;
  return {
    id, planName: extracted ? 'Harbor Manufacturing 401(k)' : 'Not extracted', planId: extracted ? 'PL-20481' : '—',
    priorProvider: extracted ? 'Ascensus' : 'Not extracted', currentProvider: extracted ? 'Lincoln Financial' : 'Not extracted',
    status: 'cancelled', processDate: now, processDay: localDate(now), startedAt: processing.startedAt || now, cancelledAt: now,
    cancelledBy: clone(DEMO_USER), modifiedAt: now, modifiedBy: clone(DEMO_USER),
    cancelledStage: processing.stageIndex ?? Math.min(5, Math.floor(processing.elapsed / processing.duration * 6)),
    cancelledProgress: Math.min(99, Math.floor(processing.elapsed / processing.duration * 100)), metadataExtracted: extracted,
    notes: '', template: request.template[0] ? clone(request.template[0]) : null,
    documents: { prior: clone(request.prior), current: clone(request.current) }, provisions: [], contentRevision: 2,
  };
}

export function upgradeRecords(records: PlanRecord[]) {
  const defaults = provisions();
  return records.map(record => {
    if (record.contentRevision >= 2 || record.status === 'cancelled') return record;
    const result = clone(record);
    result.provisions = result.provisions.map(row => { const latest = defaults.find(p => p.id === row.id); return latest ? row.edited ? { ...row, sopRule: latest.sopRule, impact: latest.impact } : clone(latest) : row; });
    defaults.forEach(row => { if (!result.provisions.some(p => p.id === row.id)) result.provisions.push(clone(row)); });
    result.provisions = result.provisions.map(row => row.status === 'match' ? { ...row, attention: false, impact: '' } : row);
    result.contentRevision = 2;
    return result;
  });
}

export function commitEdits(record: PlanRecord, edited: Provision[], now = new Date().toISOString()): PlanRecord {
  const next = clone(record);
  next.provisions = next.provisions.map(p => {
    const e = edited.find(x => x.id === p.id);
    if (!e) return p;
    const changed = (['prior', 'current', 'comment'] as const).some(k => p[k] !== e[k]);
    const status = classify(e.prior, e.current);
    return { ...p, prior: e.prior.slice(0, 1000), current: e.current.slice(0, 1000), comment: e.comment.slice(0, 2000), status,
      attention: status === 'match' ? false : p.attention, impact: status === 'match' ? '' : p.impact, edited: p.edited || changed };
  });
  next.modifiedAt = now; next.modifiedBy = clone(DEMO_USER);
  return next;
}

export const withNotes = (record: PlanRecord, notes: string, now = new Date().toISOString()): PlanRecord =>
  ({ ...clone(record), notes: notes.slice(0, 2000), modifiedAt: now, modifiedBy: clone(DEMO_USER) });

export const dirty = (record: PlanRecord | undefined, edited: Provision[] | null) =>
  !!record && record.provisions.some(p => { const e = edited?.find(x => x.id === p.id); return e && (['prior', 'current', 'comment'] as const).some(k => p[k] !== e[k]); });

/** Re-derive status/impact for a row being edited live. */
export function reclassifyEdit(row: Provision): Provision {
  const status = classify(row.prior, row.current);
  const basis = provisions().find(p => p.id === row.id);
  return { ...row, status, attention: status !== 'match' && !!basis?.attention, impact: status === 'match' ? '' : basis?.impact || '' };
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

export function torPackage(record: PlanRecord): Record<string, string> {
  if (record.status !== 'completed') throw new Error('TOR is unavailable for a cancelled request.');
  const p = (text: string, style = 'Normal') => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
  const cell = (text: string, width: number, header = false) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? '<w:shd w:fill="E7ECF4"/>' : ''}<w:vAlign w:val="center"/></w:tcPr>${p(text, header ? 'TableHeader' : 'TableText')}</w:tc>`;
  const widths = [1600, 2100, 2100, 3560];
  const tableHead = '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + ['Provision', 'Prior provider value', 'Current provider value', 'Comments and impact'].map((t, i) => cell(t, widths[i], true)).join('') + '</w:tr>';
  const tableRows = record.provisions.map(row => '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + [row.name, row.prior || 'Not found', row.current || 'Not found', `${row.impact ? row.impact + ' benefit impact. ' : ''}${row.comment}${row.edited ? ' [User edited]' : ''}${row.resolution ? ' Resolution: ' + row.resolution + '.' : ''}${row.reviewedBy ? ' Reviewed by ' + row.reviewedBy.name + ', ' + dateLabel(row.reviewedAt!) + '.' : ''}`].map((t, i) => cell(t, widths[i])).join('') + '</w:tr>').join('');
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="single" w:sz="4" w:color="D9D9D9"/>`).join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p('CORE Takeover Review', 'Title')}${p('DEMONSTRATION — SAMPLE DATA', 'Heading1')}${p('This prototype uses illustrative plan values with comments based on the Takeover Review SOP. Uploaded documents have not been analysed.')}${p('Comparison details', 'Heading1')}${p('Review ID: ' + record.id)}${p('Plan: ' + record.planName + ' | ' + record.planId)}${p('Prior provider: ' + record.priorProvider + ' | Current provider: ' + record.currentProvider)}${p('Process date: ' + dateLabel(record.processDate))}${p('Last modified: ' + record.modifiedBy.name + ' | ' + record.modifiedBy.email + ' | ' + timeLabel(record.modifiedAt))}${p('Selected TOR format: ' + (record.template ? record.template.name + ' — custom layout mapping is simulated.' : 'Default demonstration format. This is not an approved CORE TOR template.'))}${p('SOP reference: Plan comparison SOP - TA Doc Takeover reviews.docx, rules 1–8. Vesting percentages also use the existing takeover review reference; the protection scenario is a worked example.')}${p('Plan provision comparison', 'Heading1')}<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${tableHead}${tableRows}</w:tbl>${p('Analyst notes', 'Heading1')}${p(record.notes || 'No notes added.')}${p('Uploaded document references', 'Heading1')}${p('Prior provider: ' + record.documents.prior.map(f => f.name).join('; '))}${p('Current provider: ' + record.documents.current.map(f => f.name).join('; '))}${p('Prototype notes', 'Heading1')}${p('The TOR contains the latest saved comments and any user overrides. The vesting example separates protected pre-change balances from post-change contributions. Custom template layout mapping and uploaded-document analysis remain simulated.')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1440" w:bottom="1080" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="20"/><w:color w:val="25364B"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="260" w:lineRule="auto"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="140"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40" w:line="235" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="17"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:basedOn w:val="TableText"/><w:rPr><w:b/><w:color w:val="000000"/></w:rPr></w:style></w:styles>`;
  return {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': doc,
    'word/styles.xml': styles,
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  };
}

export const STAGES: [string, string, string][] = [
  ['Reading & validating documents', 'Checking file formats and required document sets.', 'file'],
  ['Classifying documents', 'Ordering current AAA and prior documents using the SOP.', 'folder'],
  ['Extracting plan provisions', 'Preparing provision values and provider information.', 'sparkles'],
  ['Applying comparison rules', 'Identifying matches, differences and missing provisions under SOP 7.', 'compare'],
  ['Evaluating benefit impacts', 'Applying non-affecting, short-term and long-term SOP categories.', 'shield'],
  ['Preparing your review', 'Organizing comparison results and the TOR format.', 'check'],
];
