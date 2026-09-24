/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg:          'var(--bg)',
        surface:     'var(--surface)',
        'surface-2': 'var(--surface-2)',
        card:        'var(--card)',
        brand: {
          DEFAULT: 'var(--primary)',
          hover:   'var(--primary-hover)',
          press:   'var(--primary-press)',
          soft:    'var(--primary-soft)',
          text:    'var(--primary-text)',
        },
        accent:        'var(--accent)',
        success:       'var(--success)',
        'success-soft':'var(--success-soft)',
        warning:       'var(--warning)',
        'warning-soft':'var(--warning-soft)',
        danger:        'var(--danger)',
        'danger-soft': 'var(--danger-soft)',
        info:          'var(--info)',
        'info-soft':   'var(--info-soft)',
      },
      borderColor: {
        DEFAULT: 'var(--border)',
        default: 'var(--border)',
        strong:  'var(--border-strong)',
      },
      textColor: {
        primary:   'var(--text)',
        secondary: 'var(--text-2)',
        muted:     'var(--text-3)',
        brand:     'var(--primary-text)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm:  '6px',
        md:  '8px',
        lg:  '12px',
        xl:  '16px',
        pill:'999px',
      },
      boxShadow: {
        sm:    'var(--shadow-sm)',
        md:    'var(--shadow-md)',
        lg:    'var(--shadow-lg)',
        focus: 'var(--shadow-focus)',
      },
      transitionTimingFunction: {
        brand: 'cubic-bezier(0.2,0.6,0.2,1)',
      },
    },
  },
  plugins: [],
}
