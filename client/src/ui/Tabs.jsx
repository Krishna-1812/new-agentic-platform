import { useRef, useEffect, useState } from 'react';

/**
 * Tabs
 * @param {'underline'|'segmented'} variant
 * @param {Array} tabs — [{ key, label }]
 * @param {string} active — active tab key
 * @param {function} onChange
 */
export function Tabs({ variant = 'underline', tabs = [], active, onChange }) {
  const containerRef = useRef(null);
  const activeRef = useRef(null);
  const [indicatorStyle, setIndicatorStyle] = useState({});

  useEffect(() => {
    if (variant !== 'underline' || !activeRef.current || !containerRef.current) return;
    const container = containerRef.current.getBoundingClientRect();
    const el = activeRef.current.getBoundingClientRect();
    setIndicatorStyle({
      left: el.left - container.left,
      width: el.width,
    });
  }, [active, variant]);

  if (variant === 'segmented') {
    return (
      <div style={{
        display: 'inline-flex',
        background: 'var(--surface)',
        borderRadius: 'var(--r-lg)',
        padding: 4,
        gap: 2,
      }}>
        {tabs.map(tab => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              onClick={() => onChange?.(tab.key)}
              style={{
                padding: '5px 14px',
                borderRadius: 'var(--r-md)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--text)' : 'var(--text-2)',
                background: isActive ? 'var(--card)' : 'transparent',
                boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                transition: 'background var(--dur) var(--ease), box-shadow var(--dur) var(--ease)',
                outline: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    );
  }

  /* Underline variant */
  return (
    <div style={{ position: 'relative', borderBottom: '1px solid var(--border)' }}>
      <div
        ref={containerRef}
        style={{ display: 'flex', gap: 0 }}
      >
        {tabs.map(tab => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={isActive ? activeRef : null}
              onClick={() => onChange?.(tab.key)}
              style={{
                padding: '10px 16px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--text)' : 'var(--text-2)',
                outline: 'none',
                whiteSpace: 'nowrap',
                transition: 'color var(--dur) var(--ease)',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {/* Sliding indicator */}
      <div style={{
        position: 'absolute',
        bottom: -1,
        height: 2,
        background: 'var(--primary)',
        borderRadius: '2px 2px 0 0',
        transition: 'left var(--dur) var(--ease), width var(--dur) var(--ease)',
        ...indicatorStyle,
      }} />
    </div>
  );
}

export default Tabs;
