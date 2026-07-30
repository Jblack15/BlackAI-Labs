import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";

// --- Server Function ---
const submitPpcLead = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const form = data as Record<string, string>;
    const errors: Record<string, string> = {};
    if (!form.full_name?.trim()) errors.full_name = "Name is required";
    if (!form.phone?.trim()) errors.phone = "Phone is required";
    if (!form.property_address?.trim()) errors.property_address = "Address is required";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = "Please enter a valid email";
    }
    if (Object.keys(errors).length > 0) {
      return { valid: false as const, errors };
    }
    return { valid: true as const, data: form };
  })
  .handler(async ({ data }) => {
    try {
      const { sql } = await import("~/db");
      const result = await sql`
        INSERT INTO leads (
          full_name, phone, email,
          property_address, property_city, property_state, property_zip,
          notes, lead_source,
          utm_source, utm_medium, utm_campaign
        ) VALUES (
          ${data.full_name}, ${data.phone || null}, ${data.email || null},
          ${data.property_address}, ${data.property_city || "Unknown"}, ${data.property_state || "TX"}, ${data.property_zip || "00000"},
          ${data.notes || null}, ${'ppc_sell_fast'},
          ${data.utm_source || null}, ${data.utm_medium || null}, ${data.utm_campaign || null}
        )
        RETURNING id, full_name, property_address
      `;
      const lead = result[0] as { id: string; full_name: string; property_address: string } | undefined;
      if (lead) {
        await sql`
          INSERT INTO notifications (type, title, body, lead_id)
          VALUES ('new_lead', ${'PPC Lead: ' + lead.full_name}, ${lead.full_name + ' — ' + lead.property_address}, ${lead.id})
        `;
      }
      return { success: true as const };
    } catch {
      return { success: false as const, error: "Something went wrong. Please try again." };
    }
  });

export const Route = createFileRoute("/sell-fast")({
  head: () => ({
    meta: [
      { title: "Get a Cash Offer for Your House in 24 Hours — DealFlow AI" },
      {
        name: "description",
        content:
          "Need to sell your house fast? Get a fair cash offer within 24 hours. Close in 7 days. No repairs, no fees, no agents. Fill out our quick form now.",
      },
    ],
  }),
  component: SellFastPage,
});

function SellFastPage() {
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    property_address: "",
    utm_source: "",
    utm_medium: "",
    utm_campaign: "",
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setForm((prev) => ({
      ...prev,
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
    }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = await submitPpcLead({ data: form });
      if (result.success) {
        setSubmitted(true);
      } else if ("errors" in result && result.errors) {
        setError(Object.values(result.errors).join(", "));
      } else {
        setError(result.error || "Something went wrong.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-navy-900 px-4 text-center">
        <div className="mx-auto max-w-md">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-500/20">
            <svg className="h-10 w-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white">Thank You!</h1>
          <p className="mt-4 text-lg text-gray-300">
            We received your request. Our team will review your property and get back to you with a cash offer within 24 hours.
          </p>
          <p className="mt-6 text-sm text-gray-500">
            Have questions? Call us at <span className="text-gold-400">(555) 123-4567</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-navy-900">
      {/* Mini Header — Logo + Phone */}
      <div className="border-b border-navy-700 bg-navy-800/95 px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <span className="text-lg font-bold text-white">
            DealFlow<span className="text-gold-500">AI</span>
          </span>
          <a href="tel:+15551234567" className="text-sm font-medium text-gold-400 hover:text-gold-300">
            📞 (555) 123-4567
          </a>
        </div>
      </div>

      {/* Hero + Form Section */}
      <div className="px-4 py-8 sm:py-12">
        <div className="mx-auto max-w-2xl">
          {/* Headline */}
          <h1 className="text-center text-3xl font-bold leading-tight text-white sm:text-4xl">
            Get a Cash Offer for Your House in <span className="text-gold-500">24 Hours</span>
          </h1>
          <p className="mt-4 text-center text-lg text-gray-300">
            No repairs. No agents. No fees. Just a fair cash offer — fast.
          </p>

          {/* Benefits */}
          <div className="mt-8 space-y-3">
            {[
              "Close in as little as 7 days — you pick the date",
              "Sell as-is — we buy homes in any condition",
              "Zero commissions or hidden fees",
              "Fair, data-driven cash offer with no obligation",
              "100+ homes purchased in Texas",
            ].map((benefit, i) => (
              <div key={i} className="flex items-start gap-3">
                <svg className="mt-0.5 h-5 w-5 shrink-0 text-gold-500" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-gray-300">{benefit}</span>
              </div>
            ))}
          </div>

          {/* Mini Form */}
          <div className="mt-8 rounded-xl border border-gold-500/30 bg-navy-800 p-6 shadow-lg shadow-gold-500/5 sm:p-8">
            <h2 className="mb-5 text-center text-xl font-semibold text-white">
              Get Your Free Cash Offer Now
            </h2>

            {error && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center text-sm text-red-400">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="ppc_name" className="mb-1 block text-sm font-medium text-gray-300">
                  Full Name *
                </label>
                <input
                  id="ppc_name"
                  type="text"
                  required
                  value={form.full_name}
                  onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
                  placeholder="John Doe"
                  className="w-full rounded-lg border border-navy-700 bg-navy-900 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <div>
                <label htmlFor="ppc_phone" className="mb-1 block text-sm font-medium text-gray-300">
                  Phone Number *
                </label>
                <input
                  id="ppc_phone"
                  type="tel"
                  required
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="(555) 123-4567"
                  className="w-full rounded-lg border border-navy-700 bg-navy-900 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <div>
                <label htmlFor="ppc_email" className="mb-1 block text-sm font-medium text-gray-300">
                  Email
                </label>
                <input
                  id="ppc_email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="john@example.com"
                  className="w-full rounded-lg border border-navy-700 bg-navy-900 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <div>
                <label htmlFor="ppc_address" className="mb-1 block text-sm font-medium text-gray-300">
                  Property Address *
                </label>
                <input
                  id="ppc_address"
                  type="text"
                  required
                  value={form.property_address}
                  onChange={(e) => setForm((p) => ({ ...p, property_address: e.target.value }))}
                  placeholder="123 Main Street, City, State"
                  className="w-full rounded-lg border border-navy-700 bg-navy-900 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                />
              </div>

              <input type="hidden" name="utm_source" value={form.utm_source} />
              <input type="hidden" name="utm_medium" value={form.utm_medium} />
              <input type="hidden" name="utm_campaign" value={form.utm_campaign} />

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-gold-500 px-6 py-4 text-lg font-bold text-navy-900 transition-all hover:bg-gold-400 hover:shadow-lg hover:shadow-gold-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Submitting..." : "Get My Cash Offer Now →"}
              </button>
            </form>

            <p className="mt-4 text-center text-xs text-gray-500">
              No obligation. 100% free offer. We respect your privacy.
            </p>
          </div>

          {/* Trust Badges */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <span className="rounded bg-gold-500/10 px-2 py-0.5 text-xs font-semibold text-gold-500">BBB</span>
              <span>A+ Rated</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-gold-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>100+ Homes Purchased</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-gold-500" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
              </svg>
              <span>Fair Cash Offers</span>
            </div>
          </div>

          {/* Footer note */}
          <p className="mt-10 text-center text-xs text-gray-600">
            &copy; {new Date().getFullYear()} DealFlow AI. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
