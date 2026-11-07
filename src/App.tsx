import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as Core from './core';
import type { Bucket, Filters, PlanRecord, Provision, Request } from './core';
import { Icon } from './ui/Icon';
import coreLogo from './assets/core-logo.svg';
import { TooltipLayer } from './ui/Tooltip';
import noRecordsImg from './assets/no-records.png';
import galileoLogo from './assets/galileo-logo.svg';
import {
  Avatar, Badge, Button, IconButton, InputText, Modal, Select, UploadStep,
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
// Plan sections in document order; the review table groups its rows under these.
const SECTION_ORDER = ['Eligibility', 'Contributions', 'Vesting', 'Service crediting', 'Loans and withdrawals', 'Retirement'];
// Changes in review order: filtered, then grouped by plan section in document order.
function orderedRows(r: PlanRecord, filter: string) {
  const rows = r.provisions.filter(p => p.status !== 'match').filter(p => filter === 'all' || (filter === 'impact' ? isBenefitImpact(p.name)
    : filter === 'unreviewed' ? Core.needsReview(p) : p.status === filter));
  const sections = SECTION_ORDER.concat([...new Set(rows.map(p => p.category))].filter(c => !SECTION_ORDER.includes(c)));
  return sections.flatMap(s => rows.filter(p => p.category === s));
}
// Word-level highlight: words only in this value are marked against the other plan's value.
function diffWords(text: string, other: string, kind: 'ins' | 'del') {
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9½%]/g, '');
  const theirs = new Set(other.split(/\s+/).map(norm).filter(Boolean));
  return text.split(/(\s+)/).map((w, i) => /^\s+$/.test(w) || !norm(w) || theirs.has(norm(w)) ? w
    : <span key={i} className={`diff-${kind}`}>{w}</span>);
}
// Documents a failed comparison couldn't read: scanned files, else (sample data) the first current-plan file.
function unreadableDocs(r: PlanRecord) {
  const all = [...r.documents.prior, ...r.documents.current].filter(d => /scan/i.test(d.name)).map(d => d.name);
  return all.length ? all : r.documents.current.slice(0, 1).map(d => d.name);
}
// How far a person has got signing off a comparison's changes.
function reviewProgress(r: PlanRecord) {
  const rows = r.provisions.filter(p => p.status !== 'match'), done = rows.filter(p => !Core.needsReview(p)).length;
  return { done, total: rows.length, pct: rows.length ? Math.round((done / rows.length) * 100) : 0 };
}
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
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [request, setRequest] = useState<Request>(Core.newRequest);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [errorBucket, setErrorBucket] = useState<Bucket | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  // "Compare plans" pause while the documents are read; the timer lets Cancel stop it.
  const [comparing, setComparing] = useState(false);
  // Simulated upload progress runs ~1.5s per batch (UploadStep); Compare waits until it settles.
  const [uploading, setUploading] = useState(false);
  const uploadTimer = useRef<number | undefined>(undefined);
  const markUploading = () => { setUploading(true); clearTimeout(uploadTimer.current); uploadTimer.current = window.setTimeout(() => setUploading(false), 1600); };
  const compareTimer = useRef<number | undefined>(undefined);
  // Failed comparison being retried from New comparison; a successful compare replaces it.
  const [retryOf, setRetryOf] = useState<string | null>(null);
  // Row being edited in the slide-out: prior value, current value and AI comment (`value`).
  // The change selected in the review workspace, with its unsaved draft (values, comment, sign-off).
  const [commentEdit, setCommentEdit] = useState<{ id: string; prior: string; current: string; value: string; reviewed: boolean; resolution: string } | null>(null);
  // Whether the selected change's values and comment are open for editing.
  const [editing, setEditing] = useState(false);
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const toastId = useRef(0);

  const record = records.find(r => r.id === activeId);
  const editRow = commentEdit && record?.provisions.find(p => p.id === commentEdit.id);
  const commentDirty = !!commentEdit && !!editRow && (commentEdit.value !== editRow.comment || commentEdit.prior !== editRow.prior || commentEdit.current !== editRow.current
    || commentEdit.reviewed !== !!editRow.reviewedAt || commentEdit.resolution !== (editRow.resolution ?? ''));

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
    setPage(next); setCommentEdit(null); setNavOpen(false); setRetryOf(null);
    clearTimeout(compareTimer.current); setComparing(false);
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

  const openCreate = () => safeRoute(() => { setRequest(Core.newRequest()); setUploadErrors([]); setErrorBucket(null); setTemplateOpen(false); setActiveId(null); setCommentEdit(null); setRetryOf(null); setPage('create'); focusTop(); });
  // Retry a failed comparison: keep every document that was read, drop only the unreadable one.
  const retryFailed = (f: PlanRecord) => {
    const bad = unreadableDocs(f), keep = (docs: Core.Doc[]) => docs.filter(d => !bad.includes(d.name));
    setRequest({ prior: keep(f.documents.prior), current: keep(f.documents.current), template: f.template ? [f.template] : [] });
    setUploadErrors([]); setErrorBucket(null); setTemplateOpen(!!f.template); setActiveId(null); setCommentEdit(null);
    setRetryOf(f.id); setPage('create'); focusTop();
  };

  const openReview = (id: string) => safeRoute(() => {
    setActiveId(id); setPage('review'); setCommentEdit(null); setNavOpen(false); focusTop();
  });


  /* ---------- row edits: prior plan, current plan and AI comment ---------- */
  // Saves the selected change's draft (values, comment, sign-off). `reviewed` overrides the draft's sign-off.
  // Returns false when something blocks the save, so callers don't move on.
  const saveComment = (reviewedOverride?: boolean) => {
    if (!record || !commentEdit) return false;
    const draft = { ...commentEdit, reviewed: reviewedOverride ?? commentEdit.reviewed };
    const value = draft.value.trim(), prior = draft.prior.trim(), current = draft.current.trim();
    if (!value) { toast('A comment cannot be empty.', 'error'); return false; }
    const row = record.provisions.find(p => p.id === draft.id);
    if (!row) return false;
    let saved = record;
    if (value !== row.comment || prior !== row.prior || current !== row.current)
      // An empty plan value means the provision isn't in that document.
      saved = Core.commitEdits(saved, [{ ...row, comment: value, prior: prior || 'Not found', current: current || 'Not found' }]);
    const after = saved.provisions.find(p => p.id === row.id)!;
    if (draft.reviewed && after.status === 'missing' && !draft.resolution) { toast('Choose a resolution for this missing provision first.', 'error'); return false; }
    if (draft.reviewed !== !!row.reviewedAt || draft.resolution !== (row.resolution ?? ''))
      saved = Core.setReview(saved, row.id, draft.reviewed, after.status === 'missing' ? draft.resolution : '');
    if (saved !== record) setRecords(rs => rs.map(r => r.id === saved.id ? saved : r));
    const fresh = saved.provisions.find(p => p.id === row.id)!;
    setCommentEdit({ id: fresh.id, prior: fresh.prior, current: fresh.current, value: fresh.comment, reviewed: !!fresh.reviewedAt, resolution: fresh.resolution ?? '' });
    setEditing(false);
    return true;
  };

  // Open one change for editing; another open edit with unsaved changes has to be saved or cancelled first.
  const startEdit = (p: Provision) => {
    if (commentDirty && commentEdit?.id !== p.id) { toast('Save or cancel the change you are editing first.', 'error'); return; }
    setCommentEdit({ id: p.id, prior: p.prior, current: p.current, value: p.comment, reviewed: !!p.reviewedAt, resolution: p.resolution ?? '' });
    setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setCommentEdit(null); };


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
    // Every change needs a person's sign-off (and Missing rows a resolution) before the TOR is final.
    const open = record.provisions.filter(p => p.status !== 'match' && Core.needsReview(p));
    if (open.length) {
      const total = record.provisions.filter(p => p.status !== 'match').length;
      openModal({
        title: 'Review all changes before you submit',
        body: <p>{open.length} of {total} changes still need review. Tick each one as reviewed. Missing provisions also need a resolution.</p>,
        buttons: [{ label: 'Show first to review', variant: 'primary', run: () => { closeModal(); const first = orderedRows(record, 'all').find(Core.needsReview); // After the modal hands focus back, move it to that row.
          if (first) setTimeout(() => { const el = document.getElementById(`chg-${first.id}`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus({ preventScroll: true }); }, 60); } }, { label: 'Keep reviewing', run: closeModal }],
      });
      return;
    }
    const id = record.id, name = record.planName;
    // No confirmation overlay: submit, return to the list, and confirm with a floating alert under its CTA.
    const now = new Date().toISOString();
    setRecords(rs => rs.map(r => r.id === id ? { ...r, submittedAt: now, submittedBy: Core.DEMO_USER, modifiedAt: now, modifiedBy: Core.DEMO_USER } : r));
    setCommentEdit(null); setPage('dashboard'); focusTop();
    toast(`${name} submitted. The TOR is ready to download.`);
  };

  /* ---------- create ---------- */
  const requestCompare = () => {
    if (!Core.canStart(request) || comparing || uploading) return;
    setComparing(true);
    compareTimer.current = window.setTimeout(() => { setComparing(false); startComparison(); }, 1800);
  };
  const stopCompare = () => { clearTimeout(compareTimer.current); setComparing(false); toast('Comparison stopped. Your documents are still here.'); };

  const startComparison = () => {
    if (!Core.canStart(request)) { setUploadErrors(['Add at least one document for both the prior and current provider.']); return; }
    let next = Core.completeRequest(request, records, new Date().toISOString(), Core.nextId(records));
    // Negative scenario: a scanned document can't be read, so the analysis ends in an error.
    if ([...request.prior, ...request.current].some(d => /scan/i.test(d.name))) next = { ...next, status: 'cancelled', provisions: [] };
    // A retry replaces the failed comparison instead of leaving both in the list.
    const replaced = retryOf;
    setRecords(rs => [next, ...rs.filter(r => r.id !== replaced)]); setRetryOf(null);
    setRequest(Core.newRequest()); setFilters(EMPTY_FILTERS); setDraftFilters(EMPTY_FILTERS); setVisibleCount(BATCH_SIZE);
    setActiveId(next.id); setCommentEdit(null); setPage('review'); focusTop();
    if (next.status !== 'cancelled') toast('Comparison ready. Go through each change, then submit.');
  };

  const addFiles = (bucket: Bucket, files: File[], replace = false) => {
    // The same file in both plans would compare a plan with itself, so it's caught before it's added.
    const other: Bucket | null = bucket === 'prior' ? 'current' : bucket === 'current' ? 'prior' : null;
    const clash = (f: File) => !!other && request[other].some(d => d.name === f.name && d.size === f.size);
    const crossErrors = files.filter(clash).map(f => `${f.name}: this file is already uploaded as the ${other} plan. Upload the ${bucket} plan's own document.`);
    const result = Core.addDocuments(replace ? { ...request, [bucket]: [] } : request, bucket, files.filter(f => !clash(f)));
    files.forEach(f => uploadedFiles.current.set(`${bucket}/${f.name}`, f));
    if (result.request[bucket].length > request[bucket].length) markUploading();
    setRequest(result.request); setUploadErrors([...crossErrors, ...result.errors]); setErrorBucket(bucket);
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
    if (!result.errors.length) { uploadedFiles.current.set(`${bucket}/${file.name}`, file); markUploading(); }
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
  // Plan comparisons: search, then one row per comparison; the whole row opens it.
  function ListView() {
    const q = filters.plan.trim().toLowerCase();
    const all = Core.filterRecords(records, EMPTY_FILTERS);
    const tabs: [string, string][] = [['', 'All'], ['review', 'Draft'], ['submitted', 'Submitted'], ['failed', 'Cancelled']];
    const found = all.filter(r => (!q || `${r.planName} ${failedName(r)} ${r.priorProvider} ${r.currentProvider}`.toLowerCase().includes(q))
      && (!filters.status || recordStatus(r) === filters.status));
    const shown = found.slice(0, visibleCount), hasMore = shown.length < found.length;
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
      <span className="record-count sl-count"><strong>{found.length}/{all.length}</strong> Record(s)</span>
      {!shown.length ? (
        <div className="no-records"><img src={noRecordsImg} alt="" width={240} height={240} /><h2>No comparisons found</h2>
          <p>{q ? 'Try another plan or provider name.' : <>Start with a <button type="button" className="text-link" onClick={() => openCreate()}>new comparison</button>.</>}</p></div>
      ) : (
        <div className="sl-table">
        <div className="sl-head" aria-hidden="true"><span>Plan</span><span>Review progress</span><span>Last updated</span><span>Status</span></div>
        <ul className="sl-list" aria-label="Plan comparisons">
          {shown.map(r => {
            const st = recordStatus(r), name = st === 'failed' ? failedName(r) : r.planName, pg = reviewProgress(r);
            return <li key={r.id} className="sl-row">
              <button type="button" className="cl-open" aria-label={`Open ${name}`} onClick={() => openReview(r.id)} />
              <div className="sl-main">
                <span className="sl-name truncate" title={name}>{name}</span>
                <span className="sl-sub truncate">{st === 'failed' ? 'A document couldn\'t be read' : `${r.priorProvider} → ${r.currentProvider}`}</span>
              </div>
              <span className="sl-note">{st === 'review' ? `${pg.done} of ${pg.total} reviewed` : ''}</span>
              <span className="sl-date">{Core.dateLabel(r.modifiedAt)}</span>
              <span>{st === 'failed' ? <Badge tone="critical">Cancelled</Badge> : st === 'submitted' ? <Badge tone="success">Submitted</Badge> : <Badge tone="neutral">Draft</Badge>}</span>
            </li>;
          })}
        </ul>
        </div>
      )}
      {hasMore && <div className="sl-more"><Button variant="secondary" size="regular" onClick={() => setVisibleCount(c => c + BATCH_SIZE)}>Show more ({found.length - shown.length})</Button></div>}
    </>;
  }

  // New comparison: upload both plans here; Compare plans opens the review on its own page.
  function CreateView() {
    const compared = record;
    const docs = compared ? [['Prior plan', compared.documents.prior], ['Current plan', compared.documents.current]] as const : null;
    const ready = Core.canStart(request) && !uploading;
    const missing = !request.prior.length && !request.current.length ? 'both plans' : !request.prior.length ? 'the prior plan' : 'the current plan';
    const hasDocs = !!(request.prior.length || request.current.length || request.template.length);
    return <>
      <div className="page-back-bar"><button type="button" className="back-link page-back" onClick={() => navigate('dashboard')}><Icon name="arrowLeft" /><span>Back</span></button></div>
      <div className="page-title-row">
        <div className="page-header"><h1 className="page-title">New comparison</h1></div>
        {compared
          ? <Button variant="secondary" size="regular" onClick={() => openCreate()}>Start another</Button>
          : <div className="actions">
              {!ready && <span className="ready-hint" aria-live="polite">{uploading ? 'Uploading…' : `Add ${missing} to compare`}</span>}
              <Button variant="secondary" size="regular" onClick={() => comparing ? stopCompare() : hasDocs ? confirmCancel('the documents you uploaded') : navigate('dashboard')}>Cancel</Button>
              <Button variant="primary" size="regular" disabled={!ready || comparing} aria-busy={comparing} onClick={requestCompare}>
                {comparing ? <><Icon name="spinner" className="spinner" /> Comparing…</> : 'Compare plans'}</Button></div>}
      </div>
      {docs ? (
        <div className="up-summary">{docs.map(([label, list]) => (
          <div key={label} className="up-summary-item"><Icon name="checkCircle" solid /><div>
            <div className="meta-label">{label}</div>
            <div className="up-summary-files">{list.map(d => d.name).join(', ')}</div></div></div>))}
        </div>
      ) : (
        <div className={`up-flow2 ${comparing ? 'is-busy' : ''}`} aria-busy={comparing}>
          {retryOf && !comparing && (() => { const f = records.find(r => r.id === retryOf); return f && <div className="retry-note" role="status"><Icon name="info" solid />
            <p><strong>Retrying {failedName(f)}.</strong> The documents that were read are kept. {unreadableDocs(f).join(', ')} couldn't be read and was removed. Add a text-based copy of it, then compare again.</p></div>; })()}
          {comparing && <div className="cmp-progress" role="status"><Icon name="spinner" className="spinner" />
            <div><strong>Comparing the two plans</strong><span>Reading {request.prior.length + request.current.length} documents and matching each provision. This takes a few seconds.</span></div></div>}
          {/* Prior and current side by side, in the same order as the review table's columns. */}
          <div className="up-pair">
            {uploadStep('prior', '1', 'Prior plan', 'The plan as it was with the previous provider')}
            <span className="up-pair-arrow" aria-hidden="true"><Icon name="arrowRight" /></span>
            {uploadStep('current', '2', 'Current plan', 'The plan with the new provider')}
          </div>
          {templateOpen || request.template.length
            ? <div className="up-template">
                {uploadStep('template', '3', 'TOR template (Optional)', 'Use your own format for the downloaded TOR', false)}
                {!request.template.length && <button type="button" className="up-row-link up-template-hide" onClick={() => setTemplateOpen(false)}>Use the standard TOR instead</button>}
              </div>
            : <button type="button" className="up-row-link up-template-add" onClick={() => setTemplateOpen(true)}><Icon name="plus" />Add your own TOR template (optional)</button>}
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
    const f = record!, bad = unreadableDocs(f);
    return <>
      <div className="page-heading">
        <div className="page-header"><h1 className="page-title">{failedName(f)}</h1></div>
        <div className="actions">
          <Button variant="secondary" size="regular" onClick={() => confirmRemove(f.id)}>Delete</Button>
          <Button variant="primary" size="regular" onClick={() => retryFailed(f)}>Replace file and retry</Button>
        </div>
      </div>
      <div className="sr-card fc-card" role="alert">
        <span className="fc-icon" aria-hidden="true"><Icon name="alertCircle" solid /></span>
        <div>
          <h2 className="sr-title">This comparison couldn't run</h2>
          <p className="fc-lead"><strong>{bad.join(', ')}</strong> is a scanned image, so its text couldn't be read.
            Replace it with a text-based PDF or Word file. Your other files are kept.</p>
        </div>
      </div>
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

  // Review changes: every change in one list. Before, after and what it means, ticked off as reviewed.
  function ReviewView() {
    if (!record) return null;
    const r = record, locked = !!r.submittedAt;
    const list = orderedRows(r, 'all');
    const reviewed = list.filter(p => !Core.needsReview(p)).length;
    const isMissing = (v: string) => !v || v === 'Not found';
    // Sign-off straight from the list; a missing provision needs a resolution before it can be ticked.
    const sign = (p: Provision, done: boolean, resolution = p.resolution ?? '') => {
      if (done && p.status === 'missing' && !resolution) { toast('Choose a resolution for this missing provision first.', 'error'); return; }
      setRecords(rs => rs.map(x => x.id === r.id ? Core.setReview(x, p.id, done, p.status === 'missing' ? resolution : '') : x));
    };
    return <>
      <div className="page-heading">
        <div className="page-header"><h1 className="page-title">{r.planName}</h1>
          <p className="sr-route">{r.priorProvider} → {r.currentProvider} · {locked ? `Submitted ${Core.dateLabel(r.submittedAt!)}` : `${reviewed} of ${list.length} reviewed`}</p></div>
        <div className="actions">
          {locked
            ? <><Button variant="secondary" size="regular" onClick={() => confirmRemove(r.id)}>Delete</Button>
                <Button variant="primary" size="regular" icon="download" onClick={() => downloadTor(r.id)}>Download TOR</Button></>
            : <><Button variant="secondary" size="regular" onClick={saveDraft}>Save as draft</Button>
                <Button variant="primary" size="regular" onClick={submitReview}>Submit</Button></>}
        </div>
      </div>

      {!list.length ? <div className="rl-empty"><Icon name="checkCircle" solid /><p>No changes found between the two plans.</p></div> : (
      <div className="rl-table">
        <div className="rl-head" aria-hidden="true"><span>Change</span><span>Before</span><span>After</span><span>Reviewed</span></div>
        <ul className="rl-list" aria-label="Changes">
          {list.map(p => {
            const open = editing && commentEdit?.id === p.id, d = open ? commentEdit! : null, missing = p.status === 'missing', done = !Core.needsReview(p);
            const value = (k: 'prior' | 'current') => {
              const v = d ? d[k] : p[k], other = k === 'prior' ? p.current : p.prior;
              if (d) return <TextArea id={`${k}-${p.id}`} aria-label={`${p.name}: ${k === 'prior' ? 'before' : 'after'}`} className="comment-textarea comment-textarea--hug" rows={2} maxLength={1000}
                placeholder="Not found" value={v === 'Not found' ? '' : v} onChange={e => setCommentEdit({ ...d, [k]: e.target.value })} />;
              return isMissing(v) ? <span className="missing-value"><Icon name="alertCircle" solid />Not found</span> : isMissing(other) ? v : diffWords(v, other, k === 'prior' ? 'del' : 'ins');
            };
            return <li key={p.id} id={`chg-${p.id}`} tabIndex={-1} className={`rl-row ${done ? 'is-done' : ''} ${open ? 'is-editing' : ''}`}>
              <div className="rl-name">{p.name}{missing && <span className="rv-tag rv-tag--missing">Missing</span>}</div>
              <div className="rl-v">{value('prior')}</div>
              <div className="rl-v rl-v--after">{value('current')}</div>
              <div className="rl-check">
                {locked
                  ? <span className="rl-signed"><Icon name="checkCircle" solid /><span>{p.reviewedBy?.name ?? 'Reviewed'}</span></span>
                  : <label className="rl-box"><input type="checkbox" checked={done} disabled={open} aria-label={`Mark ${p.name} reviewed`}
                      onChange={e => sign(p, e.target.checked)} /><span aria-hidden="true">{done && <Icon name="check" />}</span></label>}
              </div>
              <div className="rl-why">
                {d
                  ? <TextArea id={`comment-${p.id}`} aria-label={`${p.name}: what this means`} className="comment-textarea comment-textarea--hug" rows={Math.max(2, Math.ceil(d.value.length / 110) + 1)} maxLength={2000}
                      value={d.value} onChange={e => setCommentEdit({ ...d, value: e.target.value })} />
                  : <p>{p.comment}</p>}
                {missing && (locked
                  ? <p className="rl-res"><strong>Resolution:</strong> {p.resolution ?? 'Not recorded'}</p>
                  : <label className="rl-res"><span>Resolution</span>
                      <span className="ds-select-wrap"><select className="ds-input ds-select" value={p.resolution ?? ''} onChange={e => sign(p, done && !!e.target.value, e.target.value)}>
                        <option value="">Choose one</option>{Core.RESOLUTIONS.map(v => <option key={v} value={v}>{v}</option>)}</select><Icon name="chevronDown" solid /></span></label>)}
                {!locked && <div className="rl-acts">{open
                  ? <><Button variant="secondary" size="small" onClick={cancelEdit}>Cancel</Button>
                      <Button variant="primary" size="small" onClick={() => { if (saveComment()) setCommentEdit(null); }}>Save</Button></>
                  : <button type="button" className="rw-link rl-edit" onClick={() => startEdit(p)}><Icon name="edit" />Edit</button>}</div>}
              </div>
            </li>;
          })}
        </ul>
      </div>)}
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
      <li>Select <strong>New comparison</strong> and upload the prior and current plan documents. Your own TOR template is optional.</li>
      <li>Select <strong>Compare plans</strong>. The AI reads both plans and lists only the provisions that changed, grouped by plan section: <strong>Difference</strong> (both plans have it, values differ) and <strong>Missing</strong> (only one plan has it).</li>
      <li>Work through each change. Compare before and after, edit a value or the note if it's wrong, and select <strong>Mark reviewed</strong>.</li>
      <li>A missing provision isn't treated as removed. Record a resolution for it (requested from the provider, found elsewhere, or confirmed not offered) before marking it reviewed.</li>
      <li>When every change is reviewed, select <strong>Submit</strong>. The TOR records each value, comment, resolution and reviewer, and can be downloaded from the review or the list.</li>
    </ol></div>
    <div className="guide-section"><h3>If a comparison fails</h3><p>Usually a document is a scanned image. Open it and select <strong>Replace file and retry</strong>: the documents that were read are kept, so you only replace the one that failed.</p></div>
    <div className="guide-section"><h3>What is simulated</h3><p>Document analysis is simulated: every comparison uses the same illustrative provisions. Changes are saved in this browser only.</p></div>
  </>;
}

