import type { Metadata } from "next";
import "./globals.css";

import { Toaster } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "Aurevia CRM — Patient Relationship Management",
  description:
    "Aurevia HealthCare's CRM — leads, pipeline, consultations, surgeries, patients and attendance in one system.",
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
