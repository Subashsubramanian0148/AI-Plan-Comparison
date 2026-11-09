import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as Core from './core';
import type { Bucket, Effect, Filters, PlanRecord, Provision, Request, Side } from './core';
import { Icon } from './ui/Icon';
import coreLogo from './assets/core-logo.svg';
import { TooltipLayer } from './ui/Tooltip';
import noRecordsImg from './assets/no-records.png';
import galileoLogo from './assets/galileo-logo.svg';
import {
  Avatar, Badge, Button, IconButton, InputText, Modal, Select, UploadStep,
  ToastStack, type ModalButton, type ToastItem,
} from './ui/components';

type Page = 'dashboard' | 'create' | 'record';
type ModalConfig = { title: string; body: ReactNode; buttons?: ModalButton[]; wide?: boolean };

const STORAGE_KEY = 'core.ai-plan-comparison.prototype.v1';
const BATCH_SIZE = 15;
const EMPTY_FILTERS: Filters = { plan: '', review: '', date: '', status: '' };
const ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Plan sections in document order; findings are listed under these.
const SECTION_ORDER = ['Eligibility', 'Contributions', 'Vesting', 'Service crediting', 'Loans and withdrawals', 'Administration', 'Retirement'];
const EFFECTS: Record<Effect, { label: string; tone: 'success' | 'critical' | 'warning' | 'neutral'; icon: string }> = {
  benefit: { label: 'Benefit', tone: 'success', icon: 'up' },
  disadvantage: { label: 'Disadvantage', tone: 'critical', icon: 'down' },
  mixed: { label: 'Mixed', tone: 'warning', icon: 'mixed' },
  neutral: { label: 'Neutral', tone: 'neutral', icon: 'minus' },
};
const CHANGE_LABEL = { added: 'New', removed: 'Not found', modified: 'Modified', unchanged: 'Unchanged' } as const;

// Analysis stages, each with what the AI is doing right now.
const STAGES = ['Reading both documents', 'Matching sections', 'Finding changes', 'Assessing impact on participants', 'Linking findings to their pages'];
const TICKS_PER_STAGE = 5, TICK_MS = 260;

const RANK: Record<Effect, number> = { disadvantage: 0, mixed: 1, benefit: 2, neutral: 3 };
// Changes in review order: worst first, then by plan section.
const sorted = (list: Provision[]) => { const sec = SECTION_ORDER.concat([...new Set(list.map(p => p.category))].filter(c => !SECTION_ORDER.includes(c)));
  return [...list].sort((a, b) => RANK[a.effect] - RANK[b.effect] || sec.indexOf(a.category) - sec.indexOf(b.category)); };
const recordStatus = (r: PlanRecord) => r.status === 'cancelled' ? 'failed' : r.submittedAt ? 'submitted' : 'review';
const failedName = (r: PlanRecord) => { const file = r.documents.current[0]?.name ?? r.documents.prior[0]?.name; return file ? file.replace(/\.[^.]+$/, '').replace(/_/g, ' ') : 'Unnamed comparison'; };

// SOP rule per finding, for records saved before it was stored on each one.
const SOP_BY_ID = new Map(Core.findings().map(f => [f.id, f.sop]));

let storageAvailable = true;
function loadRecords(): PlanRecord[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Version 3 holds findings with the AI original kept apart from corrections; older data is reseeded.
      if (parsed.version === 3 && Array.isArray(parsed.records)) {
        // Records saved before SOP references existed get them from the sample findings.
        const sop = new Map(Core.findings().map(f => [f.id, f.sop]));
        return parsed.records.map((r: PlanRecord) => ({ ...r, provisions: r.provisions.map(f => f.sop ? f : { ...f, sop: sop.get(f.id) }) }));
      }
    }
  } catch { storageAvailable = false; }
  return Core.seedRecords();
}

