export function BrowserLogo({ className = "browser-logo", size }: { className?: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 40 40"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill="#151814" height="39" rx="11" width="39" x="0.5" y="0.5" />
      <rect height="39" rx="11" stroke="#3B4536" width="39" x="0.5" y="0.5" />
      <path d="M10 13H30" stroke="#C8FF58" strokeLinecap="round" strokeWidth="2" />
      <circle cx="13" cy="9" fill="#C8FF58" r="1.4" />
      <circle cx="18" cy="9" fill="#C8FF58" opacity="0.55" r="1.4" />
      <path d="M10.5 27.5L16.8 20.8L22 25.7L29.5 16.8" stroke="#F0F1E8" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
      <circle cx="29.5" cy="16.8" fill="#C8FF58" r="2" />
    </svg>
  );
}
