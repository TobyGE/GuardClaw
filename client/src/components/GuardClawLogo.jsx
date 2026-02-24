export default function GuardClawLogo({ size = 24, className = '' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width={size} height={size} className={className}>
      <defs>
        <linearGradient id="gc-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#3b82f6' }} />
          <stop offset="100%" style={{ stopColor: '#8b5cf6' }} />
        </linearGradient>
      </defs>
      <path d="M64 8 L112 28 V64 C112 96 88 116 64 124 C40 116 16 96 16 64 V28 Z" fill="url(#gc-grad)" />
      <ellipse cx="64" cy="76" rx="14" ry="12" fill="white" opacity="0.95" />
      <ellipse cx="44" cy="56" rx="9" ry="8" fill="white" opacity="0.95" />
      <ellipse cx="64" cy="48" rx="9" ry="8" fill="white" opacity="0.95" />
      <ellipse cx="84" cy="56" rx="9" ry="8" fill="white" opacity="0.95" />
    </svg>
  );
}
