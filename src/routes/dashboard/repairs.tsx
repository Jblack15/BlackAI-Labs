import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/repairs")({
  component: RepairsPage,
});

const repairStats = [
  { label: "Total Active", value: "12", color: "text-white" },
  { label: "In Progress", value: "5", color: "text-blue-400" },
  { label: "Waiting on Parts", value: "4", color: "text-amber-400" },
  { label: "Completed Today", value: "3", color: "text-emerald-400" },
];

const columns = [
  {
    title: "Waiting on Parts",
    count: 4,
    color: "amber",
    borderColor: "border-amber-500/30",
    bgColor: "bg-amber-500/5",
    headerBg: "bg-amber-500/10",
    headerText: "text-amber-400",
    repairs: [
      {
        vehicle: "2019 Ford F-150",
        repair: "Brake Job",
        customer: "Mike Rodriguez",
        detail: "Waiting on rotors (3 days)",
        detailLabel: "Part: Front Rotors",
        time: "Ordered Jul 28",
      },
      {
        vehicle: "2022 Subaru Outback",
        repair: "CV Axle Replacement",
        customer: "Amanda Torres",
        detail: "Waiting on axle assembly (2 days)",
        detailLabel: "Part: CV Axle Kit",
        time: "Ordered Jul 29",
      },
      {
        vehicle: "2021 Tesla Model 3",
        repair: "Bumper + Sensor Calibration",
        customer: "James Wilson",
        detail: "Waiting on sensor module (5 days)",
        detailLabel: "Part: Ultrasonic Sensor",
        time: "Ordered Jul 26",
      },
      {
        vehicle: "2020 RAM 1500",
        repair: "Transmission Service",
        customer: "Lisa Martinez",
        detail: "Waiting on gasket kit (1 day)",
        detailLabel: "Part: Gasket Set",
        time: "Ordered Jul 30",
      },
    ],
  },
  {
    title: "In Progress",
    count: 5,
    color: "blue",
    borderColor: "border-blue-500/30",
    bgColor: "bg-blue-500/5",
    headerBg: "bg-blue-500/10",
    headerText: "text-blue-400",
    repairs: [
      {
        vehicle: "2021 Honda Accord",
        repair: "Front Bumper Replacement",
        customer: "Sarah Chen",
        detail: "In Paint — Est. tomorrow 3pm",
        detailLabel: "Technician: Alex",
        time: "Started today",
      },
      {
        vehicle: "2020 BMW 3 Series",
        repair: "Diagnostic",
        customer: "David Kim",
        detail: "In Progress — Est. 5pm today",
        detailLabel: "Technician: Jordan",
        time: "Started 10am",
      },
      {
        vehicle: "2018 Chevrolet Malibu",
        repair: "AC Compressor",
        customer: "Emily Davis",
        detail: "Disassembly — Est. Jul 31",
        detailLabel: "Technician: Alex",
        time: "Started Jul 29",
      },
      {
        vehicle: "2023 Kia Telluride",
        repair: "Rear Quarter Panel",
        customer: "Brian Lee",
        detail: "Body Work — Est. Aug 2",
        detailLabel: "Technician: Marcus",
        time: "Started Jul 28",
      },
      {
        vehicle: "2024 Hyundai Tucson",
        repair: "Windshield Replacement",
        customer: "Rachel Green",
        detail: "Curing — Est. 3pm today",
        detailLabel: "Technician: Jordan",
        time: "Started 8am",
      },
    ],
  },
  {
    title: "Completed Today",
    count: 3,
    color: "emerald",
    borderColor: "border-emerald-500/30",
    bgColor: "bg-emerald-500/5",
    headerBg: "bg-emerald-500/10",
    headerText: "text-emerald-400",
    repairs: [
      {
        vehicle: "2023 Toyota Camry",
        repair: "Fender Repair",
        customer: "Jessica Park",
        detail: "Ready for pickup — 2:00 PM",
        detailLabel: "Completed at 1:30 PM",
        time: "Notified",
      },
      {
        vehicle: "2022 Subaru Outback",
        repair: "Oil + Tires",
        customer: "Amanda Torres",
        detail: "Picked up — 11:00 AM",
        detailLabel: "Completed at 10:45 AM",
        time: "Picked up",
      },
      {
        vehicle: "2020 Honda Civic",
        repair: "Brake Pads + Rotors",
        customer: "Tom Harris",
        detail: "Ready for pickup — 4:00 PM",
        detailLabel: "Completed at 3:30 PM",
        time: "Notified",
      },
    ],
  },
];

const colorMap: Record<string, { dot: string; badge: string }> = {
  amber: { dot: "bg-amber-400", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  blue: { dot: "bg-blue-400", badge: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  emerald: { dot: "bg-emerald-400", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
};

function RepairsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-white">Active Repairs</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {repairStats.map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
            <p className="text-xs font-medium text-slate-400">{s.label}</p>
            <p className={`mt-1 text-2xl font-extrabold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {columns.map((col) => (
          <div
            key={col.title}
            className={`rounded-xl border ${col.borderColor} ${col.bgColor} flex flex-col`}
          >
            {/* Column header */}
            <div className={`flex items-center justify-between px-4 py-3 rounded-t-xl ${col.headerBg}`}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${colorMap[col.color].dot}`} />
                <h3 className={`font-semibold text-sm ${col.headerText}`}>{col.title}</h3>
              </div>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${colorMap[col.color].badge}`}>
                {col.count}
              </span>
            </div>

            {/* Repair cards */}
            <div className="p-3 space-y-3 flex-1">
              {col.repairs.map((r) => (
                <div
                  key={r.vehicle + r.customer}
                  className="rounded-lg border border-slate-700/50 bg-slate-800/60 p-4 hover:border-slate-600/50 transition cursor-pointer"
                >
                  <p className="font-semibold text-white text-sm">{r.vehicle}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{r.repair}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="h-6 w-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300">
                      {r.customer.split(" ").map((n) => n[0]).join("")}
                    </div>
                    <span className="text-xs text-slate-400">{r.customer}</span>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-700/50">
                    <p className="text-xs font-medium text-slate-300">{r.detailLabel}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{r.detail}</p>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">{r.time}</span>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${colorMap[col.color].badge}`}>
                      {col.title}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
