import { useState } from 'react';
import { btnBase, btnVariants } from '../lib/theme';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'danger' | 'ghost';
  style?: React.CSSProperties;
}

export function Button({ variant = 'primary', style, ...props }: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const handleEnter = () => {
    if (!props.disabled) setHovered(true);
  };
  const handleLeave = () => setHovered(false);

  const hover: React.CSSProperties = hovered
    ? { transform: 'translateY(-1px)', opacity: 0.92 }
    : {};

  // Merge order: passed layout first, then base, then variant colors (new palette wins),
  // then hover transform/opacity on top.
  return (
    <button
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{ ...style, ...btnBase, ...btnVariants[variant], ...hover }}
      {...props}
    />
  );
}
