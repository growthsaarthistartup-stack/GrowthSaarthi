import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://growthsaarthi.com");

const SITE_NAME = "GrowthSaarthi";
const SITE_TITLE = "GrowthSaarthi | AI Chief of Staff for Founders";
const SITE_DESCRIPTION =
  "GrowthSaarthi is an AI operating system that onboards your startup, monitors connected tools, builds a live knowledge graph, and runs daily growth playbooks on autopilot. Solve acquisition, retention, and SEO with specialized autonomous agents.";

export const metadata: Metadata = {
  // Core
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "GrowthSaarthi",
    "AI chief of staff",
    "startup growth automation",
    "AI SEO audit",
    "founder tools",
    "autonomous growth agents",
    "startup analytics",
    "competitor monitoring",
    "customer retention AI",
    "growth automation SaaS",
    "SEO monitoring tool",
    "AI startup operating system",
  ],
  authors: [{ name: "GrowthSaarthi", url: SITE_URL }],
  creator: "GrowthSaarthi",
  publisher: "GrowthSaarthi",

  // Canonical
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: "/",
  },

  // Robots
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },

  // Open Graph (og:image is auto-supplied by /opengraph-image.tsx)
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },

  // Twitter Card (twitter:image is auto-supplied by /opengraph-image.tsx)
  twitter: {
    card: "summary_large_image",
    site: "@growthsaarthi",
    creator: "@growthsaarthi",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },

  // App / PWA
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1A47" },
  ],
  colorScheme: "light",
  category: "technology",

  verification: { google: "AaKuCLqz4Op8z8oo-Js991d--8SGn78VbcGgG-SboTg" },
};

// JSON-LD: Organization schema (site-wide, server-rendered)
const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: "GrowthSaarthi",
  url: SITE_URL,
  logo: {
    "@type": "ImageObject",
    url: `${SITE_URL}/logo.png`,
    width: 512,
    height: 512,
  },
  description: SITE_DESCRIPTION,
  sameAs: [
    // Add social profile URLs here, e.g.:
    // "https://twitter.com/growthsaarthi",
    // "https://linkedin.com/company/growthsaarthi",
  ],
};

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  url: SITE_URL,
  name: "GrowthSaarthi",
  description: SITE_DESCRIPTION,
  publisher: { "@id": `${SITE_URL}/#organization` },
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
      <head>
        {/* JSON-LD: Organization -- visible to Googlebot in initial HTML */}
        <Script
          id="schema-org-organization"
          type="application/ld+json"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <Script
          id="schema-org-website"
          type="application/ld+json"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
        />
      </head>
      <body
        className="min-h-full flex flex-col font-sans bg-light-bg text-slate-900 selection:bg-brand-teal selection:text-white"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}