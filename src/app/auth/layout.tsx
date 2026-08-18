import type { Metadata } from "next";
import type { ReactNode } from "react";

// Auth pages must NOT be indexed -- they are functional pages, not content
export const metadata: Metadata = {
  title: "Sign In / Sign Up -- GrowthSaarthi",
  description: "Sign in or create your GrowthSaarthi account to access your AI growth dashboard.",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
  },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}