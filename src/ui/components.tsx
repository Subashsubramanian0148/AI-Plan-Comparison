// React implementations of the "Components UI Kit (Subash)" Figma library.
import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';

/* Button — Figma "Buttons": primary / secondary / tertiary, danger variants, regular/small/xsmall */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'danger-secondary';
  size?: 'regular' | 'small' | 'xsmall';
  icon?: string; iconRight?: string;
};
export function Button({ variant = 'secondary', size = 'small', icon, iconRight, className = '', children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={`ds-btn ds-btn--${variant === 'danger' ? 'primary' : variant === 'danger-secondary' ? 'secondary' : variant} ds-btn--${size} ${icon || iconRight ? 'has-icon' : ''} ${className}`} {...rest}>
      {icon && <Icon name={icon} />}{variant === 'tertiary' ? <span className="ds-btn-label">{children}</span> : children}{iconRight && <Icon name={iconRight} />}
    </button>
  );
}

/* Icon-button */
export function IconButton({ icon, label, dot, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; dot?: boolean }) {
  return (
    <button type="button" className={`ds-icon-btn ${dot ? 'has-dot' : ''} ${className}`} aria-label={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

/* InputText — label + field, optional leading search icon */
/* Dropdown — same field styling as InputText */
export function Select({ label, id, options, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string; id: string; options: [string, string][] }) {
  return (
    <div className="ds-field">
      {label && <label htmlFor={id} className="ds-label">{label}</label>}
      <div className="ds-select-wrap">
        <select id={id} className="ds-input ds-select" {...rest}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <Icon name="chevronDown" solid />
      </div>
    </div>
  );
}

export function InputText({ label, id, icon, required, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; id: string; icon?: string }) {
  return (
    <div className="ds-field">
      {label && <label htmlFor={id} className="ds-label">{label}{required && <span className="ds-required" aria-hidden="true">*</span>}</label>}
      <div className={`ds-input-wrap ${icon ? 'has-icon' : ''}`}>
        {icon && <Icon name={icon} />}
        <input id={id} className="ds-input" {...rest} />
      </div>
    </div>
  );
}

export function TextArea({ className = '', ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`ds-input ds-textarea ${className}`} {...rest} />;
}

/* Badge / Label — semantic status pill */
export function Badge({ tone, children }: { tone: 'success' | 'critical' | 'warning' | 'info' | 'neutral' | 'brand'; children: ReactNode }) {
  return <span className={`ds-badge ds-badge--${tone}`}>{children}</span>;
}
export function CountBadge({ children }: { children: ReactNode }) {
  return <span className="ds-count">{children}</span>;
}

/* Alert / Banner */
export function Alert({ tone = 'info', title, children, className = '' }: { tone?: 'info' | 'warning' | 'critical' | 'success'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const icon = tone === 'info' ? 'info' : tone === 'success' ? 'checkCircle' : 'alertCircle';
  return (
    <div className={`ds-alert ds-alert--${tone} ${className}`} role={tone === 'critical' ? 'alert' : undefined}>
      <Icon name={icon} solid />
      <div className="ds-alert-content">{title && <strong className="ds-alert-title">{title}</strong>}{children && <div className="ds-alert-body">{children}</div>}</div>
    </div>
  );
}

/* Card */
export function Card({ className = '', children, ...rest }: React.HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <section className={`ds-card ${className}`} {...rest}>{children}</section>;
}

/* Avatar */
export function Avatar({ initials, size = 32 }: { initials: string; size?: number }) {
  return <span className="ds-avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>{initials}</span>;
}

/* Pagination (Figma 19:30877) — "1-10 of 37 items  ‹ [page] Of 4 Pages ›" */
export function Pagination({ page, pages, total, pageSize, onChange }: { page: number; pages: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const from = total ? (page - 1) * pageSize + 1 : 0, to = Math.min(page * pageSize, total);
  return (
    <nav className="ds-pagination" aria-label="Pagination">
      <span className="ds-pagination-text">{from}-{to} of {total} items</span>
      <button type="button" className="ds-pagination-arrow" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}><Icon name="chevronLeft" solid /></button>
      <input className="ds-pagination-input" type="number" min={1} max={pages} value={page} aria-label={`Page, of ${pages}`}
        onChange={e => { const n = Number(e.target.value); if (n >= 1 && n <= pages) onChange(n); }} />
      <span className="ds-pagination-text">Of {pages} Pages</span>
      <button type="button" className="ds-pagination-arrow" aria-label="Next page" disabled={page >= pages} onClick={() => onChange(page + 1)}><Icon name="chevronRight" solid /></button>
    </nav>
  );
}

/* File Uploader */
/* Drag & Drop Upload (Figma Components UI Kit 1027:8473) — states: default, focus, disabled, success, error */
export function FileUploader({ title, optional, disabled, accept, multiple, onFiles, error, files, onRemove }: {
  title: string; optional?: boolean; disabled?: boolean; accept: string; multiple?: boolean;
  onFiles: (files: File[], replace?: boolean) => void; error?: string; files: { name: string; size: string }[]; onRemove: (i: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const replacing = useRef(false);
  const browse = () => input.current?.click();
  const status = error ? 'error' : files.length ? 'success' : 'default';
  return (
    <div className={`dd-upload dd-upload--${status} ${disabled && !files.length ? 'is-disabled' : ''}`}>
      <div className="dd-upload-body">
        <div className="dd-upload-info">
          <p className="dd-upload-title">{!optional && <span className="req" aria-hidden="true">*</span>}{title}{optional && <span className="dd-upload-opt"> (Optional)</span>}</p>
          <p className="dd-upload-meta"><span>Accepted file : PDF, DOC, DOCX</span><span>Max File Size : 50 MB</span></p>
        </div>
        {status === 'success' ? (
          <div className="dd-upload-files" aria-live="polite">
            {files.map((f, i) => (
              <div key={f.name + i} className="dd-upload-file">
                <div><div className="dd-upload-file-name"><span>{f.name}</span><span className="dd-upload-size">{f.size}</span></div>
                  {i === files.length - 1 && !disabled && <button type="button" className="dd-upload-link" onClick={() => { replacing.current = true; browse(); }}>Reupload</button>}</div>
                <button type="button" className="dd-upload-trash" aria-label={`Remove ${f.name}`} title="Remove file" onClick={() => onRemove(i)}><Icon name="trash" /></button>
              </div>))}
          </div>
        ) : (
          <div className="dd-upload-zone-wrap">
            <div className={`dd-upload-zone ${over ? 'is-over' : ''}`} role="button" tabIndex={disabled ? -1 : 0} aria-label={`Upload ${title}`} aria-disabled={disabled}
              onClick={() => !disabled && browse()} onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); browse(); } }}
              onDragOver={e => { e.preventDefault(); if (!disabled) setOver(true); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
              onDrop={e => { e.preventDefault(); setOver(false); if (!disabled) onFiles(Array.from(e.dataTransfer?.files || [])); }}>
              <span className="dd-upload-drag"><Icon name="upload" />Drag &amp; Drop here</span>
              <span>or</span>
              <span className="dd-upload-browse">Browse File</span>
            </div>
          </div>
        )}
      </div>
      {status !== 'default' && (
        <div className="dd-upload-assist" role={status === 'error' ? 'alert' : undefined}>
          <Icon name={status === 'error' ? 'alert' : 'checkCircle'} solid />{status === 'error' ? error : 'Document(s) Uploaded Successfully!'}
        </div>
      )}
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} aria-label={title}
        onChange={e => { const picked = Array.from(e.target.files || []); if (picked.length) onFiles(picked, replacing.current); replacing.current = false; e.target.value = ''; }} />
    </div>
  );
}

// Kit Drag & Drop Upload row (Figma 1027:847x): label left, drop zone or uploaded files right, success/error footer.
export type RejectedFile = { name: string; reason: string; label: string };
export function UploadStep({ title, hint, accept, multiple = true, onFiles, files, rejected = [], onRemove, onReplace, onDownload, onDismiss }: {
  step?: string; title: string; hint: string; accept: string; multiple?: boolean;
  onFiles: (files: File[]) => void; files: { name: string; size: string }[]; rejected?: RejectedFile[];
  onRemove: (i: number) => void; onReplace: (i: number, file: File) => void; onDownload: (i: number) => void; onDismiss: () => void;
}) {
  const input = useRef<HTMLInputElement>(null), replaceInput = useRef<HTMLInputElement>(null), replaceIndex = useRef(-1);
  const [over, setOver] = useState(false);
  // Simulated upload: newly added files show a progress card for a moment before they settle.
  const [progress, setProgress] = useState<Record<string, number>>({});
  const seen = useRef(new Set(files.map(f => f.name)));
  useEffect(() => {
    const fresh = files.filter(f => !seen.current.has(f.name)).map(f => f.name);
    files.forEach(f => seen.current.add(f.name));
    if (!fresh.length) return;
    setProgress(p => ({ ...p, ...Object.fromEntries(fresh.map(n => [n, 10])) }));
    const t = setInterval(() => setProgress(p => {
      const next: Record<string, number> = {};
      for (const [n, v] of Object.entries(p)) if (v < 100) next[n] = Math.min(100, v + 30);
      return next;
    }), 250);
    const stop = setTimeout(() => clearInterval(t), 1500);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [files]);
  const uploading = files.some(f => progress[f.name] !== undefined && progress[f.name] < 100);
  const status = rejected.length ? 'error' : files.length && !uploading ? 'success' : 'default';
  const zone = (
    <div className={`up-zone ${over ? 'is-over' : ''}`} role="button" tabIndex={0} aria-label={`Upload ${title}`}
      onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
      onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={e => { e.preventDefault(); setOver(false); onFiles(Array.from(e.dataTransfer?.files || [])); }}>
      <span className="up-drag"><Icon name="upload" />Drag &amp; Drop here</span><span>or</span><span className="up-browse">Browse File</span>
    </div>);
  // Kit Drag & Drop Upload rows: Default (1027:8472) → Success (1027:8471) / Error (1027:8470).
  return (
    <section className={`up-step up-step--${status}`}>
      <div className="up-row">
        <header className="up-step-head" title={hint}>
          <h3 className="up-step-title">{title}</h3>
          <p className="up-step-meta"><span>Accepted file : PDF, DOC, DOCX</span><span>Max File Size : 50 MB</span></p>
        </header>
        <div className="up-row-right">
          {!files.length ? zone : <ul className="up-row-files" aria-live="polite">
            {files.map((f, i) => {
              const pct = progress[f.name];
              return <li key={f.name + i} className="up-row-file">
                <div className="up-row-file-main">
                  <div className="up-row-file-name"><span className="up-card-text" title={f.name}>{f.name}</span>
                    {pct !== undefined && pct < 100 ? <span className="up-row-pct">{pct}%</span> : <span className="up-badge up-badge--count">{f.size}</span>}</div>
                  {pct !== undefined && pct < 100
                    ? <div className="up-track"><span style={{ width: `${pct}%` }} /></div>
                    : <button type="button" className="up-row-link" onClick={() => { replaceIndex.current = i; replaceInput.current?.click(); }}>Reupload</button>}
                </div>
                <span className="up-acts">
                  {(pct === undefined || pct >= 100) && <button type="button" className="up-act" aria-label={`Download ${f.name}`} title="Download" onClick={() => onDownload(i)}><Icon name="download" /></button>}
                  <button type="button" className="up-act" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => onRemove(i)}><Icon name="trash" /></button>
                </span>
              </li>;
            })}
            {multiple && <li><button type="button" className="up-row-link up-row-add" onClick={() => input.current?.click()}><Icon name="plus" />Add more files</button></li>}
          </ul>}
        </div>
      </div>
      {status === 'success' && <div className="up-assist up-assist--success"><Icon name="checkCircle" solid />Document(s) Uploaded Successfully!</div>}
      {status === 'error' && <div className="up-assist up-assist--error" role="alert"><Icon name="alert" solid />{rejected.map(r => `${r.name}: ${r.reason}`).join(' ')}
        <button type="button" className="up-assist-dismiss" aria-label="Dismiss" onClick={onDismiss}><Icon name="close" /></button></div>}
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} aria-label={title}
        onChange={e => { const picked = Array.from(e.target.files || []); if (picked.length) onFiles(picked); e.target.value = ''; }} />
      <input ref={replaceInput} type="file" hidden accept={accept} aria-label={`Replace file in ${title}`}
        onChange={e => { const f = e.target.files?.[0]; if (f && replaceIndex.current >= 0) onReplace(replaceIndex.current, f); e.target.value = ''; }} />
    </section>
  );
}

export function FileItem({ name, meta, onRemove }: { name: string; meta: string; onRemove?: () => void }) {
  return (
    <div className="ds-file-item">
      <Icon name="file" />
      <div className="ds-file-content"><div className="ds-file-name">{name}</div><div className="ds-file-meta">{meta}</div></div>
      {onRemove && <IconButton icon="close" label={`Remove ${name}`} title="Remove file" className="ds-file-remove" onClick={onRemove} />}
    </div>
  );
}

/* Standard Modal */
export type ModalButton = { label: string; variant?: ButtonProps['variant']; run: () => void };
export function Modal({ title, wide, danger, buttons, onClose, children, initialFocus }: {
  title: string; wide?: boolean; danger?: boolean; buttons: ModalButton[]; onClose: () => void; children: ReactNode; initialFocus?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const target = (initialFocus && document.getElementById(initialFocus)) || (ref.current?.querySelector<HTMLElement>('.ds-modal-actions .ds-btn--secondary') ?? ref.current?.querySelector<HTMLElement>('.ds-modal-actions button'));
    target?.focus();
    return () => { document.body.style.overflow = ''; if (prev?.isConnected) prev.focus(); };
  }, [initialFocus]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    if (e.key === 'Tab') {
      const f = Array.from(ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,a[href]'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  return (
    <div className="ds-modal-overlay" onKeyDown={onKeyDown}>
      {/* Kit Modal (Figma 1365:60354): grey icon rail on the left, title + text + actions, close top-right. Primary action comes first. */}
      <section ref={ref} className={`ds-modal kit-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        {!wide && <div className={`kit-modal-rail ${danger ? 'is-danger' : ''}`} aria-hidden="true"><Icon name="alert" /></div>}
        <div className="kit-modal-main">
          <div className="kit-modal-content">
            <h2 id="modal-title" className="kit-modal-title">{title}</h2>
            <div className="kit-modal-body">{children}</div>
            <div className="ds-modal-actions kit-modal-actions">
              {[...buttons].sort((a, b) => (b.variant === 'primary' ? 1 : 0) - (a.variant === 'primary' ? 1 : 0))
                .map(b => <Button key={b.label} size="regular" variant={b.variant || 'secondary'} onClick={b.run}>{b.label}</Button>)}
            </div>
          </div>
          <button type="button" className="kit-modal-close" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button>
        </div>
      </section>
    </div>
  );
}

/* Drawer (slide-out panel) — not in the kit; built from the standard modal's tokens */
export function Drawer({ title, onClose, footer, blocked, children }: { title: string; onClose: () => void; footer: ReactNode; blocked?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => { document.body.style.overflow = ''; if (prev?.isConnected) prev.focus(); };
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (blocked) return;
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    if (e.key === 'Tab') {
      const f = Array.from(ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not([hidden]),textarea,a[href],[tabindex="0"]'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  return (
    <div className="ds-drawer-overlay" onKeyDown={onKeyDown} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <aside ref={ref} tabIndex={-1} className="ds-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div className="ds-drawer-head"><h2 id="drawer-title">{title}</h2>
          <div className="ds-drawer-actions">{footer}</div></div>
        <div className="ds-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

/* Toast (Notifications) */
export type ToastItem = { id: number; message: string; type: 'success' | 'error' };
export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  // Float just below the page's main CTA (slide-out buttons, Submit, New comparison); fall back to under the top bar.
  const [top, setTop] = useState(72);
  useLayoutEffect(() => {
    if (!toasts.length) return;
    const cta = document.querySelector('.ds-drawer-actions') ?? document.querySelector('.page-heading .actions') ?? document.querySelector('.page-title-row > .ds-btn');
    const bottom = cta?.getBoundingClientRect().bottom ?? 0;
    setTop(Math.max(72, Math.round(bottom + 12)));
  }, [toasts.length]);
  return (
    <div className="ds-toast-stack" aria-live="polite" style={{ top }}>
      {toasts.map(t => (
        <div key={t.id} className={`ds-toast ds-toast--${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
          <Icon name={t.type === 'error' ? 'alertCircle' : 'checkCircle'} solid /><span>{t.message}</span>
          <IconButton icon="close" label="Dismiss notification" onClick={() => onDismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}
