// ── Directional dollar model (V2 Phase 2, client-side only) ───────────────────
// Turns the abstract index into figures a leader recognizes. Every output is a
// DIRECTIONAL FLOOR — it counts only searchers who typed the city name, so true
// demand is a multiple of this. Assumptions are editable and persisted per service.
// No provider calls: pure arithmetic on the /compare response.

export const ASSUMPTION_DEFS = [
  { key: 'searchToInquiry',  label: 'Search → inquiry rate', kind: 'pct',   default: 0.03, hint: 'Share of city-tagged searches that become an inquiry to someone.' },
  { key: 'inquiryToPatient', label: 'Inquiry → patient rate', kind: 'pct',  default: 0.30, hint: 'Booked / converted share of inquiries.' },
  { key: 'capturableShare',  label: 'Capturable share',       kind: 'pct',  default: 0.10, hint: "Share of the market's inquiries a new entrant could realistically win." },
  { key: 'revenuePerPatient', label: 'Revenue per patient',   kind: 'money', default: 3500, hint: 'Average case value — set to your own economics (no vertical default is assumed).' },
  { key: 'paidCtrShare',     label: 'Paid-click share',       kind: 'pct',   default: 0.15, hint: 'Share of searches that click a paid ad — used only for the SEM budget estimate.' },
];

export const ASSUMPTION_DEFAULTS = Object.fromEntries(ASSUMPTION_DEFS.map((d) => [d.key, d.default]));

const keyFor = (serviceId) => `marketPotential_assumptions_${serviceId || 'default'}`;

export function loadAssumptions(serviceId) {
  try {
    const a = JSON.parse(localStorage.getItem(keyFor(serviceId)) || 'null');
    if (a && typeof a === 'object') return { ...ASSUMPTION_DEFAULTS, ...a };
  } catch { /* ignore */ }
  return { ...ASSUMPTION_DEFAULTS };
}

export function saveAssumptions(serviceId, a) {
  try { localStorage.setItem(keyFor(serviceId), JSON.stringify(a)); } catch { /* ignore */ }
}

// Per-row directional figures. `searches` = estMonthlySearches (city-tagged floor).
export function computeDollars(row, a) {
  const searches = row.estMonthlySearches || 0;
  const estMonthlyInquiries = searches * a.searchToInquiry;
  const estMonthlyPatients = estMonthlyInquiries * a.inquiryToPatient * a.capturableShare;
  const estAnnualRevenue = estMonthlyPatients * a.revenuePerPatient * 12;
  const estMonthlySemBudget = searches * a.paidCtrShare * (row.medianCpc || 0);
  return { searches, estMonthlyInquiries, estMonthlyPatients, estAnnualRevenue, estMonthlySemBudget };
}

// Human-readable arithmetic string (visible math builds trust, §3.2).
export function inquiriesMath(row, a) {
  const s = Math.round(row.estMonthlySearches || 0).toLocaleString();
  return `${s} searches × ${Math.round(a.searchToInquiry * 100)}% × ${Math.round(a.inquiryToPatient * 100)}% × ${Math.round(a.capturableShare * 100)}% capturable`;
}

export const money = (n) => {
  if (n == null) return '—';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};
export const moneyExact = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);
