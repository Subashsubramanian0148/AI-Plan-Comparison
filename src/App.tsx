import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as Core from './core';
import type { Bucket, Filters, PlanRecord, Request } from './core';
import { Icon } from './ui/Icon';
import coreLogo from './assets/core-logo.svg';
import { TooltipLayer } from './ui/Tooltip';
import noRecordsImg from './assets/no-records.png';
import galileoLogo from './assets/galileo-logo.svg';
import {
  Avatar, Badge, Button, Card, IconButton, InputText, Modal, Select, UploadStep, Drawer,
  TextArea, ToastStack, type ModalButton, type ToastItem,
} from './ui/components';

type Page = 'dashboard' | 'review' | 'create';
type ModalConfig = { kind: 'generic'; title: string; body: ReactNode; buttons?: ModalButton[]; wide?: boolean };

const STORAGE_KEY = 'core.ai-plan-comparison.prototype.v1';
const BATCH_SIZE = 15;
const EMPTY_FILTERS: Filters = { plan: '', review: '', date: '', status: '' };
// Provisions whose change alters what participants receive (match, vesting, access to money).
const BENEFIT_IMPACT = /match|vesting|loan|withdrawal|hardship|contribution|distribution/i;
const isBenefitImpact = (name: string) => BENEFIT_IMPACT.test(name);
const recordStatus = (r: PlanRecord) => r.status === 'cancelled' ? 'failed' : r.submittedAt ? 'submitted' : 'review';
const ACCEPT = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

let storageAvailable = true;
function loadRecords(): PlanRecord[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if ([1, 2].includes(parsed.version) && Array.isArray(parsed.records) && parsed.records.every((r: PlanRecord) =>
        r.id && r.planName && r.planId && r.processDate && r.processDay && r.modifiedBy && r.documents && Array.isArray(r.provisions))) {
        // Sample data: PC-1034 carries long provider names to show the truncated-field case.
        const renamed = parsed.records.map((r: PlanRecord) => ({ ...r,
          priorProvider: r.priorProvider === 'Transamerica' ? 'Lincoln Financial' : r.priorProvider,
          currentProvider: r.currentProvider === 'Transamerica' ? 'Lincoln Financial' : r.currentProvider }));
        return Core.upgradeRecords(renamed).map((r: PlanRecord) => r.id === 'PC-1034' && r.priorProvider === 'Fidelity'
          ? { ...r, priorProvider: 'Fidelity Workplace Investing Retirement Services', currentProvider: 'Voya Financial Retirement Plan Services' } : r)
          // Records created by earlier runs reused one sample plan; derive each from its own ID instead.
          .map((r: PlanRecord) => {
            if ((parseInt(r.id.replace(/\D/g, ''), 10) || 0) <= 1036 || r.status !== 'completed') return r;
            const [planName, planId, priorProvider, currentProvider, processDate] = Core.samplePlan(r.id);
            return { ...r, planName, planId, priorProvider, currentProvider, processDate, processDay: processDate.slice(0, 10) };
          }).map(varyChanges);
      }
    }
  } catch { storageAvailable = false; }
  return Core.seedRecords().map(varyChanges);
}

// Sample data shares one provision set; each record keeps a different number of changes so the list isn't repetitive.
function varyChanges(r: PlanRecord): PlanRecord {
  const keep = 3 + (parseInt(r.id.replace(/\D/g, ''), 10) || 0) % 6;
  let n = 0;
  return { ...r, provisions: r.provisions.map(p => p.status === 'match' || p.edited || ++n <= keep ? p : { ...p, status: 'match' as const }) };
}


