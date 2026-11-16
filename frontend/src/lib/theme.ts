export const colors = {
  // fondo - page background
  background: '#15042D',
  // superficie - cards / surfaces
  surface: '#1a0b3d',
  // texto - body text
  text: '#C6B9DE',
  // principal - primary brand color
  primary: '#7238C3',
  // acento - accent / success color
  accent: '#ACE4AA',
  // borde - borders
  border: 'rgba(114, 56, 195, 0.35)',
  // semantic helpers
  success: '#ACE4AA',
  error: '#fca5a5',
  errorBg: '#450a0a',
  errorBorder: '#7f1d1d',
  muted: '#94a3b8',
} as const;

export const btnBase = {
  border: 'none',
  borderRadius: 8,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'transform 0.15s, opacity 0.15s',
} as const;

export const btnVariants: Record<string, React.CSSProperties> = {
  primary: { background: colors.primary, color: '#ffffff' },
  outline: {
    background: 'transparent',
    color: colors.primary,
    border: `1px solid ${colors.border}`,
  },
  danger: { background: colors.error, color: colors.errorBg },
  ghost: { background: 'transparent', color: colors.muted },
} as const;
