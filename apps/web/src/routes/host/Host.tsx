import { RoleBadge } from "../../shared/RoleBadge";

export function Host() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 bg-indigo-700 text-white">
      <RoleBadge label="/host" />
      <h1 className="text-4xl font-bold">Host</h1>
      <p className="opacity-80">Tablet control surface — placeholder</p>
    </main>
  );
}
