const DOMAIN_COLORS = ['var(--primary)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--info)', 'var(--text-3)'];

export function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString();
}

export function domainLabel(d) {
  return d?.label || d?.domain || '—';
}

export function domainColor(index) {
  return DOMAIN_COLORS[index % DOMAIN_COLORS.length];
}

export function scoreColor(score) {
  if (score >= 70) return 'success';
  if (score >= 40) return 'warning';
  return 'danger';
}
