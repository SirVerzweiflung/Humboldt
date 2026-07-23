// Shared UI element. Trivial for now — a small pill showing which client you're on.
// Lives here so all three routes import the same component (no drift).

type RoleBadgeProps = {
  label: string;
};

export function RoleBadge({ label }: RoleBadgeProps) {
  return (
    <span className="rounded-full bg-white/20 px-4 py-1 text-sm font-semibold uppercase tracking-wide">
      {label}
    </span>
  );
}
