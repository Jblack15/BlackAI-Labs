import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import bcrypt from "bcryptjs";
import { sql } from "~/db";
import { createSessionToken } from "~/auth";

const loginUser = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (typeof data !== "object" || data === null) throw new Error("Invalid data");
    const d = data as Record<string, string>;
    if (!d.email?.trim()) throw new Error("Email is required");
    if (!d.password?.trim()) throw new Error("Password is required");
    return { email: d.email.trim().toLowerCase(), password: d.password };
  })
  .handler(async ({ data }) => {
    const users = await sql`
      SELECT id, email, password_hash, name, shop_name
      FROM users WHERE email = ${data.email}
    `;
    if (users.length === 0) {
      return { success: false as const, error: "Invalid email or password" };
    }

    const user = users[0];
    const valid = await bcrypt.compare(data.password, user.password_hash);
    if (!valid) {
      return { success: false as const, error: "Invalid email or password" };
    }

    const token = createSessionToken(user.id);
    return {
      success: true as const,
      token,
      user: { id: user.id, email: user.email, name: user.name, shop_name: user.shop_name },
    };
  });

export const Route = createFileRoute("/login")({
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password.trim()) {
      setError("Invalid email or password");
      return;
    }

    setLoading(true);
    try {
      const result = await loginUser({ data: { email, password } });
      if (result.success) {
        document.cookie = `auth_token=${result.token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax`;
        navigate({ to: "/dashboard" });
      } else {
        setError(result.error);
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-900 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(249,115,22,0.12),transparent_60%)]" />
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold text-white">
            <span className="bg-gradient-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
              CollisionAI
            </span>
          </h1>
          <p className="mt-2 text-slate-400">Log in to your shop dashboard</p>
        </div>
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-8 shadow-xl backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                placeholder="you@yourshop.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-white placeholder-slate-500 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-white placeholder-slate-500 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-orange-500 px-6 py-3.5 font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:bg-orange-600 hover:shadow-orange-500/40 disabled:opacity-50"
            >
              {loading ? "Logging in..." : "Log In"}
            </button>
          </form>
        </div>
        <p className="mt-6 text-center text-sm text-slate-400">
          Don't have an account?{" "}
          <a href="/signup" className="font-medium text-orange-400 hover:text-orange-300 transition">
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}
