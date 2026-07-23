import { RoleBadge } from "../../shared/RoleBadge";

export function Board() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 bg-slate-900 text-white">
      <RoleBadge label="/board" />
      <h1 className="text-5xl font-bold">Board</h1>
      <p className="opacity-80">TV projection — placeholder</p>
    </main>
  );
}
