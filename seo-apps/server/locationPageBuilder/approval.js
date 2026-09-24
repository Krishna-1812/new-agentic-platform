// ── Approval Workflow / State Machine (Spec §10) ────────────────────────────
// Sequential gates with reject-back. Editing content after a gate clears resets
// that gate and all subsequent gates (handled by resetGatesAfterEdit). Only the
// owning role may stamp its gate; admin overrides are logged.

// Status ladder (Spec §10)
const STATUS = {
  DRAFT: 'Draft',
  KEYWORDS_IN_PROGRESS: 'Keywords In Progress',
  KEYWORDS_FINALIZED: 'Keywords Finalized',
  CONTENT_GENERATED: 'Content Generated',
  SEO_REVIEW: 'SEO Review',
  SEO_APPROVED: 'SEO Approved',
  CLINICAL_REVIEW: 'Clinical Review',
  CLINICAL_APPROVED: 'Clinical Approved',
  CONTENT_REVIEW: 'Content Review',
  CONTENT_APPROVED: 'Content Approved',
  CLIENT_REVIEW: 'Client Review',
  CLIENT_APPROVED: 'Client Approved',
  EXPORTED: 'Exported',
};

// Gate definitions: order, owning role, the status it moves to on approve.
const GATES = ['seo', 'clinical', 'content', 'client'];

const GATE_META = {
  seo:      { role: 'seo',           review: STATUS.SEO_REVIEW,      approved: STATUS.SEO_APPROVED },
  clinical: { role: 'clinical',      review: STATUS.CLINICAL_REVIEW, approved: STATUS.CLINICAL_APPROVED },
  content:  { role: 'content',       review: STATUS.CONTENT_REVIEW,  approved: STATUS.CONTENT_APPROVED },
  client:   { role: 'account_owner', review: STATUS.CLIENT_REVIEW,   approved: STATUS.CLIENT_APPROVED },
};

// Which gates apply to this page (clinical only if YMYL).
function applicableGates(page) {
  const ymyl = page._ymyl ?? page.ymyl ?? true;
  return GATES.filter(g => g !== 'clinical' || ymyl);
}

// Can this role act on this gate? Admin overrides anything (logged by caller).
function canActOn(gate, role) {
  if (role === 'admin') return true;
  return GATE_META[gate]?.role === role;
}

// Approve a gate: validates ordering + QA (for SEO) and returns the next state.
function approveGate(page, gate, { qaBlockingFailures = 0 } = {}) {
  const gates = applicableGates(page);
  if (!gates.includes(gate)) throw new Error(`Gate "${gate}" does not apply to this page.`);

  // Earlier gates must be approved first (sequential).
  const idx = gates.indexOf(gate);
  for (let i = 0; i < idx; i++) {
    if (page.approval_status[gates[i]] !== 'approved') {
      throw new Error(`Cannot approve "${gate}" before "${gates[i]}" is approved.`);
    }
  }
  // SEO gate requires QA clean (Spec §9, §10).
  if (gate === 'seo' && qaBlockingFailures > 0) {
    throw new Error(`SEO gate blocked: ${qaBlockingFailures} QA blocking failure(s) must be resolved first.`);
  }

  const approval_status = { ...page.approval_status, [gate]: 'approved' };
  const allApproved = gates.every(g => approval_status[g] === 'approved');
  const status = allApproved ? STATUS.CLIENT_APPROVED : GATE_META[gate].approved;
  return { approval_status, status };
}

// Reject a gate back to an earlier stage (with comment handled by caller).
function rejectGate(page, gate) {
  const approval_status = { ...page.approval_status, [gate]: 'rejected' };
  return { approval_status, status: GATE_META[gate].review };
}

// Editing content after a gate clears resets that gate and all later gates
// (Spec §10). Returns the reset approval_status + the gates that were reset.
function resetGatesAfterEdit(page) {
  const gates = applicableGates(page);
  const approval_status = { ...page.approval_status };
  const reset = [];
  for (const g of gates) {
    if (approval_status[g] === 'approved' || approval_status[g] === 'rejected') {
      approval_status[g] = 'pending';
      reset.push(g);
    }
  }
  return { approval_status, reset, status: STATUS.CONTENT_GENERATED };
}

// The team to notify when a gate clears (Spec §10).
function nextOwnerAfter(page, gate) {
  const gates = applicableGates(page);
  const idx = gates.indexOf(gate);
  const next = gates[idx + 1];
  return next ? GATE_META[next].role : null;
}

module.exports = {
  STATUS, GATES, GATE_META, applicableGates, canActOn,
  approveGate, rejectGate, resetGatesAfterEdit, nextOwnerAfter,
};