export default function App() {
  const [records, setRecords] = useState<PlanRecord[]>(loadRecords);
  const [page, setPage] = useState<Page>('dashboard');
  const [sort, setSort] = useState<{ key: 'plan' | 'prior' | 'current' | 'changes' | 'status'; dir: 1 | -1 } | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [request, setRequest] = useState<Request>(Core.newRequest);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [errorBucket, setErrorBucket] = useState<Bucket | null>(null);
  const [, setTemplateOpen] = useState(false);
  // Row being edited in the slide-out: prior value, current value and AI comment (`value`).
  const [commentEdit, setCommentEdit] = useState<{ id: string; prior: string; current: string; value: string } | null>(null);
  const [provisionFilter, setProvisionFilter] = useState('all');
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const toastId = useRef(0);

  const record = records.find(r => r.id === activeId);
  const editRow = commentEdit && record?.provisions.find(p => p.id === commentEdit.id);
  const commentDirty = !!commentEdit && !!editRow && (commentEdit.value !== editRow.comment || commentEdit.prior !== editRow.prior || commentEdit.current !== editRow.current);

  /* ---------- infrastructure ---------- */
  const toast = useCallback((message: string, type: ToastItem['type'] = 'success') => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6500);
  }, []);

  // Persist on every change to records.
  const firstPersist = useRef(true);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, records })); storageAvailable = true; }
    catch { storageAvailable = false; if (!firstPersist.current) toast('Saved for this session only. Browser storage is unavailable.', 'error'); }
    if (firstPersist.current && !storageAvailable) toast('Browser storage is unavailable. Changes will last for this session only.', 'error');
    firstPersist.current = false;
  }, [records, toast]);

  useEffect(() => {
    document.title = (page === 'review' && record ? (record.status === 'cancelled' ? failedName(record) : record.planName) + ' · ' : '') + 'AI Plan Comparison · CORE';
  }, [page, activeId]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (commentDirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [commentDirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !modal) setNavOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal]);

  const closeModal = () => setModal(null);
  const openModal = (config: Omit<Extract<ModalConfig, { kind: 'generic' }>, 'kind'>) => setModal({ kind: 'generic', ...config });

  const focusTop = () => requestAnimationFrame(() => { window.scrollTo({ top: 0 }); mainRef.current?.focus({ preventScroll: true }); });

  /* ---------- navigation ---------- */
  const openPage = (next: Page) => {
    setPage(next); setCommentEdit(null); setNavOpen(false);
    focusTop();
  };

  // A comment being edited must be saved or discarded before leaving the review.
  const safeRoute = (next: () => void) => {
    if (commentDirty) {
      openModal({
        title: 'Discard your comment changes?',
        body: <p>You are editing a comment that hasn't been saved. Leaving now will discard it.</p>,
        buttons: [{ label: 'Keep editing', run: closeModal }, { label: 'Discard', variant: 'primary', run: () => { closeModal(); setCommentEdit(null); next(); } }],
      });
      return;
    }
    next();
  };
  const navigate = (next: Page) => { if (page !== next) safeRoute(() => openPage(next)); };

  const openCreate = () => safeRoute(() => { setRequest(Core.newRequest()); setUploadErrors([]); setErrorBucket(null); setTemplateOpen(false); setActiveId(null); setCommentEdit(null); setProvisionFilter('all'); setPage('create'); focusTop(); });

  const openReview = (id: string) => safeRoute(() => {
    setActiveId(id); setPage('review'); setCommentEdit(null); setProvisionFilter('all'); setNavOpen(false); focusTop();
  });


  /* ---------- row edits: prior plan, current plan and AI comment ---------- */
  const saveComment = () => {
    if (!record || !commentEdit) return;
    const value = commentEdit.value.trim(), prior = commentEdit.prior.trim(), current = commentEdit.current.trim();
    if (!value) { toast('A comment cannot be empty.', 'error'); return; }
    const row = record.provisions.find(p => p.id === commentEdit.id);
    if (row && (value !== row.comment || prior !== row.prior || current !== row.current)) {
      // An empty plan value means the provision isn't in that document.
      const saved = Core.commitEdits(record, [{ ...row, comment: value, prior: prior || 'Not found', current: current || 'Not found' }]);
      setRecords(rs => rs.map(r => r.id === saved.id ? saved : r));
      toast('Changes saved.');
    }
    setCommentEdit(null);
  };

  // Selecting another change (list, Previous or Next) asks first if the comment has unsaved edits.
  const goToComment = (id: string) => {
    const row = record?.provisions.find(p => p.id === id);
    if (!row) return;
    const go = () => setCommentEdit({ id: row.id, prior: row.prior, current: row.current, value: row.comment });
    if (!commentDirty) { go(); return; }
    openModal({
      title: 'Discard your changes?',
      body: <p>Your edits to this comment haven't been saved. Discard them, or keep editing.</p>,
      buttons: [{ label: 'Keep editing', run: closeModal }, { label: 'Discard', variant: 'primary', run: () => { closeModal(); go(); } }],
    });
  };

  /* ---------- submission ---------- */
  // Leaving without saving a draft or submitting discards this session's work, so confirm first.
  const confirmCancel = (what: string) => openModal({
    title: 'Are you sure you want to cancel?',
    body: <p>You will lose all {what}. This can't be undone.</p>,
    buttons: [{ label: 'Yes, cancel', variant: 'primary', run: () => { closeModal(); setCommentEdit(null); navigate('dashboard'); } }, { label: 'Keep working', run: closeModal }],
  });
  // Comment edits already persist; a draft just confirms that and returns to the list, still Draft.
  const saveDraft = () => {
    if (!record) return;
    if (commentDirty) { toast('Save or cancel the comment you are editing first.', 'error'); return; }
    const name = record.planName;
    setCommentEdit(null); setPage('dashboard'); focusTop();
    toast(`${name} saved as draft. You can finish the review later.`);
  };
  const submitReview = () => {
    if (!record) return;
    if (commentDirty) { toast('Save or cancel the comment you are editing before submitting.', 'error'); return; }
    const id = record.id, name = record.planName;
    // No confirmation overlay: submit, return to the list, and confirm with a floating alert under its CTA.
    const now = new Date().toISOString();
    setRecords(rs => rs.map(r => r.id === id ? { ...r, submittedAt: now, submittedBy: Core.DEMO_USER, modifiedAt: now, modifiedBy: Core.DEMO_USER } : r));
    setCommentEdit(null); setPage('dashboard'); focusTop();
    toast(`${name} submitted. The TOR is ready to download.`);
  };

  /* ---------- create ---------- */
  const startComparison = () => {
    if (!Core.canStart(request)) { setUploadErrors(['Add at least one document for both the prior and current provider.']); return; }
    let next = Core.completeRequest(request, records, new Date().toISOString(), Core.nextId(records));
    // Negative scenario: a scanned document can't be read, so the analysis ends in an error.
    if ([...request.prior, ...request.current].some(d => /scan/i.test(d.name))) next = { ...next, status: 'cancelled', provisions: [] };
    setRecords(rs => [next, ...rs]);
    setRequest(Core.newRequest()); setFilters(EMPTY_FILTERS); setDraftFilters(EMPTY_FILTERS); setVisibleCount(BATCH_SIZE);
    setActiveId(next.id); setCommentEdit(null); setProvisionFilter('all'); setPage('review'); focusTop();
  };

  const addFiles = (bucket: Bucket, files: File[], replace = false) => {
    const result = Core.addDocuments(replace ? { ...request, [bucket]: [] } : request, bucket, files);
    files.forEach(f => uploadedFiles.current.set(`${bucket}/${f.name}`, f));
    setRequest(result.request); setUploadErrors(result.errors); setErrorBucket(bucket);
  };
  // Keep the picked File objects so an uploaded document can be downloaded again before comparing.
  const uploadedFiles = useRef(new Map<string, File>());
  const downloadUpload = (bucket: Bucket, index: number) => {
    const doc = request[bucket][index], file = doc && uploadedFiles.current.get(`${bucket}/${doc.name}`);
    if (!file) return;
    const url = URL.createObjectURL(file), a = document.createElement('a');
    a.href = url; a.download = file.name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const replaceFile = (bucket: Bucket, index: number, file: File) => {
    const without = { ...request, [bucket]: request[bucket].filter((_, i) => i !== index) };
    const result = Core.addDocuments(without, bucket, [file]);
    if (!result.errors.length) uploadedFiles.current.set(`${bucket}/${file.name}`, file);
    setRequest(result.request); setUploadErrors(result.errors); setErrorBucket(bucket);
  };
  const removeFile = (bucket: Bucket, index: number) => {
    setRequest(r => ({ ...r, [bucket]: r[bucket].filter((_, i) => i !== index) })); setUploadErrors([]);
  };

  /* ---------- downloads & reference ---------- */
  const downloadTor = (id: string) => {
    const r = records.find(x => x.id === id);
    if (!r?.submittedAt) return;
    const blob = new Blob([Core.zipStore(Core.torPackage(r))], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `CORE_TOR_${r.id}_DEMO.docx`; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('TOR download started.');
  };

  const confirmRemove = (id: string) => { const target = records.find(r => r.id === id); const name = target?.status === 'cancelled' ? failedName(target) : target?.planName ?? id; openModal({
    title: 'Delete comparison?',
    body: <p><strong>{name}</strong> and its comments will be deleted. This can't be undone.</p>,
    buttons: [{ label: 'Cancel', run: closeModal }, { label: 'Delete', variant: 'primary', run: () => {
      setRecords(rs => rs.filter(r => r.id !== id)); if (activeId === id) { setActiveId(null); setPage('dashboard'); } closeModal(); toast(`${name} deleted.`);
    } }],
  }); };
  const showGuide = () => openModal({ title: 'About AI Plan Comparison', wide: true, body: <Guide /> });

  /* ---------- views ---------- */
  // Plan comparisons list: plain table, plan name first, status as tabs people can scan.
  function ListView() {
    const q = filters.plan.trim().toLowerCase();
    const all = Core.filterRecords(records, EMPTY_FILTERS);
    const matches = all.filter(r => !q || `${r.planName} ${failedName(r)} ${r.priorProvider} ${r.currentProvider} ${r.planId} ${r.id}`.toLowerCase().includes(q));
    const tabs: [string, string][] = [['', 'All'], ['review', 'Draft'], ['submitted', 'Submitted'], ['failed', 'Cancelled']];
    const found = matches.filter(r => !filters.status || recordStatus(r) === filters.status);
    const sortVal = (r: PlanRecord): string | number => !sort ? 0 : sort.key === 'plan' ? (recordStatus(r) === 'failed' ? failedName(r) : r.planName)
      : sort.key === 'status' ? recordStatus(r) : sort.key === 'prior' ? r.priorProvider : sort.key === 'current' ? r.currentProvider : r.provisions.filter(p => p.status !== 'match').length;
    const sorted = !sort ? found : [...found].sort((a, b) => { const x = sortVal(a), y = sortVal(b); return (typeof x === 'number' ? x - (y as number) : x.localeCompare(y as string)) * sort.dir; });
    const sortTh = (key: NonNullable<typeof sort>['key'], label: string, cls = '') => {
      const on = sort?.key === key;
      return <th className={cls} aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={`th-sort ${on ? 'on' : ''}`} onClick={() => setSort(on ? { key, dir: sort!.dir === 1 ? -1 : 1 } : { key, dir: 1 })}>
          {label}<Icon name={on ? (sort!.dir === 1 ? 'sortUp' : 'sortDown') : 'sort'} /></button></th>;
    };
    const shown = sorted.slice(0, visibleCount), hasMore = shown.length < found.length;
    // Lazy load: the table scrolls inside its card and fetches the next batch near the bottom.
    const onTableScroll = (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - 80) setVisibleCount(c => c + BATCH_SIZE);
    };
    return <>
      <div className="page-title-row page-title-row--rule">
        <div className="page-header"><h1 className="page-title">Plan comparisons</h1></div>
        <Button variant="primary" size="regular" onClick={() => openCreate()}>New comparison</Button>
      </div>
      {/* Filter bar — kit pattern: labeled fields, Reset link, Search button */}
      <form className="filter-bar" aria-label="Filter comparisons" onSubmit={e => { e.preventDefault(); setFilters({ ...draftFilters, plan: draftFilters.plan.trim() }); setVisibleCount(BATCH_SIZE); }}>
        <InputText id="filter-plan" label="Plan Name" icon="search" type="search" placeholder="Search plan or provider" maxLength={150}
          value={draftFilters.plan} onChange={e => setDraftFilters(f => ({ ...f, plan: e.target.value }))} />
        <Select id="filter-status" label="Status" value={draftFilters.status} onChange={e => setDraftFilters(f => ({ ...f, status: e.target.value }))}
          options={tabs.map(([k, label]) => [k, label])} />
        <div className="filter-bar-actions">
          <button type="button" className="reset-link" onClick={() => { setFilters(EMPTY_FILTERS); setDraftFilters(EMPTY_FILTERS); setVisibleCount(BATCH_SIZE); }}><Icon name="reset" /><span>Reset</span></button>
          <Button type="submit" variant="secondary" size="regular">Search</Button>
        </div>
      </form>
      <div className="record-count"><strong>{found.length}/{all.length}</strong> Record(s)</div>
      {!shown.length ? (
        <div className="no-records"><img src={noRecordsImg} alt="" width={240} height={240} /><h2>No comparisons found</h2>
          <p>{q ? 'Try another plan or provider name.' : <>Start with a <button type="button" className="text-link" onClick={() => openCreate()}>new comparison</button>.</>}</p></div>
      ) : (<>
        <Card className="table-card"><div className="table-scroll table-scroll--lazy" onScroll={onTableScroll}>
          <table className="ds-table plan-list">
            <caption className="sr-only">Plan comparisons</caption>
            <colgroup><col className="pl-plan" /><col className="pl-prov" /><col className="pl-prov" /><col className="pl-changes" /><col className="pl-status" /></colgroup>
            <thead><tr>{sortTh('plan', 'Plan')}{sortTh('prior', 'Prior provider')}{sortTh('current', 'Current provider')}{sortTh('changes', 'Differences', 'num')}{sortTh('status', 'Status')}</tr></thead>
            <tbody>{shown.map(r => {
              const st = recordStatus(r), diff = r.provisions.filter(p => p.status === 'difference').length, miss = r.provisions.filter(p => p.status === 'missing').length;
              const name = st === 'failed' ? failedName(r) : r.planName;
              return <tr key={r.id} className="row-link" tabIndex={0} aria-label={`Open ${st === 'failed' ? failedName(r) : r.planName}`}
                onClick={() => openReview(r.id)} onKeyDown={e => { if (e.key === 'Enter') openReview(r.id); }}>
                <td><div className="pl-plan-cell"><span className="pl-plan-text"><span className="pl-name truncate" title={name}>{name}</span>
                  {st === 'failed' && <span className="pl-sub truncate">Documents couldn't be read</span>}</span></div></td>
                <td>{st === 'failed' ? <span className="small-muted">—</span> : <span className="prov-name truncate" title={r.priorProvider}>{r.priorProvider}</span>}</td>
                <td>{st === 'failed' ? <span className="small-muted">—</span> : <span className="prov-name prov-name--current truncate" title={r.currentProvider}>{r.currentProvider}</span>}</td>
                <td className="num">{st === 'failed' ? <span className="small-muted">—</span> : <span className="pl-count">{diff + miss}</span>}</td>
                <td>{st === 'failed' ? <Badge tone="critical">Cancelled</Badge> : st === 'submitted' ? <Badge tone="success">Submitted</Badge> : <Badge tone="neutral">Draft</Badge>}</td>
              </tr>;
            })}
              {hasMore && <tr className="lazy-row"><td colSpan={5}><Icon name="spinner" className="spinner" /> Loading more comparisons…</td></tr>}
            </tbody>
          </table>
        </div></Card>
      </>)}
    </>;
  }

  // New comparison: upload both plans here; Compare plans opens the review on its own page.
  function CreateView() {
    const compared = record;
    const docs = compared ? [['Prior plan', compared.documents.prior], ['Current plan', compared.documents.current]] as const : null;
    return <>
      <div className="page-back-bar"><button type="button" className="back-link page-back" onClick={() => navigate('dashboard')}><Icon name="arrowLeft" /><span>Back</span></button></div>
      <div className="page-title-row">
        <div className="page-header"><h1 className="page-title">New comparison</h1></div>
        {compared
          ? <Button variant="secondary" size="regular" onClick={() => openCreate()}>Start another</Button>
          : <div className="actions"><Button variant="secondary" size="regular" onClick={() => (request.prior.length || request.current.length || request.template.length) ? confirmCancel('the documents you uploaded') : navigate('dashboard')}>Cancel</Button>
              <Button variant="primary" size="regular" disabled={!Core.canStart(request)} onClick={startComparison}
              title={Core.canStart(request) ? undefined : 'Add both plan documents first'}>Compare plans</Button></div>}
      </div>
      {docs ? (
        <div className="up-summary">{docs.map(([label, list]) => (
          <div key={label} className="up-summary-item"><Icon name="checkCircle" solid /><div>
            <div className="meta-label">{label}</div>
            <div className="up-summary-files">{list.map(d => d.name).join(', ')}</div></div></div>))}
        </div>
      ) : (
        // One card, kit horizontal Drag & Drop Upload rows (Figma 1027:8472): label on the left, drop zone on the right.
        <div className="up-panel">
          {uploadStep('prior', '1', 'Prior plan', 'The plan as it was with the previous provider')}
          {uploadStep('current', '2', 'Current plan', 'The plan with the new provider')}
          {uploadStep('template', '3', 'TOR template (Optional)', 'Use your own format for the downloaded TOR', false)}
        </div>
      )}
    </>;
  }

  function DetailView() {
    if (!record) return ListView();
    return <>
      <div className="page-back-bar"><button type="button" className="back-link page-back" onClick={() => navigate('dashboard')}><Icon name="arrowLeft" /><span>Back</span></button></div>
      {record.status === 'cancelled' ? FailedView() : ReviewView()}
    </>;
  }

  // A failed comparison has no extracted plan name; name it after its uploaded file so people can recognise it.
  function failedName(r: PlanRecord) {
    const file = r.documents.current[0]?.name ?? r.documents.prior[0]?.name;
    return file ? file.replace(/\.[^.]+$/, '').replace(/_/g, ' ') : 'Unnamed comparison';
  }

  function FailedView() {
    const f = record!;
    const docs = [...f.documents.prior.map(d => ['Prior plan', d.name]), ...f.documents.current.map(d => ['Current plan', d.name])];
    return <>
      <div className="page-heading">
        <div className="page-header"><h1 className="page-title">Comparison failed</h1></div>
        <div className="actions">
          <Button variant="secondary" size="regular" onClick={() => confirmRemove(f.id)}>Delete</Button>
          <Button variant="primary" size="regular" onClick={() => openCreate()}>Try again</Button>
        </div>
      </div>
      <section className="cmp-strip" aria-label="Plans compared">
        <div className="cmp-cell cmp-cell--plan"><span className="cmp-k">Plan</span><span className="cmp-v">{failedName(f)}</span></div>
        <div className="cmp-cell"><span className="cmp-k">Prior provider</span><span className="cmp-v cmp-v--muted">Not read</span></div>
        <div className="cmp-cell cmp-cell--current"><span className="cmp-k">Current provider</span><span className="cmp-v cmp-v--muted">Not read</span></div>
        <div className="cmp-cell cmp-cell--status"><span className="cmp-k">Status</span><span><Badge tone="critical">Cancelled</Badge></span></div>
      </section>
      <div className="failed-reason" role="alert"><Icon name="info" solid /><div>
        <strong>The current plan document couldn't be read.</strong>
        <p>It's a scanned image, so its text couldn't be extracted. Upload a text-based PDF or Word file and try again.</p>
      </div></div>
      {docs.length > 0 && <Card className="failed-files-card"><div className="ds-label">Uploaded files</div>
        <ul className="failed-files">{docs.map(([k, n], j) => <li key={j}><span className="small-muted">{k}</span><span>{n}</span></li>)}</ul></Card>}
    </>;
  }

  function uploadStep(bucket: Bucket, _step: string, title: string, hint: string, multiple = true) {
    const files = request[bucket];
    // Rejected files come back from validation as "name: reason"; show each as an Unsupported card.
    const rejected = errorBucket === bucket ? uploadErrors.map(e => {
      const k = e.indexOf(': '), name = k > 0 ? e.slice(0, k) : 'File', reason = k > 0 ? e.slice(k + 2) : e;
      const label = /supported/i.test(reason) ? 'Unsupported' : /50 MB/.test(reason) ? 'Too large' : /already/.test(reason) ? 'Duplicate' : /empty/.test(reason) ? 'Empty file' : 'Not added';
      return { name, reason, label };
    }) : [];
    return <UploadStep title={title} hint={hint} accept={ACCEPT} multiple={multiple} rejected={rejected}
      onFiles={f => addFiles(bucket, f)} onRemove={i => removeFile(bucket, i)} onDismiss={() => setUploadErrors([])}
      onReplace={(i, f) => replaceFile(bucket, i, f)} onDownload={i => downloadUpload(bucket, i)}
      files={files.map(f => ({ name: f.name, size: Core.fileSize(f.size) }))} />;
  }

  function ReviewView() {
    if (!record) return null;
    const r = record, locked = !!r.submittedAt;
    const rows = r.provisions.filter(p => p.status !== 'match');
    const filtered = rows.filter(p => provisionFilter === 'all' || (provisionFilter === 'impact' ? isBenefitImpact(p.name) : p.status === provisionFilter));
    // Summary tiles double as filters: what changed, what is missing, what you've already edited.
    const tiles: [string, string, number, string][] = [
      ['all', 'All', rows.length, 'brand'],
      ['difference', 'Difference', rows.filter(p => p.status === 'difference').length, 'warning'],
      ['missing', 'Missing', rows.filter(p => p.status === 'missing').length, 'critical'],
      ['impact', 'Benefit impacts', rows.filter(p => isBenefitImpact(p.name)).length, 'brand'],
    ];
    const isMissing = (v: string) => !v || v === 'Not found';
    return <>
      <div className="page-heading">
        <div className="page-header">
          <h1 className="page-title">Review changes</h1>
        </div>
        <div className="actions">
          {locked
            ? <Button variant="secondary" size="regular" onClick={() => confirmRemove(r.id)}>Delete</Button>
            : <><Button variant="tertiary" size="regular" onClick={saveDraft}>Save as draft</Button>
              <Button variant="secondary" size="regular" onClick={() => confirmCancel('changes you made to this review')}>Cancel</Button></>}
          {locked
            ? <Button variant="primary" size="regular" icon="download" onClick={() => downloadTor(r.id)}>Download TOR</Button>
            : <Button variant="primary" size="regular" onClick={submitReview}>Submit</Button>}
        </div>
      </div>
      {/* Which plans are being compared — its own block, separate from the table */}
      <section className="cmp-strip" aria-label="Plans compared">
        <div className="cmp-cell cmp-cell--plan"><span className="cmp-k">Plan</span><span className="cmp-v">{r.planName}</span></div>
        <div className="cmp-cell"><span className="cmp-k">Prior provider</span><span className="cmp-v">{r.priorProvider}</span></div>
        <div className="cmp-cell cmp-cell--current"><span className="cmp-k">Current provider</span><span className="cmp-v">{r.currentProvider}</span></div>
        <div className="cmp-cell cmp-cell--status"><span className="cmp-k">Status</span><span>{locked ? <Badge tone="success">Submitted</Badge> : <Badge tone="neutral">Draft</Badge>}</span></div>
      </section>
      <div className="rv-toolbar">
        <div className="rv-chips" role="tablist" aria-label="Filter changes">
          {tiles.map(([v, label, count]) => (
            <button key={v} type="button" role="tab" aria-selected={provisionFilter === v} className={`rv-chip ${provisionFilter === v ? 'active' : ''}`} onClick={() => setProvisionFilter(v)}>
              {provisionFilter === v && <Icon name="check" />}{label}<span className="rv-num">{count}</span>
            </button>))}
        </div>
      </div>
      <div className="rv-card rv-card--stack">
        <div className="rv-main">
          <table className="ds-table review-table review-split-table">
            <caption className="sr-only">Changes between the prior and current plan</caption>
            <colgroup><col className="c-prov" /><col className="c-val" /><col className="c-val" /><col className="c-com" /><col className="c-act" /></colgroup>
            <thead><tr><th>Provision</th><th>Prior plan</th><th>Current plan</th><th>AI comment</th><th className="th-action">Action</th></tr></thead>
            <tbody>
              {!filtered.length && <tr className="empty-row"><td colSpan={5}><Icon name="checkCircle" solid />{
                provisionFilter === 'missing' ? 'No missing provisions. Every prior provision was found in the current plan.'
                : provisionFilter === 'impact' ? 'No changes affect what participants receive.'
                : provisionFilter === 'difference' ? 'No provision values differ between the two plans.'
                : 'No changes found between the two plans.'}</td></tr>}
              {filtered.map(p => (
                // Drafts open the slide-out from the Action edit icon only; submitted rows open read-only on row click.
                <tr key={p.id} {...(locked ? { className: 'row-link', tabIndex: 0, 'aria-label': `View ${p.name}`,
                  onClick: () => goToComment(p.id), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') goToComment(p.id); } } : {})}>
                  <td><span className="provision-name">{p.name}</span></td>
                  <td><span className={isMissing(p.prior) ? 'missing-value' : 'chg-was'}>{isMissing(p.prior) ? 'Not found' : p.prior}</span></td>
                  <td><span className={isMissing(p.current) ? 'missing-value' : 'chg-now'}>{isMissing(p.current) ? 'Not found' : p.current}</span></td>
                  <td><div className="com-preview com-preview--2"><span className="clamp2" title={p.comment}>{p.comment}</span></div></td>
                  <td className="td-action">{!locked && <IconButton icon="edit" title="Edit" label={`Edit ${p.name}`}
                    onClick={e => { e.stopPropagation(); goToComment(p.id); }} />}</td>
                </tr>))}
            </tbody>
          </table>
        </div>
      </div>
    </>;
  }

  const views = { dashboard: ListView, review: DetailView, create: CreateView };
  // Called as functions (not <View/>) so inputs keep focus across re-renders.
  const content = views[page]();

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="topbar">
      <IconButton icon="menu" label="Toggle navigation" className="mobile-menu" aria-expanded={navOpen} onClick={() => setNavOpen(o => !o)} />
      <div className="tenant-logo"><img src={galileoLogo} alt="Galileo" width={134} height={32} /></div>
      <div className="top-right">
        <button type="button" className="nav-icon" aria-label="Notifications, 25 new" onClick={() => toast('Notifications are not part of this prototype.')}>
          <Icon name="bell" /><span className="nav-count">+25</span>
        </button>
        <IconButton icon="help" label="About this feature" className="nav-icon" title="About this feature" onClick={showGuide} />
        <span className="nav-avatar" title="Alex Morgan · alex.morgan@example.com"><Avatar initials="AM" size={36} /><span className="online-dot" aria-label="Online" /></span>
      </div>
    </header>
    <aside className={`sidebar ${navOpen ? 'open' : ''}`} aria-label="Main navigation">
      <div className="core-logo"><img src={coreLogo} alt="CORE" width={56} height={21} /></div>
      <nav className="rail">
        {([['gauge', 'Dashboard'], ['payroll', 'Payroll'], ['user', 'Employee'], ['wrench', 'Plan Config'], ['transfer', 'Transactions']] as const).map(([ic, label]) => (
          <button key={label} type="button" className="rail-item" title={label} onClick={() => toast(`${label} is not part of this prototype.`)}>
            <Icon name={ic} /><span>{label}</span>
          </button>))}
        <button type="button" className="rail-item is-active" title="Others · AI Plan Comparison" aria-current="page" onClick={() => navigate('dashboard')}>
          <Icon name="grid" solid /><span>Others</span>
        </button>
      </nav>
    </aside>
    <div className="shell">
      <main id="main" className="main main--flow" tabIndex={-1} ref={mainRef}><div className="flow-content">{content}</div></main>
    </div>
    {page === 'review' && record && commentEdit && (() => {
      const row = record.provisions.find(p => p.id === commentEdit.id);
      if (!row) return null;
      const locked = !!record.submittedAt;
      const close = () => {
        if (!commentDirty) { setCommentEdit(null); return; }
        openModal({ title: 'Discard your changes?', body: <p>Your edits to this provision haven't been saved.</p>,
          buttons: [{ label: 'Discard', variant: 'primary', run: () => { closeModal(); setCommentEdit(null); } }, { label: 'Keep editing', run: closeModal }] });
      };
      return (
        <Drawer title={row.name} onClose={close} blocked={!!modal}
          footer={locked ? <Button variant="secondary" size="regular" onClick={close}>Close</Button> : <>
            <Button variant="secondary" size="regular" onClick={close}>Cancel</Button>
            <Button variant="primary" size="regular" disabled={!commentDirty} onClick={saveComment}>Save</Button></>}>
          {/* Context card: plan, then each provider with this provision's value underneath */}
          <div className="sum-card">
            <div className="sum-cell sum-cell--plan"><span className="sum-k">Plan name</span><span className="sum-v">{record.planName}</span></div>
            <div className="sum-cell"><span className="sum-k">Prior provider</span><span className="sum-v">{record.priorProvider}</span></div>
            <div className="sum-cell"><span className="sum-k">Current provider</span><span className="sum-v">{record.currentProvider}</span></div>
          </div>
          {(['prior', 'current'] as const).map(k => (
            <div key={k} className="ds-field">
              <label htmlFor={`${k}-input`} className="ds-label">{k === 'prior' ? 'Prior plan' : 'Current plan'}</label>
              <TextArea id={`${k}-input`} className="comment-textarea comment-textarea--hug" rows={2} maxLength={1000} readOnly={locked}
                placeholder="Not found" value={commentEdit[k] === 'Not found' ? '' : commentEdit[k]}
                onChange={e => setCommentEdit({ ...commentEdit, [k]: e.target.value })} />
            </div>))}
          <div className="ds-field">
            <label htmlFor="comment-input" className="ds-label">AI comment</label>
            <TextArea id="comment-input" className="comment-textarea comment-textarea--hug" rows={Math.max(3, Math.ceil(commentEdit.value.length / 95) + 1)} maxLength={2000} readOnly={locked}
              value={commentEdit.value} onChange={e => setCommentEdit({ ...commentEdit, value: e.target.value })} />
            {row.sopRule && <p className="cmp-sop"><Icon name="info" solid /> Based on {row.sopRule}</p>}
          </div>
        </Drawer>
      );
    })()}
    {modal?.kind === 'generic' && (
      <Modal title={modal.title} wide={modal.wide} onClose={closeModal}
        buttons={modal.buttons ?? [{ label: 'Got it', variant: 'primary', run: closeModal }]}>{modal.body}</Modal>
    )}
    <TooltipLayer />
    <ToastStack toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
  </>;
}

function Guide() {
  return <>
    <p>Reading two plan documents side by side to find what changed is slow and error-prone. AI Plan Comparison does that work: upload the prior and current provider documents, and it lists only the provisions that changed.</p>
    <div className="guide-section"><h3>How it works</h3><ol className="guide-list">
      <li>Select <strong>New comparison</strong> and upload the prior and current provider documents. An existing TOR format is optional.</li>
      <li>Select <strong>Compare plans</strong>. The review shows only changed provisions: <strong>Differences</strong> (both plans have it, values differ), and <strong>Missing</strong> (only one plan has it).</li>
      <li>Each change has an AI comment explaining it. Use the edit icon to adjust a comment; provider values come from the documents and can't be edited.</li>
      <li>Select <strong>Submit</strong> to finalize. The TOR document can then be downloaded from the review or the dashboard.</li>
    </ol></div>
    <div className="guide-section"><h3>What is simulated</h3><p>Document analysis is simulated: every comparison uses the same illustrative provisions. Changes are saved in this browser only.</p></div>
  </>;
}

