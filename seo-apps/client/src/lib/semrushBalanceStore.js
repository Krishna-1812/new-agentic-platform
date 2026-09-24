// Tiny pub-sub so the header badge and any tool page that spends Semrush
// units can share one balance value without a full context/provider.
import { semrush } from './semrushApi';

let state = { balance: null, loading: false, error: null };
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn(state));
}

export function subscribeSemrushBalance(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export async function refreshSemrushBalance() {
  state = { ...state, loading: true };
  emit();
  try {
    const { balance } = await semrush.balance();
    state = { balance, loading: false, error: null };
  } catch (err) {
    state = { ...state, loading: false, error: err.message };
  }
  emit();
  return state;
}
