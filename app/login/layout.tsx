import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Team Sign In",
  robots: { index: false, follow: false, noarchive: true },
};

export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
