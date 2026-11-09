// Font Awesome 6 Pro (Light), as used by the Figma UI kit.
// Pro loads from a kit when VITE_FA_KIT is set; otherwise the free FA6 set is used as a fallback.
const HAS_PRO = !!import.meta.env.VITE_FA_KIT;

// key → [Pro Light name, free fallback name]
const icons: Record<string, [string, string]> = {
  folder: ['folder', 'folder'], compare: ['code-compare', 'code-compare'], plus: ['plus', 'plus'],
  help: ['circle-question', 'circle-question'], chevronDown: ['angle-down', 'angle-down'],
  chevronRight: ['angle-right', 'angle-right'], chevronLeft: ['angle-left', 'angle-left'],
  arrowRight: ['arrow-right', 'arrow-right'], arrowLeft: ['arrow-left', 'arrow-left'],
  search: ['magnifying-glass', 'magnifying-glass'], filter: ['bars-filter', 'filter'], download: ['download', 'download'], redo: ['rotate-right', 'rotate-right'], reset: ['arrow-rotate-right', 'arrow-rotate-right'], sort: ['sort', 'sort'], sortUp: ['sort-up', 'sort-up'], sortDown: ['sort-down', 'sort-down'],
  notes: ['message-lines', 'message'], file: ['file-lines', 'file-lines'],
  check: ['check', 'check'], circle: ['circle', 'circle'], checkCircle: ['circle-check', 'circle-check'], alertCircle: ['circle-exclamation', 'circle-exclamation'], calendar: ['calendar-day', 'calendar-day'], trash: ['trash-can', 'trash-can'], upload: ['arrow-up-from-bracket', 'arrow-up-from-bracket'], close: ['xmark', 'xmark'], info: ['circle-info', 'circle-info'], shield: ['shield-check', 'shield'],
  sparkles: ['sparkles', 'wand-magic-sparkles'], alert: ['triangle-exclamation', 'triangle-exclamation'],
  edit: ['pen', 'pen'], list: ['list-check', 'list-check'], view: ['eye', 'eye'], save: ['floppy-disk', 'floppy-disk'], menu: ['bars', 'bars'], spinner: ['spinner-third', 'spinner'],
  bell: ['bell', 'bell'], gauge: ['gauge-min', 'gauge'], payroll: ['file-invoice', 'file-invoice'], user: ['user', 'user'],
  flag: ['flag', 'flag'], up: ['arrow-trend-up', 'arrow-trend-up'], down: ['arrow-trend-down', 'arrow-trend-down'], mixed: ['arrows-up-down', 'arrows-up-down'],
  minus: ['minus', 'minus'], swap: ['arrow-right-arrow-left', 'arrow-right-arrow-left'], undo: ['arrow-rotate-left', 'arrow-rotate-left'],
  wrench: ['wrench', 'wrench'], transfer: ['right-left', 'right-left'], grid: ['grid-horizontal', 'table-cells'],
};

export function Icon({ name, className = '', solid }: { name: string; className?: string; solid?: boolean }) {
  const [pro, free] = icons[name] ?? icons.file;
  const cls = HAS_PRO ? `fa-${solid ? 'solid' : 'light'} fa-${pro}` : `fa-solid fa-${free}`;
  return <i className={`icon ${cls} ${className}`} aria-hidden="true" />;
}
