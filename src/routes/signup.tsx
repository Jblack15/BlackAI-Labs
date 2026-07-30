import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { sql } from "~/db";
import { createSessionToken } from "~/auth";

const signupUser = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (typeof data !== "object" || data === null) throw new Error("Invalid data");
    const d = data as Record<string, string>;
    if (!d.name?.trim()) throw new Error("Name is required");
    if (!d.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email))
      throw new Error("Valid email is required");
    if (!d.password || d.password.length < 6)
      throw new Error("Password must be at least 6 characters");
    return {
      name: d.name.trim(),
      email: d.email.trim().toLowerCase(),
      password: d.password,
      shopName: (d.shopName || "").trim(),
    };
  })
  .handler(async ({ data }) => {
    // Check for duplicate email
    const existing = await sql`SELECT id FROM users WHERE email = ${data.email}`;
    if (existing.length > 0) {
      return { success: false as const, error: "An account with this email already exists" };
    }

    const passwordHash = await Bun.password.hash(data.password);
    const result = await sql`
      INSERT INTO users (email, password_hash, name, shop_name)
      VALUES (${data.email}, ${passwordHash}, ${data.name}, ${data.shopName || null})
      RETURNING id, email, name, shop_name
    `;
    const user = result[0];
    const token = createSessionToken(user.id);

    return {
      success: true as const,
      token,
      user: { id: user.id, email: user.email, name: user.name, shop_name: user.shop_name },
    };
  });

export const Route = createFileRoute("/signup")({
  component: Signup,
});

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function Signup() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [shopName, setShopName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!name.trim()) newErrors.name = "Name is required";
    if (!email.trim() || !isValidEmail(email)) newErrors.email = "Valid email is required";
    if (!password || password.length < 6) newErrors.password = "Password must be at least 6 characters";

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setLoading(true);
    try {
      const result = await signupUser({ data: { name, email, shopName, password } });
      if (result.success) {
        // Set auth cookie (client-side for navigation)
        document.cookie = `auth_token=${result.token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax`;
        navigate({ to: "/dashboard" });
      } else {
        setErrors({ email: result.error });
      }
    } catch (err: any) {
      setErrors({ email: err.message || "Something went wrong" });
    } finally {
      setLoading(false);
    }
  };

  const fieldError = (field: string) =>
    errors[field] ? <p className="text-sm text-red-400 mt-1">{errors[field]}</p> : null;

  return (
    <div className="min-h-dvh bg-slate-900 flex items-center justify-center px-4 py-12">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(249,115,22,0.12),transparent_60%)]" />
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold text-white">
            <span className="bg-gradient-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
              CollisionAI
            </span>
          </h1>
          <p className="mt-2 text-slate-400">Create your shop account</p>
        </div>
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-8 shadow-xl backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-1.5">
                Your Name
              </label>
              <input
                id="name"
                type="text"
                required
                placeholder="John Smith"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-white placeholder-slate-500 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30"
              />
              {fieldError("name")}
            </div>
            <div>
              <label htmlFor="shopName" className="block text-sm font-medium text-slate-300 mb-1.5">
                Shop Name
              </label>
              <input
                id="shopName"
                type="text"
                placeholder="Smith Auto Body"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-white placeholder-slate-500 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30"
              />
            </div>
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
              {fieldError("email")}
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-white placeholder-slate-500 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30"
              />
              {fieldError("password")}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-orange-500 px-6 py-3.5 font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:bg-orange-600 hover:shadow-orange-500/40 disabled:opacity-50"
            >
              {loading ? "Creating Account..." : "Create Account"}
            </button>
          </form>
        </div>
        <p className="mt-6 text-center text-sm text-slate-400">
          Already have an account?{" "}
          <a href="/login" className="font-medium text-orange-400 hover:text-orange-300 transition">
            Log in
          </a>
        </p>
      </div>
    </div>
  );
}
