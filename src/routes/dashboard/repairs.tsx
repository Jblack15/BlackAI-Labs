import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/repairs")({
  component: RepairsPage,
});

function RepairsPage() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="text-6xl mb-4">🔧</div>
      <h1 className="text-2xl font-bold text-white">Repair Tracking</h1>
      <p className="mt-2 text-slate-400">Coming soon</p>
    </div>
  );
}
