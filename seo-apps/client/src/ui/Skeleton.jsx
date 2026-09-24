/* Skeleton / Loading shimmer */

const shimmerStyle = {
  position: 'relative',
  overflow: 'hidden',
  background: 'var(--surface)',
  borderRadius: 'var(--r-md)',
};

function Shimmer() {
  return (
    <span style={{
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(90deg, transparent 0%, var(--surface-2) 50%, transparent 100%)',
      animation: 'shimmer 1.4s ease-in-out infinite',
    }} />
  );
}

const globalCSS = `@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}`;

function injectShimmer() {
  if (typeof document !== 'undefined' && !document.getElementById('shimmer-keyframes')) {
    const style = document.createElement('style');
    style.id = 'shimmer-keyframes';
    style.textContent = globalCSS;
    document.head.appendChild(style);
  }
}
injectShimmer();

/** Skeleton text line */
export function SkeletonText({ width = '100%', height = 14, style: extra }) {
  return (
    <span style={{ ...shimmerStyle, display: 'block', width, height, ...extra }}>
      <Shimmer />
    </span>
  );
}

/** Skeleton table row */
export function SkeletonRow({ cols = 4 }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 12,
      padding: '10px 16px',
      borderBottom: '1px solid var(--border)',
    }}>
      {Array.from({ length: cols }).map((_, i) => (
        <SkeletonText key={i} height={14} width={i === 0 ? '70%' : '50%'} />
      ))}
    </div>
  );
}

/** Skeleton card */
export function SkeletonCard({ style: extra }) {
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      ...extra,
    }}>
      <SkeletonText height={11} width="40%" />
      <SkeletonText height={28} width="60%" />
      <SkeletonText height={13} width="80%" />
    </div>
  );
}

/** Skeleton metric tile */
export function SkeletonMetric() {
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <SkeletonText height={11} width="50%" />
      <SkeletonText height={32} width="40%" />
    </div>
  );
}

export default SkeletonText;
