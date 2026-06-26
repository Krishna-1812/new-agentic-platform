import { useEffect, useRef, useState } from 'react';

function getBandColor(score) {
  if (score >= 70) return 'var(--success)';
  if (score >= 45) return 'var(--warning)';
  return 'var(--danger)';
}

/**
 * ScoreRing — SVG donut with animated fill
 * @param {number} score — 0-100
 * @param {64|80|120} size
 * @param {string} label — optional small label below number
 */
export function ScoreRing({ score = 0, size = 80, label }) {
  const [animated, setAnimated] = useState(0);
  const ref = useRef(null);

  const strokeWidth = size <= 64 ? 6 : 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = getBandColor(score);

  useEffect(() => {
    const timeout = setTimeout(() => setAnimated(score), 50);
    return () => clearTimeout(timeout);
  }, [score]);

  const offset = circumference - (animated / 100) * circumference;

  return (
    <div style={{
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4,
    }}>
      <svg
        width={size}
        height={size}
        style={{ transform: 'rotate(-90deg)' }}
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={strokeWidth}
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 600ms var(--ease)' }}
        />
        {/* Center text — undo rotation */}
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            transform: `rotate(90deg)`,
            transformOrigin: `${size / 2}px ${size / 2}px`,
            fontSize: size <= 64 ? 16 : size <= 80 ? 20 : 28,
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fill: color,
          }}
        >
          {Math.round(score)}
        </text>
      </svg>
      {label && (
        <span style={{
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-3)',
        }}>
          {label}
        </span>
      )}
    </div>
  );
}

export default ScoreRing;
