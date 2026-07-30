import { createFileRoute, Outlet, redirect, useNavigate, useRouteContext } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { sql } from "~/db";
import { getSessionFromRequest } from "~/auth";
import { getStartContext } from "@tanstack/start-storage-context";

// Server function to get current user from session cookie
const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const startCtx = getStartContext();
    if (!startCtx?.request) return null;
    const session = getSessionFromRequest(startCtx.request);
    if (!session) return null;
    const users = await sql`SELECT id, email, name, shop_name FROM users WHERE id = ${session.userId}`;
    return users[0] ? { id: users[0].id, email: users[0].email, name: users[0].name, shop_name: users[0].shop_name } : null;
  } catch {
    return null;
  }
});

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    let user = null;
    try {
      user = await getCurrentUser();
    } catch {
      // If server function fails, user stays null
    }
    if (!user) {
      throw redirect({ to: "/login" });
    }
    return { user };
  },
  component: DashboardLayout,
});

const navItems = [
  { emoji: "📊", label: "Overview", to: "/dashboard" },
  { emoji: "💬", label: "AI Chatbot", to: "/dashboard/chatbot" },
  { emoji: "📋", label: "Estimate Explainer", to: "/dashboard/estimate-explainer" },
  { emoji: "📅", label: "Appointments", to: "/dashboard/appointments" },
  { emoji: "🔧", label: "Repair Tracking", to: "/dashboard/repairs" },
  { emoji: "⭐", label: "Reviews", to: "/dashboard/reviews" },
  { emoji: "📈", label: "Marketing", to: "/dashboard/marketing" },
  { emoji: "⚙️", label: "Settings", to: "/dashboard/settings" },
];

function DashboardLayout() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useRouteContext({ from: "/dashboard" });

  const shopName = user?.shop_name || "Your Shop";
  const userInitials = user?.name
    ? user.name
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "SO";

  const handleLogout = () => {
    // Clear the auth cookie
    document.cookie = "auth_token=; Path=/; Max-Age=0; SameSite=Lax";
    navigate({ to: "/" });
  };

  const currentPath =
    typeof window !== "undefined" ? window.location.pathname : "/dashboard";

  return (
    <div className="min-h-dvh bg-slate-900 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-slate-800 border-r border-slate-700 flex flex-col transform transition-transform duration-200 lg:relative lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <a href="/" className="text-lg font-extrabold text-white">
            <span className="bg-gradient-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
              CollisionAI
            </span>
          </a>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-slate-400 hover:text-white"
            aria-label="Close sidebar"
          >
            ✕
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive =
              item.to === "/dashboard"
                ? currentPath === "/dashboard"
                : currentPath.startsWith(item.to);
            return (
              <a
                key={item.to}
                href={item.to}
                onClick={(e) => {
                  e.preventDefault();
                  setSidebarOpen(false);
                  navigate({ to: item.to });
                }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  isActive
                    ? "bg-orange-500/10 text-orange-400 border border-orange-500/20"
                    : "text-slate-300 hover:bg-slate-700/50 hover:text-white"
                }`}
              >
                <span className="text-lg">{item.emoji}</span>
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-slate-700">
          <div className="text-xs text-slate-500 text-center">© 2026 CollisionAI</div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-slate-800/80 backdrop-blur-sm border-b border-slate-700">
          <div className="flex items-center justify-between px-4 sm:px-6 py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden text-slate-300 hover:text-white p-1"
                aria-label="Open sidebar"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <span className="text-white font-semibold text-sm sm:text-base truncate">
                {shopName}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-orange-500 flex items-center justify-center text-white text-sm font-bold">
                  {userInitials}
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="text-sm text-slate-400 hover:text-white transition"
              >
                Logout
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
