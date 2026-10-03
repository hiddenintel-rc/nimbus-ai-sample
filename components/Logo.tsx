/**
 * Cloud mark + "Nimbus" wordmark, stacked. Uses currentColor so it follows
 * the same light/dark text color as everything else — renders white in the
 * app's default dark mode, but doesn't disappear if someone's in light mode.
 */
export default function Logo() {
  return (
    <div className="flex flex-col items-center gap-0.5 text-black dark:text-zinc-50">
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      </svg>
      <span
        className="font-[family-name:var(--font-baloo)] text-base font-semibold leading-none tracking-tight"
      >
        Nimbus
      </span>
    </div>
  );
}
