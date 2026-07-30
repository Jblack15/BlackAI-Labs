import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/dashboard/appointments")({
  component: AppointmentsPage,
});

const stats = [
  { label: "Today", value: "4", sub: "appointments" },
  { label: "This Week", value: "18", sub: "booked" },
  { label: "No-shows", value: "2", sub: "this month" },
];

const weekDays = ["Mon 24", "Tue 25", "Wed 26", "Thu 27", "Fri 28", "Sat 29", "Sun 30"];
const todayIndex = 3; // Thursday

const appointments = [
  {
    time: "8:30 AM",
    service: "Oil Change",
    vehicle: "2019 Toyota Camry",
    customer: "Sarah Chen",
    status: "Confirmed",
    statusColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  {
    time: "10:00 AM",
    service: "Brake Replacement",
    vehicle: "2021 Honda Accord",
    customer: "Mike Rodriguez",
    status: "In Progress",
    statusColor: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  {
    time: "1:00 PM",
    service: "Diagnostic Check",
    vehicle: "2020 BMW 3 Series",
    customer: "David Kim",
    status: "Confirmed",
    statusColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  {
    time: "3:30 PM",
    service: "Tire Rotation",
    vehicle: "2022 Subaru Outback",
    customer: "Amanda Torres",
    status: "Pending",
    statusColor: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
];

function AppointmentsPage() {
  const [selectedDay, setSelectedDay] = useState(todayIndex);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-extrabold text-white">Appointments</h1>
        <button className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 transition shadow-lg shadow-orange-500/20">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Appointment
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
            <p className="text-xs font-medium text-slate-400">{s.label}</p>
            <p className="mt-1 text-2xl font-extrabold text-white">{s.value}</p>
            <p className="text-xs text-slate-500">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Week view strip */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-2">
        <div className="grid grid-cols-7 gap-1">
          {weekDays.map((day, i) => (
            <button
              key={day}
              onClick={() => setSelectedDay(i)}
              className={`rounded-lg py-3 text-center text-xs sm:text-sm font-medium transition ${
                i === selectedDay
                  ? "bg-orange-500 text-white shadow-lg"
                  : i === todayIndex
                    ? "bg-orange-500/10 text-orange-400"
                    : "text-slate-400 hover:bg-slate-700/50 hover:text-white"
              }`}
            >
              <span className="block">{day.split(" ")[0]}</span>
              <span className="block text-[10px] sm:text-xs opacity-70">{day.split(" ")[1]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Day label and appointment list */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="h-8 w-1 rounded-full bg-orange-500" />
          <p className="text-sm font-semibold text-slate-300">
            {selectedDay === todayIndex ? "Today" : weekDays[selectedDay]} — {appointments.length} appointment{appointments.length !== 1 ? "s" : ""}
          </p>
        </div>

        {selectedDay === todayIndex ? (
          <div className="space-y-3">
            {appointments.map((apt) => (
              <div
                key={apt.time + apt.customer}
                className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4 sm:p-5 hover:border-slate-600/50 transition group"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-start gap-4">
                    <div className="shrink-0 w-20 text-center">
                      <p className="text-lg font-bold text-white">{apt.time.split(" ")[0]}</p>
                      <p className="text-xs text-slate-400">{apt.time.split(" ")[1]}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-white">{apt.service}</p>
                      <p className="text-sm text-slate-400">{apt.vehicle}</p>
                      <p className="text-sm text-slate-500">{apt.customer}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${apt.statusColor}`}>
                      {apt.status}
                    </span>
                    <button className="shrink-0 rounded-lg p-2 text-slate-500 hover:text-white hover:bg-slate-700/50 transition opacity-0 group-hover:opacity-100">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v.01M12 12v.01M12 19v.01" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 rounded-xl border border-dashed border-slate-700/50 bg-slate-800/30">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
            <p className="text-slate-400 font-medium">No appointments scheduled</p>
            <p className="text-sm text-slate-500 mt-1">Click "New Appointment" to add one</p>
          </div>
        )}
      </div>
    </div>
  );
}
