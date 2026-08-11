import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";

// --- Server Function ---
const submitLead = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const form = data as Record<string, string>;
    const errors: Record<string, string> = {};

    if (!form.full_name?.trim()) errors.full_name = "Full name is required";
    if (!form.property_address?.trim()) errors.property_address = "Property address is required";
    if (!form.property_city?.trim()) errors.property_city = "City is required";
    if (!form.property_state?.trim()) errors.property_state = "State is required";
    if (!form.property_zip?.trim()) errors.property_zip = "ZIP code is required";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = "Please enter a valid email address";
    }
    if (form.phone && !/^[\d\s()+\-.]{7,}$/.test(form.phone)) {
      errors.phone = "Please enter a valid phone number";
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
          full_name, email, phone,
          property_address, property_city, property_state, property_zip,
          property_type, property_condition, estimated_repairs,
          reason_for_selling, desired_timeline, mortgage_status,
          notes, lead_source,
          utm_source, utm_medium, utm_campaign
        ) VALUES (
          ${data.full_name}, ${data.email || null}, ${data.phone || null},
          ${data.property_address}, ${data.property_city}, ${data.property_state}, ${data.property_zip},
          ${data.property_type || null}, ${data.property_condition || null}, ${data.estimated_repairs || null},
          ${data.reason_for_selling || null}, ${data.desired_timeline || null}, ${data.mortgage_status || null},
          ${data.notes || null}, ${data.lead_source || null},
          ${data.utm_source || null}, ${data.utm_medium || null}, ${data.utm_campaign || null}
        )
        RETURNING id, full_name, phone, property_address, property_city, property_state
      `;

      // Insert notification for the new lead
      const lead = result[0] as { id: string; full_name: string; phone: string | null; property_address: string; property_city: string; property_state: string } | undefined;
      if (lead) {
        await sql`
          INSERT INTO notifications (type, title, body, lead_id)
          VALUES (
            'new_lead',
            ${'New Lead: ' + lead.full_name},
            ${lead.full_name + ' — ' + lead.property_address + ', ' + lead.property_city + ', ' + lead.property_state},
            ${lead.id}
          )
        `;

        // Auto-SMS: send confirmation if phone provided
        if (lead.phone) {
          const { sendSms } = await import("~/lib/sms");
          const address = `${lead.property_address}, ${lead.property_city}, ${lead.property_state}`;
          await sendSms(
            lead.phone,
            `Hi ${lead.full_name}, thanks for reaching out to DealFlow AI! We received your property details for ${address} and will send you a cash offer within 24 hours. Reply STOP to opt out.`,
            lead.id,
          );
        }
      }

      return { success: true as const, message: "Lead submitted successfully" };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unknown error occurred";
      if (msg.includes("DATABASE_URL")) {
        return {
          success: false as const,
          error:
            "Database not connected yet. Your information was received but could not be saved. We will contact you shortly.",
        };
      }
      return { success: false as const, error: "Something went wrong. Please try again." };
    }
  });

// --- Form Component ---
export const Route = createFileRoute("/get-offer")({
  head: () => ({
    meta: [
      { title: "Get Your Cash Offer — DealFlow AI" },
      {
        name: "description",
        content:
          "Fill out our quick form and get a fair cash offer for your home within 24 hours. No repairs, no agents, no obligation.",
      },
    ],
  }),
  component: OfferForm,
});

function OfferForm() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    property_address: "",
    property_city: "",
    property_state: "",
    property_zip: "",
    property_type: "",
    property_condition: "",
    estimated_repairs: "",
    reason_for_selling: "",
    desired_timeline: "",
    mortgage_status: "",
    notes: "",
    lead_source: "",
    utm_source: "",
    utm_medium: "",
    utm_campaign: "",
  });

  // Read UTM params from URL on page load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const source = params.get("utm_source");
    const medium = params.get("utm_medium");
    const campaign = params.get("utm_campaign");
    if (source || medium || campaign) {
      setForm((prev) => ({
        ...prev,
        utm_source: source || "",
        utm_medium: medium || "",
        utm_campaign: campaign || "",
      }));
    }
  }, []);

  const update = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validateStep = (s: number): boolean => {
    const errs: Record<string, string> = {};
    if (s === 1) {
      if (!form.full_name.trim()) errs.full_name = "Full name is required";
      if (!form.property_address.trim()) errs.property_address = "Address is required";
      if (!form.property_city.trim()) errs.property_city = "City is required";
      if (!form.property_state.trim()) errs.property_state = "State is required";
      if (!form.property_zip.trim()) errs.property_zip = "ZIP code is required";
      if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
        errs.email = "Please enter a valid email";
      }
      if (form.phone && !/^[\d\s()+\-.]{7,}$/.test(form.phone)) {
        errs.phone = "Please enter a valid phone number";
      }
    }
    if (s === 2) {
      if (!form.property_type) errs.property_type = "Please select a property type";
      if (!form.property_condition) errs.property_condition = "Please select a condition";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateStep(2)) return;
    setSubmitting(true);
    setServerError("");

    try {
      const result = await submitLead({ data: form });
      if (result.success) {
        navigate({ to: "/thank-you" });
      } else {
        setServerError(result.error || "Something went wrong.");
      }
    } catch {
      setServerError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const totalSteps = 2;

  return (
    <div className="px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="text-center">
          <span className="inline-block rounded-full bg-gold-500/10 px-4 py-1 text-sm font-medium text-gold-500">
            Free, No-Obligation Offer
          </span>
          <h1 className="mt-4 text-3xl font-bold text-white sm:text-4xl">
            Get Your Cash Offer
          </h1>
          <p className="mt-3 text-gray-400">
            Fill out the form below and receive a fair cash offer within 24 hours.
            No repairs. No agents. No pressure.
          </p>
        </div>

        {/* Progress */}
        <div className="mt-8 flex items-center justify-center gap-2">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                  step > i + 1
                    ? "bg-gold-500 text-navy-900"
                    : step === i + 1
                      ? "bg-gold-500 text-navy-900"
                      : "bg-navy-700 text-gray-400"
                }`}
              >
                {step > i + 1 ? "✓" : i + 1}
              </div>
              {i < totalSteps - 1 && (
                <div className={`h-px w-8 ${step > i + 1 ? "bg-gold-500" : "bg-navy-700"}`} />
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-center text-sm text-gray-500">
          Step {step} of {totalSteps}: {step === 1 ? "Property & Contact" : "Property Details"}
        </p>

        {/* Server error */}
        {serverError && (
          <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-center text-sm text-red-400">
            {serverError}
          </div>
        )}

        {/* Form */}
        <div className="mt-8 rounded-xl border border-navy-700 bg-navy-800/50 p-6 sm:p-8">
          {step === 1 && (
            <div className="space-y-5">
              <Field
                label="Full Name *"
                name="full_name"
                value={form.full_name}
                onChange={(v) => update("full_name", v)}
                error={errors.full_name}
                placeholder="John Doe"
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={(v) => update("email", v)}
                  error={errors.email}
                  placeholder="john@example.com"
                />
                <Field
                  label="Phone"
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(v) => update("phone", v)}
                  error={errors.phone}
                  placeholder="(555) 123-4567"
                />
              </div>
              <Field
                label="Property Address *"
                name="property_address"
                value={form.property_address}
                onChange={(v) => update("property_address", v)}
                error={errors.property_address}
                placeholder="123 Main Street"
              />
              <div className="grid gap-5 sm:grid-cols-3">
                <Field
                  label="City *"
                  name="property_city"
                  value={form.property_city}
                  onChange={(v) => update("property_city", v)}
                  error={errors.property_city}
                  placeholder="City"
                />
                <Field
                  label="State *"
                  name="property_state"
                  value={form.property_state}
                  onChange={(v) => update("property_state", v)}
                  error={errors.property_state}
                  placeholder="State"
                />
                <Field
                  label="ZIP Code *"
                  name="property_zip"
                  value={form.property_zip}
                  onChange={(v) => update("property_zip", v)}
                  error={errors.property_zip}
                  placeholder="12345"
                />
              </div>
              {/* UTM hidden fields */}
              <input type="hidden" name="utm_source" value={form.utm_source} />
              <input type="hidden" name="utm_medium" value={form.utm_medium} />
              <input type="hidden" name="utm_campaign" value={form.utm_campaign} />
              <div className="pt-4">
                <button
                  type="button"
                  onClick={() => {
                    if (validateStep(1)) setStep(2);
                  }}
                  className="w-full rounded-lg bg-gold-500 px-6 py-3 text-base font-semibold text-navy-900 transition-all hover:bg-gold-400 hover:shadow-lg hover:shadow-gold-500/25"
                >
                  Continue →
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <SelectField
                label="Property Type *"
                name="property_type"
                value={form.property_type}
                onChange={(v) => update("property_type", v)}
                error={errors.property_type}
                options={[
                  { value: "", label: "Select property type..." },
                  { value: "single_family", label: "Single Family" },
                  { value: "multi_family", label: "Multi-Family" },
                  { value: "condo", label: "Condo" },
                  { value: "townhouse", label: "Townhouse" },
                  { value: "land", label: "Land" },
                  { value: "commercial", label: "Commercial" },
                  { value: "other", label: "Other" },
                ]}
              />
              <SelectField
                label="Property Condition *"
                name="property_condition"
                value={form.property_condition}
                onChange={(v) => update("property_condition", v)}
                error={errors.property_condition}
                options={[
                  { value: "", label: "Select condition..." },
                  { value: "excellent", label: "Excellent" },
                  { value: "good", label: "Good" },
                  { value: "fair", label: "Fair" },
                  { value: "poor", label: "Poor" },
                  { value: "needs_major_work", label: "Needs Major Work" },
                ]}
              />
              <SelectField
                label="Estimated Repairs Needed"
                name="estimated_repairs"
                value={form.estimated_repairs}
                onChange={(v) => update("estimated_repairs", v)}
                options={[
                  { value: "", label: "Select range..." },
                  { value: "none", label: "None — move-in ready" },
                  { value: "under_10k", label: "Under $10,000" },
                  { value: "10k_25k", label: "$10,000 – $25,000" },
                  { value: "25k_50k", label: "$25,000 – $50,000" },
                  { value: "50k_100k", label: "$50,000 – $100,000" },
                  { value: "over_100k", label: "Over $100,000" },
                  { value: "unknown", label: "Not Sure" },
                ]}
              />
              <SelectField
                label="Reason for Selling"
                name="reason_for_selling"
                value={form.reason_for_selling}
                onChange={(v) => update("reason_for_selling", v)}
                options={[
                  { value: "", label: "Select reason..." },
                  { value: "tax_issue", label: "Tax Issue" },
                  { value: "probate", label: "Probate / Inherited" },
                  { value: "vacant", label: "Vacant Property" },
                  { value: "pre_foreclosure", label: "Pre-Foreclosure" },
                  { value: "tired_landlord", label: "Tired Landlord" },
                  { value: "divorce", label: "Divorce" },
                  { value: "relocation", label: "Relocation" },
                  { value: "code_violations", label: "Code Violations" },
                  { value: "other", label: "Other" },
                ]}
              />
              <SelectField
                label="Desired Timeline"
                name="desired_timeline"
                value={form.desired_timeline}
                onChange={(v) => update("desired_timeline", v)}
                options={[
                  { value: "", label: "Select timeline..." },
                  { value: "immediately", label: "Immediately — ASAP" },
                  { value: "within_30_days", label: "Within 30 Days" },
                  { value: "1_3_months", label: "1–3 Months" },
                  { value: "just_exploring", label: "Just Exploring Options" },
                ]}
              />
              <SelectField
                label="Mortgage Status"
                name="mortgage_status"
                value={form.mortgage_status}
                onChange={(v) => update("mortgage_status", v)}
                options={[
                  { value: "", label: "Select status..." },
                  { value: "free_and_clear", label: "Owned Free & Clear" },
                  { value: "has_mortgage", label: "Has a Mortgage" },
                  { value: "underwater", label: "Underwater (owe more than it's worth)" },
                  { value: "dont_know", label: "Don't Know" },
                ]}
              />
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">
                  Additional Notes
                </label>
                <textarea
                  name="notes"
                  rows={4}
                  value={form.notes}
                  onChange={(e) => update("notes", e.target.value)}
                  placeholder="Tell us anything else about your property or situation..."
                  className="w-full rounded-lg border border-navy-700 bg-navy-900 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                />
              </div>
              <SelectField
                label="How Did You Hear About Us?"
                name="lead_source"
                value={form.lead_source}
                onChange={(v) => update("lead_source", v)}
                options={[
                  { value: "", label: "Select source..." },
                  { value: "google", label: "Google Search" },
                  { value: "social_media", label: "Social Media" },
                  { value: "direct_mail", label: "Direct Mail" },
                  { value: "referral", label: "Referral" },
                  { value: "other", label: "Other" },
                ]}
              />
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-lg border border-navy-700 px-6 py-3 text-sm font-medium text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-gold-500 px-6 py-3 text-base font-semibold text-navy-900 transition-all hover:bg-gold-400 hover:shadow-lg hover:shadow-gold-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Submitting..." : "Get My Cash Offer →"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Reusable form fields ---
function Field({
  label,
  name,
  value,
  onChange,
  error,
  type = "text",
  placeholder,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium text-gray-300">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border bg-navy-900 px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 ${
          error
            ? "border-red-500 focus:border-red-500 focus:ring-red-500"
            : "border-navy-700 focus:border-gold-500 focus:ring-gold-500"
        }`}
      />
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  );
}

function SelectField({
  label,
  name,
  value,
  onChange,
  error,
  options,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium text-gray-300">
        {label}
      </label>
      <select
        id={name}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border bg-navy-900 px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 ${
          error
            ? "border-red-500 focus:border-red-500 focus:ring-red-500"
            : "border-navy-700 focus:border-gold-500 focus:ring-gold-500"
        }`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-navy-800 text-white">
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  );
}
