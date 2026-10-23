import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, ChartNoAxesCombined, ClipboardList, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { getUserSafely } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: { absolute: "Aurevia CRM | Clinic Lead Management and Patient Follow-Up" },
  description:
    "Manage clinic enquiries, patient follow-ups, appointments, team assignments and reports in one focused CRM workspace.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Aurevia CRM | Clinic Lead Management",
    description: "A clear workspace for clinic leads, follow-ups, appointments and team activity.",
    url: "/",
    siteName: "Aurevia CRM",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Aurevia CRM | Clinic Lead Management",
    description: "Manage clinic enquiries, follow-ups, appointments and team activity in one workspace.",
  },
};

const productSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Aurevia CRM",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "A clinic CRM workspace for patient enquiries, lead follow-up, appointments, team assignments, attendance and reporting.",
};

const features = [
  {
    icon: ClipboardList,
    title: "One lead workspace",
    description: "Review clinic enquiries, update statuses, add remarks and keep next follow-up dates visible.",
  },
  {
    icon: UsersRound,
    title: "Clear team ownership",
    description: "Assign leads to team members and review each person’s active work from role-based dashboards.",
  },
  {
    icon: CalendarDays,
    title: "Appointments and attendance",
    description: "Keep OPD and IPD appointment details alongside team attendance and leave workflows.",
  },
  {
    icon: ChartNoAxesCombined,
    title: "Useful reports",
    description: "See lead sources, pipeline progress and team activity to understand what needs attention.",
  },
];

export default async function Home() {
  const { user } = await getUserSafely();
  if (user) redirect("/dashboard");

  return (
    <main className="min-h-screen overflow-hidden bg-[#f7faf8] text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema).replace(/</g, "\\u003c") }}
      />
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-3" aria-label="Aurevia CRM home">
          <Image src="/logo.png" alt="Aurevia" width={42} height={42} priority className="size-10 rounded-xl object-contain" />
          <span className="text-lg font-semibold tracking-tight">Aurevia <span className="font-normal text-emerald-700">CRM</span></span>
        </Link>
        <Link href="/login" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-800">
          Team sign in
        </Link>
      </header>

      <section className="mx-auto grid w-full max-w-7xl items-center gap-12 px-5 pb-16 pt-12 sm:px-8 md:grid-cols-[1.05fr_.95fr] md:pb-24 md:pt-20">
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800 shadow-sm">
            Clinic lead management
          </p>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
            Every patient enquiry, followed up with care.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
            Aurevia CRM brings clinic leads, agent assignments, appointment details and team activity into one clear workspace—so your team can focus on the next patient conversation.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/login" className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/10 transition hover:-translate-y-0.5 hover:bg-emerald-800">
              Sign in to Aurevia CRM <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <a href="#features" className="rounded-xl px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-slate-900">
              Explore features
            </a>
          </div>
          <p className="mt-5 text-xs text-slate-500">For authorised Aurevia team members.</p>
        </div>

        <div className="relative mx-auto w-full max-w-xl">
          <div className="absolute -inset-8 rounded-[2rem] bg-gradient-to-br from-emerald-200/55 via-white to-teal-100/80 blur-2xl" aria-hidden="true" />
          <div className="relative rounded-[1.75rem] border border-white bg-white/85 p-5 shadow-[0_28px_80px_-38px_rgba(15,80,57,.38)] backdrop-blur-xl sm:p-7">
            <div className="flex items-center justify-between border-b border-slate-100 pb-5">
              <div>
                <p className="text-xs font-medium text-slate-500">TEAM OVERVIEW</p>
                <p className="mt-1 text-lg font-semibold tracking-tight">Today at a glance</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">Clinic CRM</span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {[
                ["New enquiries", "Assigned to your team"],
                ["Follow-ups", "Next action kept visible"],
                ["Appointments", "OPD and IPD details"],
                ["Team activity", "Work by role and owner"],
              ].map(([title, detail]) => (
                <div key={title} className="rounded-2xl border border-slate-100 bg-[#fbfdfc] p-4">
                  <span className="mb-5 block size-2 rounded-full bg-emerald-500" aria-hidden="true" />
                  <p className="font-semibold text-slate-900">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-2xl bg-slate-950 p-4 text-white">
              <p className="text-xs font-medium text-emerald-200">A focused daily workflow</p>
              <p className="mt-1 text-sm text-slate-200">Find the right lead, add a note, and keep the next step clear.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="border-y border-slate-200/70 bg-white py-16 sm:py-20">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Built for clinic teams</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">A practical CRM for the work after an enquiry.</h2>
            <p className="mt-4 leading-7 text-slate-600">Keep patient enquiries organised from assignment through follow-up and appointment updates, with a shared view for authorised team members.</p>
          </div>
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, description }) => (
              <article key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-md">
                <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800"><Icon className="size-5" aria-hidden="true" /></span>
                <h3 className="mt-5 font-semibold text-slate-950">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-16 sm:px-8 md:grid-cols-2 md:py-20">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">How teams use it</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">One shared process, clear ownership.</h2>
        </div>
        <div className="space-y-5 text-sm leading-6 text-slate-600">
          <p><strong className="text-slate-900">Capture and organise.</strong> Add enquiries manually or import lead lists, then search by patient, contact, treatment or status.</p>
          <p><strong className="text-slate-900">Assign and follow up.</strong> Team leads can distribute work while agents focus on their assigned patient conversations and notes.</p>
          <p><strong className="text-slate-900">Keep appointments visible.</strong> Track OPD and IPD updates with appointment dates and review the pipeline as work progresses.</p>
          <p><strong className="text-slate-900">Review team activity.</strong> Role-based dashboards and reports help authorised admins and managers see operational progress.</p>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-7 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© {new Date().getFullYear()} Aurevia CRM</p>
          <p>Clinic lead management, follow-ups and appointments.</p>
          <Link href="/login" className="font-semibold text-emerald-800 hover:text-emerald-900">Team sign in</Link>
        </div>
      </footer>
    </main>
  );
}
