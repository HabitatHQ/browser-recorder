// Browser Recorder mark: a slate badge with two "pulse" rings radiating from a
// red record dot. Kept in sync with public/icon/icon.svg (the icon source).
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 128 128"
      className={className}
      role="img"
      aria-label="Browser Recorder"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="128" height="128" rx="28" fill="#0f172a" />
      <circle
        cx="64"
        cy="64"
        r="42"
        fill="none"
        stroke="#e2e8f0"
        strokeWidth="8.5"
        opacity="0.28"
      />
      <circle cx="64" cy="64" r="27" fill="none" stroke="#e2e8f0" strokeWidth="9" opacity="0.62" />
      <circle cx="64" cy="64" r="13" fill="#ef4444" />
    </svg>
  );
}
