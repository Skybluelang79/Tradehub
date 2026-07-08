import './Button.css';

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  block = false,
  icon = false,
  loading = false,
  disabled = false,
  className = '',
  ...props
}) {
  const classes = [
    'button',
    `button--${variant}`,
    size === 'lg' && 'button--lg',
    size === 'sm' && 'button--sm',
    block && 'button--block',
    icon && 'button--icon',
    loading && 'button--loading',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button className={classes} disabled={disabled || loading} {...props}>
      {children}
    </button>
  );
}
