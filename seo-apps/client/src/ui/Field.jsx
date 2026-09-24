import { useState } from 'react';

/**
 * Field — labeled input/textarea/select wrapper
 * @param {string} label
 * @param {string} helper — helper text below control
 * @param {string} error — error text (replaces helper, sets error state)
 * @param {'input'|'textarea'|'select'} as
 * @param {React.ReactNode} leadingIcon — 16px icon inside left of input
 * @param {React.ReactNode} trailing — trailing content (text, icon)
 * @param {boolean} required
 */
export function Field({
  label,
  helper,
  error,
  as: Tag = 'input',
  leadingIcon,
  trailing,
  required,
  style: extraStyle,
  children,
  ...inputProps
}) {
  const [focused, setFocused] = useState(false);
  const hasError = Boolean(error);

  const controlStyle = {
    width: '100%',
    height: Tag === 'textarea' ? undefined : 36,
    background: 'var(--card)',
    border: `1px solid ${hasError ? 'var(--danger)' : focused ? 'var(--primary)' : 'var(--border-strong)'}`,
    borderRadius: 'var(--r-md)',
    padding: leadingIcon ? '0 12px 0 36px' : trailing ? '0 36px 0 12px' : '0 12px',
    paddingTop: Tag === 'textarea' ? 8 : undefined,
    paddingBottom: Tag === 'textarea' ? 8 : undefined,
    fontSize: 14,
    color: 'var(--text)',
    outline: 'none',
    boxShadow: focused ? 'var(--shadow-focus)' : 'none',
    transition: 'border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)',
    resize: Tag === 'textarea' ? 'vertical' : undefined,
    fontFamily: 'var(--font-sans)',
    boxSizing: 'border-box',
    ...extraStyle,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && (
        <label style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--text-2)',
          lineHeight: '16px',
          display: 'flex',
          gap: 4,
        }}>
          {label}
          {required && <span style={{ color: 'var(--danger)' }}>*</span>}
        </label>
      )}

      <div style={{ position: 'relative', display: 'flex', alignItems: Tag === 'textarea' ? 'flex-start' : 'center' }}>
        {leadingIcon && (
          <span style={{
            position: 'absolute',
            left: 10,
            top: Tag === 'textarea' ? 10 : '50%',
            transform: Tag === 'textarea' ? 'none' : 'translateY(-50%)',
            color: 'var(--text-3)',
            display: 'flex',
            alignItems: 'center',
            pointerEvents: 'none',
          }}>
            {leadingIcon}
          </span>
        )}

        {Tag === 'select' ? (
          <select
            style={controlStyle}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            {...inputProps}
          >
            {children}
          </select>
        ) : (
          <Tag
            style={controlStyle}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            {...inputProps}
          />
        )}

        {trailing && (
          <span style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-3)',
            display: 'flex',
            alignItems: 'center',
          }}>
            {trailing}
          </span>
        )}
      </div>

      {(error || helper) && (
        <div style={{
          fontSize: 12,
          color: hasError ? 'var(--danger)' : 'var(--text-3)',
          lineHeight: '16px',
        }}>
          {error || helper}
        </div>
      )}
    </div>
  );
}

export default Field;
