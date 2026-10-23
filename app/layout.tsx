import type { Metadata } from "next";
import "./globals.css";

import { Toaster } from "@/components/ui/toast";

export const metadata: Metadata = {
  metadataBase: new URL("https://aureviacrm.vercel.app"),
  title: {
    default: "Aurevia CRM | Clinic Lead Management",
    template: "%s | Aurevia CRM",
  },
  description:
    "Manage clinic enquiries, patient follow-ups, appointments, team assignments and reports in one focused CRM workspace.",
  applicationName: "Aurevia CRM",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Aurevia CRM | Clinic Lead Management",
    description: "A clear workspace for clinic leads, follow-ups, appointments and team activity.",
    url: "/",
    siteName: "Aurevia CRM",
    locale: "en_IN",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Aurevia CRM | Clinic Lead Management",
    description: "Manage clinic enquiries, follow-ups, appointments and team activity in one workspace.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
