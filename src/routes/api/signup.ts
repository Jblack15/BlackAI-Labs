import bcrypt from "bcryptjs";
import { sql } from "~/db";
import { createSessionToken } from "~/auth";

export async function POST({ request }: { request: Request }) {
  try {
    const body = await request.json();
    const { name, email, password, shopName } = body;

    if (!name?.trim()) return Response.json({ success: false, error: "Name is required" }, { status: 400 });
    if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return Response.json({ success: false, error: "Valid email is required" }, { status: 400 });
    if (!password || password.length < 6)
      return Response.json({ success: false, error: "Password must be at least 6 characters" }, { status: 400 });

    const cleanEmail = email.trim().toLowerCase();

    const existing = await sql`SELECT id FROM users WHERE email = ${cleanEmail}`;
    if (existing.length > 0) {
      return Response.json({ success: false, error: "An account with this email already exists" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await sql`
      INSERT INTO users (email, password_hash, name, shop_name)
      VALUES (${cleanEmail}, ${passwordHash}, ${name.trim()}, ${shopName?.trim() || null})
      RETURNING id, email, name, shop_name
    `;
    const user = result[0];
    const token = createSessionToken(user.id);

    return Response.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.name, shop_name: user.shop_name },
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || "Internal error" }, { status: 500 });
  }
}