// A text field that grows with its content, so edits read like a document.
function AutoArea({ value, className = '', ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const fit = () => { el.style.height = '0px'; el.style.height = el.scrollHeight + 'px'; };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  return <textarea ref={ref} rows={1} value={value} className={`fd-edit ${className}`} {...rest} />;
}

export default function App() {
  const [records, setRecords] = useState<PlanRecord[]>(loadRecords);
  const [page, setPage] = useState<Page>('dashboard');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Upload
  const [request, setRequest] = useState<Request>(Core.newRequest);
  const [uploadError, setUploadError] = useState<{ bucket: Bucket; text: string } | null>(null);
  const [samePlan, setSamePlan] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadTimer = useRef<number | undefined>(undefined);
  const markUploading = () => { setUploading(true); clearTimeout(uploadTimer.current); uploadTimer.current = window.setTimeout(() => setUploading(false), 1600); };
  const [retryOf, setRetryOf] = useState<string | null>(null);
  const uploadedFiles = useRef(new Map<string, File>());
  // Analysis: the result is known up front; the ticker plays the stages before it is shown.
  const [analysis, setAnalysis] = useState<{ result: PlanRecord; tick: number; request: Request } | null>(null);
  // Review
  // Table edit mode: each change's comment, keyed by change id.
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [recTab, setRecTab] = useState<'all' | 'benefits' | 'disadvantages' | 'differences'>('all');
  const [submitOpen, setSubmitOpen] = useState(false);
  // Final review
  // Shell
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [sopOpen, setSopOpen] = useState<Provision | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const toastId = useRef(0);

  const record = records.find(r => r.id === activeId);

  /* ---------- infrastructure ---------- */
  const toast = useCallback((message: string, type: ToastItem['type'] = 'success') => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000);
  }, []);

  const firstPersist = useRef(true);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, records })); storageAvailable = true; }
    catch { storageAvailable = false; if (!firstPersist.current) toast('Saved for this session only. Browser storage is unavailable.', 'error'); }
    if (firstPersist.current && !storageAvailable) toast('Browser storage is unavailable. Changes will last for this session only.', 'error');
    firstPersist.current = false;
  }, [records, toast]);

  useEffect(() => {
    document.title = (page === 'record' && record ? (record.status === 'cancelled' ? failedName(record) : record.planName) + ' · ' : '') + 'AI Plan Comparison · CORE';
  }, [page, activeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !modal) { setNavOpen(false); setSopOpen(null); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal]);

  // Analysis ticker. A failing document stops it during the first stage.
  const failAt = 3, doneAt = STAGES.length * TICKS_PER_STAGE;
  useEffect(() => {
    if (!analysis || page !== 'create') return;
    const failed = analysis.result.status === 'cancelled';
    if (failed && analysis.tick >= failAt) return;
    if (analysis.tick >= doneAt) return;
    const t = setTimeout(() => setAnalysis(a => a && { ...a, tick: a.tick + 1 }), TICK_MS);
    return () => clearTimeout(t);
  }, [analysis, page]);
  // Save the outcome once the ticker reaches it, so leaving the page keeps it in the list.
  useEffect(() => {
    if (!analysis) return;
    const failed = analysis.result.status === 'cancelled';
    if ((failed && analysis.tick === failAt) || (!failed && analysis.tick === doneAt)) {
      const r = analysis.result, replaced = retryOf;
      setRecords(rs => replaced && rs.some(x => x.id === replaced) ? rs.map(x => x.id === replaced ? r : x) : rs.some(x => x.id === r.id) ? rs : [r, ...rs]);
      setRetryOf(null);
    }
  }, [analysis?.tick]);

  // Once the comparison is ready, go straight to its page.
  useEffect(() => {
    if (!analysis || page !== 'create' || analysis.result.status === 'cancelled' || analysis.tick < doneAt) return;
    const t = setTimeout(() => { const id = analysis.result.id; setAnalysis(null); openRecord(id); }, 600);
    return () => clearTimeout(t);
  }, [analysis?.tick, page]);

  const closeModal = () => setModal(null);
  const focusTop = () => requestAnimationFrame(() => { window.scrollTo({ top: 0 }); mainRef.current?.focus({ preventScroll: true }); });

  /* ---------- navigation ---------- */
  // Unsaved corrections must be saved or discarded before leaving a comparison.
  const safeRoute = (next: () => void) => next();
  const goList = () => safeRoute(() => { setPage('dashboard'); setActiveId(null); setNavOpen(false); setAnalysis(null); focusTop(); });

  const openCreate = () => safeRoute(() => {
    setRequest(Core.newRequest()); setUploadError(null); setSamePlan(false); setActiveId(null); setRetryOf(null); setAnalysis(null); setPage('create'); focusTop();
  });
  // Retry a failed comparison: keep the document that was read, drop the one that wasn't.
  const retryFailed = (f: PlanRecord) => {
    const bad = f.failure?.doc, keep = (docs: Core.Doc[]) => docs.filter(d => d.name !== bad);
    setRequest({ prior: keep(f.documents.prior), current: keep(f.documents.current) });
    setUploadError(null); setSamePlan(false); setActiveId(null); setAnalysis(null); setRetryOf(f.id); setPage('create'); focusTop();
  };

  // Reupload: open the upload slots with this comparison's documents, to swap the wrong one.
  const reuploadFor = (r: PlanRecord) => {
    setRequest({ prior: Core.clone(r.documents.prior), current: Core.clone(r.documents.current) });
    setUploadError(null); setSamePlan(false); setEdit(null); setActiveId(null); setAnalysis(null); setRetryOf(r.id); setPage('create'); focusTop();
  };

  const openRecord = (id: string) => safeRoute(() => {
    setActiveId(id); setPage('record'); setNavOpen(false); setEdit(null); setRecTab('all'); setSubmitOpen(false);
    focusTop();
  });

  /* ---------- upload ---------- */
  const addFiles = (bucket: Bucket, files: File[]) => {
    if (files.length > 1) { setUploadError({ bucket, text: `Upload one document for the ${bucket === 'prior' ? 'previous' : 'current'} plan.` }); return; }
    const f = files[0];
    if (!f) return;
    const result = Core.addDocument(request, bucket, f);
    if (result.error) { setUploadError({ bucket, text: result.error }); return; }
    uploadedFiles.current.set(`${bucket}/${f.name}`, f);
    markUploading(); setSamePlan(false);
    setRequest(result.request); setUploadError(null);
  };
  const downloadUpload = (bucket: Bucket) => {
    const doc = request[bucket][0], file = doc && uploadedFiles.current.get(`${bucket}/${doc.name}`);
    if (!file) { toast('Sample documents can\'t be downloaded in this prototype.', 'error'); return; }
    const url = URL.createObjectURL(file), a = document.createElement('a');
    a.href = url; a.download = file.name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const swapDocs = () => { setRequest(r => ({ prior: r.current, current: r.prior })); toast('Documents swapped.'); };

  const startAnalysis = (req = request) => {
    const check = Core.comparability(req);
    const blocking = check.problems.filter(p => !(p.kind === 'plan' && samePlan));
    if (!Core.canStart(req) || uploading || blocking.length) return;
    // A retry or reupload replaces its comparison in place: same ID and plan details.
    const old = retryOf ? records.find(r => r.id === retryOf) : undefined, made = Core.analyse(req, records);
    setAnalysis({ result: old ? { ...made, id: old.id, planName: old.planName, planId: old.planId, priorProvider: old.priorProvider, currentProvider: old.currentProvider } : made, tick: 0, request: req });
    focusTop();
  };
  const stopAnalysis = () => {
    if (!analysis) return;
    setRequest(analysis.request); setAnalysis(null); focusTop();
    toast('Analysis stopped. Your documents are still here.');
  };

  /* ---------- review actions ---------- */
  const patchRecord = (id: string, fn: (r: PlanRecord) => PlanRecord) => setRecords(rs => rs.map(x => x.id === id ? fn(x) : x));
  /* ---------- submission ---------- */
  const submitReview = () => {
    if (!record) return;
    const now = new Date().toISOString();
    patchRecord(record.id, r => ({ ...r, submittedAt: now, submittedBy: Core.DEMO_USER, modifiedAt: now, modifiedBy: Core.DEMO_USER }));
    setSubmitOpen(false); setEdit(null); setPage('dashboard'); setActiveId(null); focusTop(); toast('Review submitted.');
  };
  const downloadReport = (r: PlanRecord) => {
    const blob = new Blob([Core.zipStore(Core.reportDocx(r))], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `Plan_Comparison_${r.id}_DEMO.docx`; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Report download started.');
  };
  const confirmRemove = (r: PlanRecord) => {
    const name = r.status === 'cancelled' ? failedName(r) : r.planName;
    setModal({
      title: 'Delete comparison?',
      body: <p><strong>{name}</strong> and its review will be deleted. This can't be undone.</p>,
      buttons: [{ label: 'Cancel', run: closeModal }, { label: 'Delete', variant: 'primary', run: () => {
        setRecords(rs => rs.filter(x => x.id !== r.id)); setActiveId(null); setPage('dashboard'); closeModal(); toast(`${name} deleted.`);
      } }],
    });
  };
  const showGuide = () => setModal({ title: 'About AI Plan Comparison', wide: true, body: <Guide /> });

  /* ---------- shared bits ---------- */
  const valueText = (p: Provision, side: Side, v = p[side]) => v || <span className="fv-none">{side === 'prior' ? 'Not in the previous plan' : 'Not found in the current plan'}</span>;

  /* ---------- views ---------- */
  function ListView() {
    const q = filters.plan.trim().toLowerCase();
    const all = Core.filterRecords(records);
    const tabs: [string, string][] = [['', 'All'], ['review', 'Draft'], ['submitted', 'Submitted'], ['failed', 'Failed']];
    const found = all.filter(r => (!q || `${r.planName} ${failedName(r)} ${r.priorProvider} ${r.currentProvider}`.toLowerCase().includes(q))
      && (!filters.status || recordStatus(r) === filters.status));
    const shown = found.slice(0, visibleCount), hasMore = shown.length < found.length;
    return <>
      <div className="page-title-row page-title-row--rule">
        <div className="page-header"><h1 className="page-title">Plan comparisons</h1></div>
        <Button variant="primary" size="regular" onClick={openCreate}>New comparison</Button>
      </div>
      <form className="filter-bar" aria-label="Filter comparisons" onSubmit={e => { e.preventDefault(); setFilters({ ...draftFilters, plan: draftFilters.plan.trim() }); setVisibleCount(BATCH_SIZE); }}>
        <InputText id="filter-plan" label="Plan Name" icon="search" type="search" placeholder="Search plan or provider" maxLength={150}
          value={draftFilters.plan} onChange={e => setDraftFilters(f => ({ ...f, plan: e.target.value }))} />
        <Select id="filter-status" label="Status" value={draftFilters.status} onChange={e => setDraftFilters(f => ({ ...f, status: e.target.value }))} options={tabs} />
        <div className="filter-bar-actions">
          <button type="button" className="reset-link" onClick={() => { setFilters(EMPTY_FILTERS); setDraftFilters(EMPTY_FILTERS); setVisibleCount(BATCH_SIZE); }}><Icon name="reset" /><span>Reset</span></button>
          <Button type="submit" variant="secondary" size="regular">Search</Button>
        </div>
      </form>
      <span className="record-count sl-count"><strong>{found.length}/{all.length}</strong> Record(s)</span>
      {!shown.length ? (
        <div className="no-records"><img src={noRecordsImg} alt="" width={240} height={240} /><h2>No comparisons found</h2>
          <p>{q || filters.status ? 'Try another plan name or status.' : <>Start with a <button type="button" className="text-link" onClick={openCreate}>new comparison</button>.</>}</p></div>
      ) : (
        <div className="sl-table">
          <div className="sl-head" aria-hidden="true"><span>Plan</span><span>Prior plan</span><span>Current plan</span><span>Status</span></div>
          <ul className="sl-list" aria-label="Plan comparisons">
            {shown.map(r => {
              const st = recordStatus(r), name = st === 'failed' ? failedName(r) : r.planName;
              return <li key={r.id} className="sl-row">
                <button type="button" className="cl-open" aria-label={`Open ${name}`} onClick={() => openRecord(r.id)} />
                <span className="sl-name truncate" title={name}>{name}</span>
                <span className="truncate" title={r.priorProvider}>{r.priorProvider}</span>
                <span className="truncate" title={r.currentProvider}>{r.currentProvider}</span>
                <span>{st === 'failed' ? <Badge tone="critical">Failed</Badge> : st === 'submitted' ? <Badge tone="success">Submitted</Badge> : <Badge tone="neutral">Draft</Badge>}</span>
              </li>;
            })}
          </ul>
        </div>
      )}
      {hasMore && <div className="sl-more"><Button variant="secondary" size="regular" onClick={() => setVisibleCount(c => c + BATCH_SIZE)}>Show more ({found.length - shown.length})</Button></div>}
    </>;
  }

  // Stage 1: upload the previous and current plan documents, check they're comparable, then compare.
  function CreateView() {
    const check = Core.comparability(request);
    const blocking = check.problems.filter(p => !(p.kind === 'plan' && samePlan));
    const both = Core.canStart(request), ready = both && !uploading && !blocking.length;
    const hasDocs = !!(request.prior.length || request.current.length);
    const aFailed = !!analysis && analysis.result.status === 'cancelled' && analysis.tick >= failAt, aDone = !!analysis && !aFailed && analysis.tick >= doneAt;
    const slot = (bucket: Bucket, title: string, hint2: string) => <UploadStep title={title} hint={hint2} accept={ACCEPT} multiple={false}
      rejected={uploadError?.bucket === bucket ? [{ name: '', reason: uploadError.text, label: 'Not added' }] : []}
      onFiles={f => addFiles(bucket, f)} onRemove={() => { setRequest(r => ({ ...r, [bucket]: [] })); setUploadError(null); setSamePlan(false); }}
      onDismiss={() => setUploadError(null)} onReplace={(_, f) => addFiles(bucket, [f])} onDownload={() => downloadUpload(bucket)}
      files={request[bucket].map(f => ({ name: f.name, size: `${Core.fileSize(f.size)} · ${Core.pageCount(f)} pages` }))} />;
    return <>
      <div className="page-back-bar"><button type="button" className="back-link page-back" onClick={goList}><Icon name="arrowLeft" /><span>Back</span></button></div>
      <div className="page-title-row">
        <div className="page-header"><h1 className="page-title">{retryOf ? 'Reupload documents' : 'New comparison'}</h1></div>
        <div className="actions">
          {analysis ? (aFailed ? <Button variant="primary" size="regular" onClick={() => retryFailed(analysis.result)}>Replace document</Button>
            : aDone ? null
            : <Button variant="secondary" size="regular" onClick={stopAnalysis}>Stop</Button>) : <>
          <Button variant="secondary" size="regular" onClick={() => hasDocs ? setModal({ title: 'Discard these documents?', body: <p>The documents you uploaded will be removed.</p>,
            buttons: [{ label: 'Discard', variant: 'primary', run: () => { closeModal(); goList(); } }, { label: 'Keep them', run: closeModal }] }) : goList()}>Cancel</Button>
          <Button variant="primary" size="regular" disabled={!ready} onClick={() => startAnalysis()}>Compare plans</Button></>}
        </div>
      </div>
      <div className={`up-flow2 ${analysis ? 'is-busy' : ''}`}>
        {retryOf && (() => { const f = records.find(r => r.id === retryOf); return f && <div className="retry-note" role="status"><Icon name="info" solid />
          {f.status === 'cancelled'
            ? <p><strong>Retrying {failedName(f)}.</strong> {f.failure?.doc} couldn't be read and was removed. Add a text-based PDF or DOCX copy, then compare again.</p>
            : <p><strong>Reuploading for {f.planName}.</strong> Replace the document that was wrong, then compare again. This replaces the current changes and comments.</p>}</div>; })()}
        <div className="up-pair">
          {slot('prior', 'Previous plan', 'The older plan year, for example 2025')}
          <span className="up-pair-arrow" aria-hidden="true"><Icon name="arrowRight" /></span>
          {slot('current', 'Current plan', 'The newer plan year, for example 2026')}
        </div>
        {/* Comparability check, once both documents are in. */}
        {!analysis && both && !uploading && (check.problems.length && blocking.length ? (
          <div className="cmp-check cmp-check--bad" role="alert">
            <Icon name="alert" solid />
            <div><strong>These documents can't be compared yet</strong>
              <ul>{check.problems.map(p => <li key={p.kind}>{p.text}
                {p.kind === 'order' && <button type="button" className="text-link" onClick={swapDocs}><Icon name="swap" /> Swap documents</button>}
                {p.kind === 'plan' && <button type="button" className="text-link" onClick={() => setSamePlan(true)}>They're the same plan</button>}</li>)}</ul></div>
          </div>
        ) : (
          <div className="cmp-check cmp-check--ok" role="status">
            <Icon name="checkCircle" solid />
            <div><strong>Ready to compare</strong>
              <p>{check.years[0]} plan ({Core.pageCount(request.prior[0])} pages) with the {check.years[1]} plan ({Core.pageCount(request.current[0])} pages). This takes about a minute.</p></div>
          </div>
        ))}
        {analysis && AnalyzingView()}
      </div>
    </>;
  }

  // The AI works through both documents, one stage at a time.
  function AnalyzingView() {
    if (!analysis) return null;
    const { result: r, tick } = analysis;
    const failed = r.status === 'cancelled' && tick >= failAt, done = !failed && tick >= doneAt;
    const stage = failed ? 0 : Math.min(STAGES.length - 1, Math.floor(tick / TICKS_PER_STAGE));
    const pct = failed ? 8 : Math.round((Math.min(tick, doneAt) / doneAt) * 100);
    return <>
      <section className="an-card an-card--solo" aria-live="polite" aria-busy={!failed && !done}>
        <h2 className="an-title">{failed ? 'Comparison failed' : done ? 'Comparison ready' : 'Comparing the plans'}</h2>
        <div className="an-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress"><span style={{ width: `${pct}%` }} className={failed ? 'is-bad' : ''} /></div>
        <ol className="an-steps">
          {STAGES.map((label, i) => {
            const state = failed && i === 0 ? 'bad' : done || i < stage ? 'done' : i === stage && !failed ? 'on' : 'todo';
            return <li key={label} className={`an-step an-step--${state}`}>
              <span className="an-ico">{state === 'done' ? <Icon name="checkCircle" solid /> : state === 'bad' ? <Icon name="alertCircle" solid /> : state === 'on' ? <Icon name="spinner" className="spinner" /> : null}</span>
              <div><span>{label}</span>
                {state === 'bad' && <p className="an-err">Couldn't read <strong>{r.failure?.doc}</strong>. {r.failure?.reason} Replace it with a text-based PDF or DOCX.</p>}</div>
            </li>;
          })}
        </ol>
      </section>
    </>;
  }

  // After comparing: one page. A summary, then every difference in a table; a row opens its detail.
  function RecordView() {
    if (!record) return ListView();
    if (record.status === 'cancelled') return FailedView();
    const r = record, locked = !!r.submittedAt, list = sorted(Core.changes(r));
    const unchanged = r.provisions.filter(p => p.change === 'unchanged'), all = [...list, ...unchanged], tab = recTab;
    const benefits = list.filter(p => p.effect === 'benefit'), disadvantages = list.filter(p => p.effect === 'disadvantage');
    const startEdit = () => setEdit(Object.fromEntries(all.map(p => [p.id, p.summary])));
    const dirtyEdit = !!edit && all.some(p => edit[p.id] !== undefined && edit[p.id] !== p.summary);
    const cancelEdit = () => dirtyEdit ? setModal({ title: 'Discard your changes?', body: <p>Your edits haven't been saved.</p>,
      buttons: [{ label: 'Keep editing', run: closeModal }, { label: 'Discard', variant: 'primary', run: () => { closeModal(); setEdit(null); } }] }) : setEdit(null);
    const saveEdit = () => {
      if (!edit) return;
      if (list.some(p => !(edit[p.id] ?? p.summary).trim())) { toast('Comments can\'t be empty.', 'error'); return; }
      patchRecord(r.id, x => all.reduce((acc, p) => edit[p.id] !== undefined && edit[p.id] !== p.summary ? Core.updateFinding(acc, p.id, { summary: edit[p.id].trim() }) : acc, x));
      setEdit(null); toast('Comments saved.');
    };
    const changesTable = (rows: Provision[], empty: string) => rows.length ? (
      <div className={`dt ${edit ? 'dt--edit' : ''}`}>
        <div className="dt-head" aria-hidden="true"><span>Change</span><span>{r.priorYear} plan</span><span>{r.currentYear} plan</span><span>Comments</span><span>Impact</span></div>
        <ul className="dt-list" aria-label="Changes">
          {rows.map(p => <li key={p.id} className="dt-row">
            <div className="dt-name"><strong>{p.name}</strong>{p.change !== 'modified' && <span className={`dt-sub dt-sub--${p.change}`}>{CHANGE_LABEL[p.change]}</span>}</div>
            <div className="dt-v dt-v--old">{valueText(p, 'prior')}</div>
            <div className="dt-v dt-v--new">{valueText(p, 'current')}</div>
            <div className="dt-v dt-v--note">
              {edit
                ? <AutoArea aria-label={`${p.name}: comments`} maxLength={1000} placeholder="Add a comment" value={edit[p.id] ?? p.summary} onChange={e => setEdit(d => d && { ...d, [p.id]: e.target.value })} />
                : <span>{p.summary}</span>}
              {(p.sop ?? SOP_BY_ID.get(p.id)) && <button type="button" className="dt-sop" onClick={() => setSopOpen(p)}>Compared under {p.sop ?? SOP_BY_ID.get(p.id)}</button>}</div>
            <div className={`imp imp--${p.effect}`}><i />{EFFECTS[p.effect].label}</div>
          </li>)}
        </ul>
      </div>
    ) : <p className="ov-text">{empty}</p>;
    return <>
      <div className="page-back-bar"><button type="button" className="back-link page-back" onClick={goList}><Icon name="arrowLeft" /><span>Back</span></button></div>
      <div className="page-heading rec-heading">
        <div className="page-header"><h1 className="page-title">{r.planName}</h1></div>
        <div className="actions">{locked
          ? <Button variant="primary" size="regular" icon="download" onClick={() => downloadReport(r)}>Download report</Button>
          : edit ? <>
              <Button variant="secondary" size="regular" onClick={cancelEdit}>Cancel</Button>
              <Button variant="primary" size="regular" disabled={!dirtyEdit} onClick={saveEdit}>Save</Button></>
            : <>
              <Button variant="tertiary" size="regular" icon="upload" onClick={() => reuploadFor(r)}>Reupload</Button>
              <Button variant="secondary" size="regular" disabled={!list.length} onClick={startEdit}>Edit</Button>
              <Button variant="primary" size="regular" onClick={() => setSubmitOpen(true)}>Submit</Button></>}</div>
      </div>
      <p className="rec-summary">{list.length
        ? <>{list.length} {list.length === 1 ? 'change' : 'changes'} from {r.priorYear} to {r.currentYear}. Overall the {r.currentYear} plan is {list.filter(p => p.effect === 'disadvantage').length > list.filter(p => p.effect === 'benefit').length ? 'less' : 'more'} generous for participants: {[['disadvantage', 'worse'], ['benefit', 'better'], ['mixed', 'mixed'], ['neutral', 'neutral']].map(([e, w]) => [list.filter(p => p.effect === e).length, w] as const).filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}`).join(', ')}.</>
        : `No changes between the ${r.priorYear} and ${r.currentYear} plans.`}</p>
      <nav className="rec-tabs" aria-label="Provisions">
        {([['all', 'All', all.length], ['benefits', 'Benefits', benefits.length], ['disadvantages', 'Disadvantages', disadvantages.length], ['differences', 'Differences', list.length]] as const).map(([k, label, n]) =>
          <button key={k} type="button" className={`rec-tab ${tab === k ? 'is-on' : ''}`} aria-current={tab === k ? 'page' : undefined} onClick={() => setRecTab(k)}>{label}<span className="ds-count">{n}</span></button>)}
      </nav>
      {changesTable(tab === 'benefits' ? benefits : tab === 'disadvantages' ? disadvantages : tab === 'differences' ? list : all, tab === 'benefits' ? 'No benefits found.' : tab === 'disadvantages' ? 'No disadvantages found.' : 'No provisions found.')}
    </>;
  }

  function SubmitModal() {
    if (!submitOpen || !record) return null;
    const r = record, list = Core.changes(r);
    const close = () => setSubmitOpen(false);
    return <Modal title="Submit" onClose={close}
      buttons={[{ label: 'Submit', variant: 'primary', run: submitReview }, { label: 'Cancel', run: close }]}>
      <p>You're submitting {list.length} {list.length === 1 ? 'change' : 'changes'} for {r.planName}.</p>
    </Modal>;
  }

  function FailedView() {
    const f = record!;
    return <>
      <div className="page-back-bar"><button type="button" className="back-link page-back" onClick={goList}><Icon name="arrowLeft" /><span>Back</span></button></div>
      <div className="page-heading">
        <div className="page-header"><h1 className="page-title">{failedName(f)} <Badge tone="critical">Failed</Badge></h1></div>
        <div className="actions">
          <Button variant="secondary" size="regular" onClick={() => confirmRemove(f)}>Delete</Button>
          <Button variant="primary" size="regular" onClick={() => retryFailed(f)}>Replace document and retry</Button>
        </div>
      </div>
      <div className="sr-card fc-card" role="alert">
        <span className="fc-icon" aria-hidden="true"><Icon name="alertCircle" solid /></span>
        <div>
          <h2 className="sr-title">The analysis couldn't run</h2>
          <p className="fc-lead"><strong>{f.failure?.doc}</strong> couldn't be read. {f.failure?.reason} Replace it with a text-based PDF or DOCX. The other document is kept.</p>
        </div>
      </div>
    </>;
  }

  const views = { dashboard: ListView, create: CreateView, record: RecordView };
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
        <button type="button" className="rail-item is-active" title="Others · AI Plan Comparison" aria-current="page" onClick={goList}>
          <Icon name="grid" solid /><span>Others</span>
        </button>
      </nav>
    </aside>
    <div className="shell">
      <main id="main" className="main main--flow" tabIndex={-1} ref={mainRef}><div className="flow-content">{content}</div></main>
    </div>
    {SubmitModal()}
    {sopOpen && record && <SopPanel p={sopOpen} rec={record} onClose={() => setSopOpen(null)} />}
    {modal && <Modal title={modal.title} wide={modal.wide} onClose={closeModal}
      buttons={modal.buttons ?? [{ label: 'Got it', variant: 'primary', run: closeModal }]}>{modal.body}</Modal>}
    <TooltipLayer />
    <ToastStack toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
  </>;
}

// SOP rule text, keyed by the rule number a finding cites.
const SOP_RULES: Record<string, { title: string; text: string }> = {
  '1': { title: 'Rule 1 · Document selection', text: 'Current values come from the Adoption and Acceptance Agreement. Pre-filled template values change only for permitted appendices or one-off cases.' },
  '2': { title: 'Rule 2 · Prior values', text: 'Prior values come from takeover documents. Use the latest effective document and any later amendment that supersedes it.' },
  '3': { title: 'Rule 3 · Prior MEP', text: "For a prior MEP, the adopter's participation agreement determines the adopter-specific election. Later applicable amendments take precedence." },
  '7': { title: 'Rule 7 · Comparison comments', text: 'Compare the prior and current provision and state the difference, the affected employees and the practical impact. Missing text is recorded as missing information; it is not treated as a removed benefit.' },
  '8': { title: 'Rule 8 · Benefit-impact categories', text: 'Each difference is placed in a category: non-affecting (8.I), short-term (8.II) or long-term (8.III), depending on who is affected and for how long.' },
  '8.I': { title: 'Rule 8.I · Non-affecting', text: 'A change that applies only to employees hired after the takeover, for example a service requirement moving from 2 to 4 months.' },
  '8.II': { title: 'Rule 8.II · Short-term', text: 'Existing participants keep the prior conditions in the takeover year. The new condition applies to all employees in later years.' },
  '8.III': { title: 'Rule 8.III · Long-term', text: 'Service or benefits already recognised under the predecessor plan stay credited after the takeover.' },
};

// Slide-out with the SOP rules this finding was compared under, and how they applied to it.
function SopPanel({ p, rec, onClose }: { p: Provision; rec: PlanRecord; onClose: () => void }) {
  const sop = p.sop ?? SOP_BY_ID.get(p.id) ?? '';
  const keys = sop.replace(/SOP/gi, '').split(/[\s,]+|and/).filter(Boolean).filter(k => SOP_RULES[k]);
  const doc = (side: Side) => rec.documents[side][0]?.name;
  const where = (side: Side) => { const r = p.refs[side]; return r ? `${r.section}, page ${r.page}` : 'Not found in the document'; };
  return <div className="sop-layer">
    <div className="sop-scrim" onClick={onClose} />
    <aside className="sop-panel" role="dialog" aria-modal="true" aria-labelledby="sop-title">
      <header className="sop-head">
        <h2 id="sop-title">Takeover Review SOP</h2>
        <Button variant="secondary" size="regular" onClick={onClose}>Close</Button>
      </header>
      <div className="sop-body">
        <div className="sop-box">
          <div className="sop-row">
            <div><span>Plan name</span><strong>{rec.planName}</strong></div>
            <div><span>Prior plan</span><strong>{rec.priorProvider} · {rec.priorYear}</strong></div>
            <div><span>Current plan</span><strong>{rec.currentProvider} · {rec.currentYear}</strong></div>
          </div>
          <hr />
          <div className="sop-row">
            <div><span>Provision</span><strong>{p.name}</strong></div>
            <div><span>Impact</span><div className={`imp imp--${p.effect}`}><i />{EFFECTS[p.effect].label}</div></div>
          </div>
        </div>
        <p className="sop-ref">Compared under {sop} · Plan comparison SOP - TA Doc Takeover reviews.docx</p>
        <section>
          <h3>Values and sources</h3>
          <dl>
            <dt>Prior value</dt>
            <dd>{p.prior || 'Not in the previous plan'}<small>{doc('prior') ?? 'Previous plan document'} · {where('prior')}</small></dd>
            <dt>Current value</dt>
            <dd>{p.current || 'Not found in the current plan'}<small>{doc('current') ?? 'Current plan document'} · {where('current')}</small></dd>
          </dl>
        </section>
        <section>
          <h3>How the rules applied</h3>
          {keys.map(k => <div key={k} className="sop-rule"><h4>{SOP_RULES[k].title}</h4><p>{SOP_RULES[k].text}</p></div>)}
          <div className="sop-rule"><h4>Result for this provision</h4><p>{p.why}{p.participants ? ` Affects ${p.participants.charAt(0).toLowerCase()}${p.participants.slice(1)}` : ''}</p></div>
        </section>
      </div>
    </aside>
  </div>;
}

function Guide() {
  return <>
    <p>AI Plan Comparison reads last year's and this year's plan documents so you don't have to. It lists what changed, explains why each change matters, and links every finding to its page.</p>
    <div className="guide-section"><h3>How it works</h3><ol className="guide-list">
      <li><strong>Upload</strong> the previous and current plan (PDF or DOCX). The app checks they're the same plan and in the right order.</li>
      <li><strong>Compare plans.</strong> The AI reads both documents, matches sections and finds new, removed and modified provisions.</li>
      <li><strong>Overview.</strong> See the number of changes, benefits, disadvantages and items that need attention.</li>
      <li><strong>Review each change.</strong> Check the before and after against the source page. Correct anything the AI got wrong, then <strong>Verify</strong> or <strong>Flag</strong> it.</li>
      <li><strong>Submit.</strong> Confirm the declaration. The report records the AI's version, your corrections and who verified each finding.</li>
    </ol></div>
    <div className="guide-section"><h3>Correcting the AI</h3><p>Corrections never overwrite the AI's finding. Select <strong>Show AI version</strong> to compare, or <strong>Reset to AI version</strong> to undo your changes.</p></div>
    <div className="guide-section"><h3>What is simulated</h3><p>Document analysis is simulated: every comparison uses the same sample findings. A file name containing "scan" fails, and one containing "same" finds no changes. Changes are saved in this browser only.</p></div>
  </>;
}
