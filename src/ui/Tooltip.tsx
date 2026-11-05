import { useEffect, useState } from 'react';

// Replaces native `title` tooltips app-wide with one styled bubble that always sits above its target.
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    const show = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[title], [data-tip]') as HTMLElement | null;
      if (!el || el === target) return;
      if (el.hasAttribute('title')) { el.dataset.tip = el.getAttribute('title') || ''; el.removeAttribute('title'); }
      const text = el.dataset.tip;
      if (!text) return;
      target = el;
      const r = el.getBoundingClientRect();
      setTip({ text, x: r.left + r.width / 2, y: r.top });
    };
    const hide = (e: Event) => {
      if (!target) return;
      const next = (e as MouseEvent | FocusEvent).relatedTarget as Node | null;
      if (next && target.contains(next)) return;
      target = null; setTip(null);
    };
    const clear = () => { target = null; setTip(null); };
    // Disabled buttons swallow mouseout, and a page change can remove the target: drop the bubble if its target is gone or no longer hovered.
    const watch = setInterval(() => { if (target && (!document.contains(target) || !(target.matches(':hover') || target.contains(document.activeElement)))) clear(); }, 250);
    document.addEventListener('mouseover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('mouseout', hide);
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', clear, true);
    document.addEventListener('mousedown', clear);
    return () => {
      clearInterval(watch);
      document.removeEventListener('mouseover', show);
      document.removeEventListener('focusin', show);
      document.removeEventListener('mouseout', hide);
      document.removeEventListener('focusout', hide);
      window.removeEventListener('scroll', clear, true);
      document.removeEventListener('mousedown', clear);
    };
  }, []);

  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 136), window.innerWidth - 136);
  return <div className="tooltip-top" role="tooltip" style={{ left, top: tip.y }}>{tip.text}</div>;
}
