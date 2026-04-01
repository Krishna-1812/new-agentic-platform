export default function KBStatusBadge({ health, size = 'sm' }) {
  const base = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-1';
  if (health === 'ERROR')   return <span className={`inline-flex items-center gap-1 rounded font-semibold ${base} bg-red-50 text-red-600`}>● ERROR</span>;
  if (health === 'WARNING') return <span className={`inline-flex items-center gap-1 rounded font-semibold ${base} bg-yellow-50 text-yellow-700`}>● WARNING</span>;
  if (health === 'INFO')    return <span className={`inline-flex items-center gap-1 rounded font-semibold ${base} bg-blue-50 text-blue-600`}>● INFO</span>;
  return <span className={`inline-flex items-center gap-1 rounded font-semibold ${base} bg-[#D1FAE5] text-[#065F46]`}>● OK</span>;
}
