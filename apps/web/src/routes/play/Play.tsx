import { RoleBadge } from "../../shared/RoleBadge";

export function Play() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 bg-emerald-700 text-white">
      <RoleBadge label="/play" />
      <h1 className="text-4xl font-bold">Player</h1>
      <p className="opacity-80">Phone view — placeholder</p>
    </main>
  );
}
