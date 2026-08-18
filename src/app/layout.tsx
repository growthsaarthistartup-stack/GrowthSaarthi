import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GrowthSaarthi | AI Chief of Staff for Founders",
  description: "GrowthSaarthi is an AI operating system that onboards your startup, monitors connected tools, builds a live knowledge graph, and runs daily growth playbooks on autopilot. Solve acquisition, retention, and SEO with specialized autonomous agents.",
  keywords: "GrowthSaarthi, LaunchPilot, AI chief of staff, founder agent, startup growth, autonomous SEO, competitor monitoring, customer retention, growth automation",
  openGraph: {
    title: "GrowthSaarthi | AI Chief of Staff for Founders",
    description: "From signup to autonomous growth execution. GrowthSaarthi builds your startup's knowledge graph and runs daily growth plays.",
    type: "website",
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body 
        className="min-h-full flex flex-col font-sans bg-light-bg text-slate-900 selection:bg-brand-teal selection:text-white"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
