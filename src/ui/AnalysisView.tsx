import { useEffect, useState } from 'react';
import { Icon } from './Icon';

/* AI thinking sequence shown between "Compare plans" and the review:
   read → understand → connect → converge → result. Each phase is a CSS state on the stage. */
export type AnalysisResult =
  | { ok: true; planName: string; prior: string; current: string; differences: number; missing: number; impacts: number; highlights: string[] }
  | { ok: false; planName: string; reason: string };

const PHASES = [
  { key: 'read', label: 'Reading both plan documents', ms: 1800 },
  { key: 'understand', label: 'Identifying key provisions', ms: 1600 },
  { key: 'connect', label: 'Connecting what changed', ms: 1700 },
  { key: 'converge', label: 'Summarising the impact', ms: 1300 },
  { key: 'result', label: '', ms: 0 },
] as const;
type Phase = typeof PHASES[number]['key'];

// Story-like lines for each document; `k` marks the phrase the AI picks out.
const DOC_LINES: { prior: [string, string?, string?][]; current: [string, string?, string?][] } = {
  prior: [['Employees become eligible after ', '2 months of service', '.'], ['Entry dates fall on the first day of each quarter.'], ['The employer matches ', '100% of the first 4%', ' of pay.'], ['Vesting follows a 3-year cliff schedule.'], ['Participant ', 'loans are available', ' under the loan policy.']],
  current: [['Employees become eligible after ', '4 months of service', '.'], ['Entry dates fall on the first day of each month.'], ['The employer matches ', '50% of the first 6%', ' of pay.'], ['Vesting follows a ', '6-year graded', ' schedule.'], ['No loan provision is stated in this document.']],
};
const NODES = ['Eligibility', 'Employer match', 'Vesting', 'Loans', 'Entry dates', 'Service credit'];

export function AnalysisView({ result, onDone }: { result: AnalysisResult; onDone?: () => void }) {
  // Always plays; with reduced motion the CSS swaps movement for simple fades.
  const [phase, setPhase] = useState<Phase>('read');

  useEffect(() => {
    if (phase === 'result') { onDone?.(); return; }
    const i = PHASES.findIndex(p => p.key === phase);
    const t = setTimeout(() => setPhase(PHASES[i + 1].key), PHASES[i].ms);
    return () => clearTimeout(t);
  }, [phase, onDone]);

  const step = PHASES.findIndex(p => p.key === phase);
  const label = PHASES[step].label;

  return (
    <div className={`ai-stage ai-stage--${phase}`} aria-live="polite">
      {phase !== 'result' && <>
        <div className="ai-status"><span className="ai-pulse" aria-hidden="true" />{label}<span className="ai-dots" aria-hidden="true"><i /><i /><i /></span></div>
        <div className="ai-progress" aria-hidden="true">{PHASES.slice(0, 4).map((p, i) => <span key={p.key} className={i < step ? 'done' : i === step ? 'on' : ''} />)}</div>
      </>}

      <div className="ai-canvas" aria-hidden="true">
        {/* 1–2: the two documents being read, key phrases glow */}
        <div className="ai-docs">
          {(['prior', 'current'] as const).map(side => (
            <div key={side} className={`ai-doc ai-doc--${side}`}>
              <div className="ai-doc-head">{side === 'prior' ? 'Prior plan' : 'Current plan'}</div>
              {DOC_LINES[side].map(([a, k, b], i) => (
                <p key={i} className="ai-line" style={{ animationDelay: `${i * 220 + (side === 'current' ? 110 : 0)}ms` }}>
                  {a}{k && <mark style={{ transitionDelay: `${i * 140}ms` }}>{k}</mark>}{b}
                </p>))}
              <span className="ai-scan" />
            </div>))}
        </div>

        {/* 3–4: extracted provisions become linked nodes, then converge on the core */}
        <div className="ai-graph">
          <svg viewBox="0 0 600 260" className="ai-links">
            {NODES.map((_, i) => { const [x, y] = nodePos(i); return <line key={i} x1={x} y1={y} x2={300} y2={130} style={{ transitionDelay: `${i * 90}ms` }} />; })}
            {NODES.map((_, i) => { const [x1, y1] = nodePos(i), [x2, y2] = nodePos((i + 1) % NODES.length); return <line key={`r${i}`} className="ring" x1={x1} y1={y1} x2={x2} y2={y2} style={{ transitionDelay: `${300 + i * 90}ms` }} />; })}
          </svg>
          {NODES.map((n, i) => { const [x, y] = nodePos(i); return (
            <span key={n} className="ai-node" style={{ left: `${x / 6}%`, top: `${y / 2.6}%`, transitionDelay: `${i * 90}ms` }}>{n}</span>); })}
          <span className="ai-core"><Icon name="compare" /></span>
        </div>
      </div>

      {/* 5: the result */}
      {phase === 'result' && (result.ok ? (
        <section className="ai-result" aria-label="Comparison summary">
          <div className="ai-result-head"><span className="ai-result-icon"><Icon name="checkCircle" solid /></span>
            <div><h2>Comparison ready</h2><p>{result.planName} · {result.prior} to {result.current}</p></div></div>
          <div className="ai-metrics">
            <div><span className="ai-m-num">{result.differences}</span><span className="ai-m-k">Differences</span></div>
            <div><span className="ai-m-num">{result.missing}</span><span className="ai-m-k">Missing</span></div>
            <div><span className="ai-m-num">{result.impacts}</span><span className="ai-m-k">Benefit impacts</span></div>
          </div>
          <div className="ai-highlights"><span className="ai-h-k">Key highlights</span>
            <ul>{result.highlights.map(h => <li key={h}>{h}</li>)}</ul></div>
          <p className="ai-summary">{result.differences} provisions changed{result.missing ? ` and ${result.missing} ${result.missing === 1 ? 'is' : 'are'} missing from the current plan` : ''}{result.impacts ? `; ${result.impacts} affect what participants receive` : ''}. Review each AI comment before you submit.</p>
        </section>
      ) : (
        <section className="ai-result ai-result--error" aria-label="Comparison failed" role="alert">
          <div className="ai-result-head"><span className="ai-result-icon"><Icon name="alertCircle" solid /></span>
            <div><h2>Couldn't finish the comparison</h2><p>{result.planName}</p></div></div>
          <p className="ai-summary">{result.reason}</p>
        </section>
      ))}
    </div>
  );
}

function nodePos(i: number): [number, number] {
  const a = (i / NODES.length) * Math.PI * 2 - Math.PI / 2;
  return [300 + Math.cos(a) * 230, 130 + Math.sin(a) * 100];
}
