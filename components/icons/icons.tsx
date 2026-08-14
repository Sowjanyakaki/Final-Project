interface IconProps {
  className?: string;
}

const BASE_PROPS = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function HeartIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  );
}

export function BedIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6" />
      <path d="M3 18v2" />
      <path d="M21 18v2" />
      <path d="M3 12V8a2 2 0 0 1 2-2h4v4" />
    </svg>
  );
}

export function SqftIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h4" />
      <path d="M9 3v4" />
    </svg>
  );
}

export function MicIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

export function HouseIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M3 11 12 3l9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

export function PersonIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
