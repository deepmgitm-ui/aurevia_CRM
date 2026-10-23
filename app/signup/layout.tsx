import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account Registration",
  robots: { index: false, follow: false, noarchive: true },
};

export default function SignupLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
