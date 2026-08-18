"use client";

import React, { useState, useEffect, useRef } from "react";
import type { ScanResult, ScanPlanTask } from "@/app/api/onboarding/route";
import Image from "next/image";
import Link from "next/link";

// Custom SVG Icons (to keep it light and avoid dependency issues)
const CompassIcon = () => (
  <svg className="w-6 h-6 text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
  </svg>
);

const ShieldCheckIcon = () => (
  <svg className="w-5 h-5 text-brand-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);

const BoltIcon = () => (
  <svg className="w-6 h-6 text-slate-900 animate-pulse-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

const SearchIcon = () => (
  <svg className="w-5 h-5 text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const ArrowRightIcon = ({ className = "w-5 h-5 ml-2" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
  </svg>
);

const CheckIcon = ({ className = "w-5 h-5 text-brand-teal" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-5 h-5 text-slate-500 hover:text-slate-900 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const SparklesIcon = ({ className = "w-5 h-5 text-brand-gold" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  </svg>
);

const RefreshIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.27 15C20.35 15.69 19.33 16 18 16c-4.42 0-8-3.58-8-8 0-1.33.31-2.35.94-3.27m0 0L4 4" />
  </svg>
);

export default function Home() {
  const [activeTab, setActiveTab] = useState("features");

  // Simulated Scan Widget State
  const [scanStep, setScanStep] = useState<"idle" | "scanning" | "report">("idle");
  const [scanProgress, setScanProgress] = useState(0);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [startupName, setStartupName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  
  // Auth State
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [startupStage, setStartupStage] = useState<"Idea" | "MVP" | "Growth">("MVP");
  const [primaryGoal, setPrimaryGoal] = useState<"acquisition" | "retention">("acquisition");

  // Score explainer panel state
  const [selectedScoreExplainer, setSelectedScoreExplainer] = useState<"health" | "validation" | "growth" | null>(null);

  // Trust Ladder level (1-4)
  const [trustLevel, setTrustLevel] = useState(1);

  // Pricing Yearly Toggle
  const [isAnnual, setIsAnnual] = useState(true);

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingTaskText, setEditingTaskText] = useState("");

  // Real scan result from POST /api/onboarding
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Fetch session on load
  useEffect(() => {
    fetch("/api/auth/me")
      .then(res => res.json())
      .then(data => {
        if (data.user) setUser(data.user);
      })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    triggerToast("Logged out successfully");
  };

  // Growth Plan Action Mock States (Approved, Edited, Ignored)
  // Typed as ScanPlanTask[] so recId is available when real API tasks replace these defaults
  const [planTasks, setPlanTasks] = useState<ScanPlanTask[]>([
    {
      id: 1,
      week: "Week 1",
      title: "Rewrite Hero Section Value Proposition",
      detail: "Change copy from 'A general analytics tool' to 'The dashboard that maps your customer retention loop'.",
      status: "pending",
      source: "Scraping Agent: Scraped Landing Page (Current copy lacks clear positioning compared to 3 closest competitors)",
      metric: "Target: Landing Page Conversion Rate (+15%)",
      agent: "Content Agent"
    },
    {
      id: 2,
      week: "Week 2",
      title: "Configure Stripe Failed Payment Webhook",
      detail: "Automatically trigger custom recovery email campaigns via email integration for failed invoices.",
      status: "pending",
      source: "Revenue monitoring: Stripe (3% churn detected from failed/dunning invoices last month)",
      metric: "Target: Customer Churn Reduction (-5%)",
      agent: "SEO & Integration Agent"
    },
    {
      id: 3,
      week: "Week 3",
      title: "Publish 3 SEO Blog Posts Targeting Keyword Gaps",
      detail: "Draft articles on 'autonomous growth orchestrators' and 'startup analytics integrations' where competitors rank higher.",
      status: "pending",
      source: "SEO Scan: 3 specific keywords identified with high search volumes and zero organic presence",
      metric: "Target: Organic Search Traffic (+12%)",
      agent: "SEO & Content Agent"
    }
  ]);


  const handleStartScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startupName.trim()) {
      triggerToast("Please enter your startup's name first!");
      return;
    }

    // Normalize URL with https:// if it is provided but missing the protocol
    let normalizedUrl = websiteUrl.trim();
    if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
      setWebsiteUrl(normalizedUrl);
    }

    setScanStep("scanning");
    setScanProgress(0);
    setScanLogs([]);
    setScanResult(null);

    // ── SSE progress stream ────────────────────────────────────────────────
    const progressParams = new URLSearchParams({
      startupName,
      websiteUrl:  normalizedUrl,
      stage:       startupStage,
      primaryGoal,
    });
    const es = new EventSource(`/api/onboarding/progress?${progressParams}`);
    esRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data) as
        | { log: string; progress: number }
        | { done: true };

      if ("done" in data) {
        es.close();
        return;
      }

      setScanProgress(data.progress);
      setScanLogs((prev) => [...prev, data.log]);

      if (data.progress >= 100) {
        es.close();
        setTimeout(() => setScanStep("report"), 800);
      }
    };

    es.onerror = () => {
      es.close();
      setScanStep("report"); // show report even if SSE drops
    };

    // ── Concurrent POST — fetch real result while SSE streams progress ─────
    fetch("/api/onboarding", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ startupName, websiteUrl: normalizedUrl, stage: startupStage, primaryGoal }),
    })
      .then((r) => r.json())
      .then((json: { ok?: boolean } & Partial<ScanResult>) => {
        if (json.ok && json.scores) {
          setScanResult(json as ScanResult);
          if (json.plan && json.plan.length > 0) {
            setPlanTasks(json.plan);
          }
        }
      })
      .catch(() => {
        // POST failed — keep static placeholder plan, show report anyway
        triggerToast("Scan complete! Some live data unavailable — check .env.local.");
      });
  };

  const handleApproveTask = (id: number) => {
    // Optimistic UI update immediately
    setPlanTasks(prev =>
      prev.map(t => t.id === id ? { ...t, status: "approved" } : t)
    );
    const task = planTasks.find(t => t.id === id);
    triggerToast(`Approved! ${task?.agent || 'Agent'} is preparing drafts.`);

    // Fire-and-forget API call when we have a real recId
    const recId     = task?.recId;
    const startupId = scanResult?.startupId;
    if (recId && startupId) {
      fetch(`/api/recommendations/${recId}/approve`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ startupId }),
      }).catch(() => {
        // Non-blocking — UI already updated optimistically
      });
    }
  };

  const handleIgnoreTask = (id: number) => {
    // Optimistic UI update
    setPlanTasks(prev =>
      prev.map(t => t.id === id ? { ...t, status: "ignored" } : t)
    );
    triggerToast("Task ignored. Model parameters adjusted.");

    const task      = planTasks.find(t => t.id === id);
    const recId     = task?.recId;
    const startupId = scanResult?.startupId;
    if (recId && startupId) {
      fetch(`/api/recommendations/${recId}/ignore`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ startupId }),
      }).catch(() => {});
    }
  };

  const handleStartEditTask = (id: number, currentText: string) => {
    setEditingTaskId(id);
    setEditingTaskText(currentText);
  };

  const handleSaveEditTask = (id: number) => {
    // Optimistic UI update
    setPlanTasks(prev =>
      prev.map(t => t.id === id ? { ...t, title: editingTaskText, status: "approved" } : t)
    );
    setEditingTaskId(null);
    triggerToast("Task parameters modified and approved.");

    const task      = planTasks.find(t => t.id === id);
    const recId     = task?.recId;
    const startupId = scanResult?.startupId;
    if (recId && startupId) {
      fetch(`/api/recommendations/${recId}/edit`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ startupId, newTitle: editingTaskText }),
      }).catch(() => {});
    }
  };

  // Trust Ladder Levels Description
  const trustLadderDetails = [
    {
      level: 1,
      name: "Level 1 — Suggest Only",
      timeline: "First 1–2 Weeks",
      desc: "The AI acts as an advisor. It analyzes your metrics and highlights opportunities, providing step-by-step guides. You execute everything manually.",
      example: "SEO Agent suggests rewriting your meta description to target 'growth chief of staff' and gives you the exact copy to paste.",
      risk: "Zero Risk — No write-access granted."
    },
    {
      level: 2,
      name: "Level 2 — Draft & Review",
      timeline: "Weeks 3–4",
      desc: "The AI drafts the updates, generates landing page copy, or writes blog posts directly in your GrowthSaarthi dashboard. You review, edit, and click push to live.",
      example: "Content Agent drafts a full LinkedIn article based on competitor gaps. It sits in your outbox waiting for your review.",
      risk: "Low Risk — Every outward action is gated by your manual sign-off."
    },
    {
      level: 3,
      name: "Level 3 — Confirm to Publish",
      timeline: "Month 2+",
      desc: "The AI prepares and stages changes directly on your CMS, Google Search Console, or Stripe. It alerts you via slack/notification, requiring a simple 'Yes/No' click to publish.",
      example: "SEO Agent identifies an indexation bug in robots.txt, creates the patch, and prompts: 'Apply robots.txt fix now? [Approve/Reject]'.",
      risk: "Medium Risk — AI handles configuration, but final execution is confirmed by you."
    },
    {
      level: 4,
      name: "Level 4 — Autonomous Tier",
      timeline: "Month 3+ (After Trust Score > 90)",
      desc: "AI executes low-risk, high-frequency tasks on autopilot. It reports actions taken and results achieved in your daily digest. You retain override controls.",
      example: "Website Agent detects a broken 404 page link in a blog post, automatically rewrites it to the correct working URL, and logs the fix.",
      risk: "Guarded Autonomy — AI executes within strict pre-approved boundaries."
    }
  ];

  return (
    <div className="min-h-screen bg-staggered-blocks text-slate-900 font-sans antialiased">
      {/* -- SEO: Structured Data (JSON-LD) -- visible to Googlebot in initial HTML -- */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            "@id": "https://growthsaarthi.com/#software",
            "name": "GrowthSaarthi",
            "url": "https://growthsaarthi.com",
            "applicationCategory": "BusinessApplication",
            "operatingSystem": "Web",
            "description": "GrowthSaarthi is an AI operating system that onboards your startup, monitors connected tools, builds a live knowledge graph, and runs daily growth playbooks on autopilot.",
            "offers": {
              "@type": "Offer",
              "price": "0",
              "priceCurrency": "USD",
              "priceSpecification": {
                "@type": "PriceSpecification",
                "price": "0",
                "description": "Free starter plan available"
              }
            },
            "aggregateRating": {
              "@type": "AggregateRating",
              "ratingValue": "4.9",
              "ratingCount": "127",
              "bestRating": "5"
            },
            "featureList": [
              "AI SEO Audit & Competitor Monitoring",
              "Autonomous Growth Agents",
              "Stripe & GA4 Integration",
              "Trust-Gated Automation",
              "24/7 Technical Monitoring",
              "Customer Retention Playbooks"
            ]
          })
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
              {
                "@type": "Question",
                "name": "What is GrowthSaarthi?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "GrowthSaarthi is an AI Chief of Staff for founders. It connects your startup tools (Stripe, GA4, HubSpot), builds a knowledge graph of your business, and runs autonomous growth agents for SEO, acquisition, and customer retention � all with a trust-gated approach so you stay in control."
                }
              },
              {
                "@type": "Question",
                "name": "How does the AI trust ladder work?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "GrowthSaarthi's trust ladder has 4 levels. Level 1 is suggest-only (AI advises, you act). Level 2 generates drafts and assets for your approval. Level 3 auto-executes low-risk tasks with your confirmation. Level 4 runs high-frequency automations autonomously within pre-approved boundaries."
                }
              },
              {
                "@type": "Question",
                "name": "What integrations does GrowthSaarthi support?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "GrowthSaarthi integrates with Stripe for revenue analytics, Google Analytics 4 for traffic insights, HubSpot for CRM and retention, and more. The platform is designed to connect your entire startup tool stack."
                }
              },
              {
                "@type": "Question",
                "name": "Is there a free plan?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Yes. GrowthSaarthi offers a free AI Discovery Scan that analyzes your startup's growth opportunities across SEO, acquisition, and retention � no credit card required."
                }
              }
            ]
          })
        }}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white px-6 py-3 rounded-2xl shadow-2xl animate-in slide-in-from-bottom-5 fade-in flex items-center gap-3 z-50">
          <div className="w-2 h-2 rounded-full bg-green-400"></div>
          <span className="font-medium text-sm">{toastMessage}</span>
        </div>
      )}

      {/* HEADER SECTION */}
      <header className="fixed top-0 left-0 w-full z-40 bg-slate-900/5 backdrop-blur-md border-b border-slate-900/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo Wrapper */}
            <div className="relative w-11 h-11 rounded-xl bg-white border border-slate-200/80 flex items-center justify-center p-1.5 shadow-sm">
              <Image
                src="/logo.png"
                alt="GrowthSaarthi Logo"
                fill
                className="object-contain p-1"
                priority
              />
            </div>
            <div>
              <div className="flex items-center">
                <span className="font-extrabold text-lg tracking-tight text-slate-900">Growth</span>
                <span className="font-extrabold text-lg tracking-tight text-brand-gold">Saarthi</span>
              </div>
              <span className="text-[8px] uppercase tracking-widest text-brand-teal font-extrabold block -mt-1">
                Your AI Chief of Staff
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-600">
            <a href="#how-it-works" className="hover:text-slate-900 transition-colors">Home</a>
            <a href="#features-section" className="hover:text-slate-900 transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-slate-900 transition-colors">How it works</a>
            <a href="#pricing-section" className="hover:text-slate-900 transition-colors">Pricing</a>
            <a href="#trust-ladder" className="hover:text-slate-900 transition-colors">FAQ</a>
          </nav>

          <div>
            {user ? (
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-slate-600 hidden md:block">{user.email}</span>
                <Link
                  href="/dashboard"
                  className="bg-slate-900 text-white font-bold text-xs px-5 py-3 rounded-full hover:bg-slate-800 transition-all flex items-center shadow-sm"
                >
                  <span>Dashboard</span>
                  <ArrowRightIcon className="w-3.5 h-3.5 ml-1.5" />
                </Link>
                <button 
                  onClick={handleLogout}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <Link
                href="/auth"
                className="bg-slate-900 text-white font-bold text-xs px-5 py-3 rounded-full hover:bg-slate-800 transition-all flex items-center shadow-sm"
              >
                <span>Book a Demo</span>
                <ArrowRightIcon className="w-3.5 h-3.5 ml-1.5" />
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* HERO SECTION WITH TILED BACKGROUND */}
      <section className="relative bg-[url('/heroSection.png')] bg-fixed bg-[size:auto_80%] lg:bg-[size:auto_90%] bg-right-bottom bg-no-repeat pt-50 pb-24 border-b border-slate-100 flex flex-col items-center">
        <div className="absolute inset-0 bg-white/10 pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 w-full">

          {/* Top split layout: Text on Left, Spacer on Right for VR girl */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center pt-8">
            <div className="lg:col-span-7 text-left flex flex-col items-start space-y-6">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-slate-900 tracking-tight leading-[1.05]">
                Automate Startup <br className="hidden sm:block" />
                Growth in Hours <br className="hidden sm:block" />
                with <span className="text-[#f45815]">AI-Powered</span> Agents
              </h1>

              <p className="text-sm sm:text-base text-slate-600 max-w-xl leading-relaxed font-semibold">
                GrowthSaarthi turns your ideas and operations into enterprise-ready growth workflows instantly with smart automation, seamless integrations, and 24/7 technical monitoring.
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
                <Link
                  href="/auth"
                  className="w-full sm:w-auto bg-[#f45815] hover:bg-[#e0470b] text-white font-extrabold text-sm px-8 py-4 rounded-full shadow-lg transition-all flex items-center justify-center gap-1.5"
                >
                  <span>Get Started</span>
                  <ArrowRightIcon className="w-4 h-4 ml-1" />
                </Link>
                <a
                  href="#features-section"
                  className="w-full sm:w-auto bg-white/40 hover:bg-white/60 border border-[#f45815] text-[#f45815] font-extrabold text-sm px-8 py-4 rounded-full shadow-sm backdrop-blur-sm transition-all flex items-center justify-center"
                >
                  <span>Watch Demo</span>
                </a>
              </div>
            </div>

            <div className="hidden lg:block lg:col-span-5 h-[350px]" />
          </div>
        </div>
      </section>

      {/* TILED CARD GRID SECTION (Moved under Hero section) */}
      <section className="pt-28 pb-16 border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full flex flex-col items-center">
          <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-3 gap-6 text-left items-stretch">

            {/* Column 1: Stacked Left Cards (Integrations + 2.5B+) */}
            <div className="md:col-span-1 flex flex-col gap-6">
              {/* Card 1: Integrations (Left top stacked) */}
              <div className="bg-white border border-slate-200/80 rounded-3xl p-6 shadow-sm flex-1 flex flex-col justify-between hover:shadow-md transition-shadow">
                <div className="space-y-5">
                  <div className="flex gap-2">
                    {["Stripe", "GA4", "HubSpot"].map((name, idx) => (
                      <div key={idx} className="w-10 h-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center shadow-sm text-xs font-bold text-slate-800">
                        {name === "GA4" ? "📈" : name === "Stripe" ? "💳" : "🤝"}
                      </div>
                    ))}
                  </div>
                  <div>
                    <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">Integrations</h3>
                    <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                      Achieve results faster than ever with intelligent AI automation and connected tools.
                    </p>
                  </div>
                </div>
              </div>

              {/* Card 2: 2.5B+ (Left bottom stacked) */}
              <div className="bg-white border border-slate-200/80 rounded-3xl p-6 shadow-sm flex-1 flex flex-col justify-between hover:shadow-md transition-shadow">
                <div className="space-y-2">
                  <h3 className="text-4xl font-black text-slate-900 tracking-tight">2.5B+</h3>
                  <p className="text-xs font-bold text-slate-700">Analytics facts tracked</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
                    Our core knowledge graph catalogs events to resolve data anomalies.
                  </p>
                </div>
              </div>
            </div>

            {/* Column 2: Tall Center Card (Startup Health Score dial gauge) */}
            <div className="md:col-span-1 bg-white border border-slate-200/80 rounded-3xl p-6 shadow-sm flex flex-col justify-between items-center text-center relative overflow-hidden group hover:shadow-md transition-shadow">
              <div className="absolute inset-x-0 top-0 h-1 bg-brand-teal" />
              <div className="space-y-4 my-auto w-full">
                <span className="text-[10px] font-bold text-brand-teal uppercase tracking-widest bg-brand-teal/10 px-2.5 py-1 rounded-full">
                  AI Status
                </span>
                <h4 className="text-sm font-extrabold text-slate-900 tracking-tight">Startup Health Index</h4>

                {/* Circular Gauge */}
                <div className="relative inline-flex items-center justify-center my-2">
                  <div className="w-24 h-24 rounded-full border-8 border-slate-100 border-r-brand-teal border-t-brand-teal border-b-brand-teal flex items-center justify-center shadow-inner">
                    <span className="text-2xl font-black text-slate-900">76</span>
                  </div>
                </div>

                <div className="space-y-1.5 text-left w-full pt-2 border-t border-slate-100">
                  <div className="flex justify-between text-[10px] font-bold text-slate-600">
                    <span>Validation</span>
                    <span>84%</span>
                  </div>
                  <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-gold" style={{ width: '84%' }} />
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-600">
                    <span>Growth</span>
                    <span>68%</span>
                  </div>
                  <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-teal" style={{ width: '68%' }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Column 3: Stacked Right Cards (85% + Support) */}
            <div className="md:col-span-1 flex flex-col gap-6">
              {/* Stack top: 85% Soft Lime Green Card */}
              <div className="bg-neon-lime border border-slate-200/20 rounded-3xl p-6 shadow-sm flex-1 flex flex-col justify-center hover:shadow-md transition-all">
                <h3 className="text-4xl font-black text-slate-900">85%</h3>
                <p className="text-xs font-extrabold text-slate-800 mt-2">Up to 83% of conversations</p>
                <p className="text-[11px] text-slate-700 leading-relaxed mt-1">
                  autonomously resolved and optimized by GrowthSaarthi agents.
                </p>
              </div>

              {/* Stack bottom: Support/Playbook card in soft blue-to-pink gradient */}
              <div className="bg-gradient-to-tr from-[#bae6fd] to-[#fecdd3] border border-slate-200/20 rounded-3xl p-6 shadow-sm flex-1 flex flex-col justify-between hover:shadow-md transition-shadow">
                <div>
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-tight">Automation Driven Support</h4>
                  <p className="text-[10px] text-slate-700 mt-1 leading-relaxed">
                    AI agents handle customer support queries and draft replies automatically.
                  </p>
                </div>
                <div className="flex items-center gap-1 mt-3">
                  <span className="w-2 h-2 rounded-full bg-brand-teal animate-pulse" />
                  <span className="text-[9px] font-bold text-slate-800">Monitoring Active</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* STATS SECTION (Side by side metrics with thin dividers, pure white background) */}
      <section className="py-16 border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-center divide-y md:divide-y-0 md:divide-x divide-slate-100">

            <div className="text-center md:text-left md:px-8 py-4 space-y-2">
              <h3 className="text-6xl font-black text-slate-900 tracking-tight">20K<span className="text-brand-teal">+</span></h3>
              <p className="text-xs text-slate-500 font-bold max-w-xs leading-relaxed mx-auto md:mx-0">
                In 38 countries, we work as one global team to help clients scale.
              </p>
            </div>

            <div className="text-center md:text-left md:px-12 py-4 space-y-2">
              <h3 className="text-6xl font-black text-slate-900 tracking-tight">72K<span className="text-brand-teal">%</span></h3>
              <p className="text-xs text-slate-500 font-bold max-w-xs leading-relaxed mx-auto md:mx-0">
                We worked with 86% of the Global 500 companies this year.
              </p>
            </div>

            <div className="text-center md:text-left md:px-12 py-4 space-y-2">
              <h3 className="text-6xl font-black text-slate-900 tracking-tight">86<span className="text-brand-teal">%</span></h3>
              <p className="text-xs text-slate-500 font-bold max-w-xs leading-relaxed mx-auto md:mx-0">
                We worked with 89% of the Global 500 companies globally.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* FEATURES SECTION (Styled exactly like Features to Boost Your Productivity) */}
      <section id="features-section" className="py-20 border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-16">
            <div className="max-w-md">
              <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-tight">
                Features to Boost Your Productivity
              </h2>
            </div>
            <div className="max-w-lg">
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                Built to help service leaders scale efficiency and deliver exceptional support through intelligent AI automation, 24/7.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-6 items-stretch">

            {/* Feature 1: Smart Workflow Automation */}
            <div className="md:col-span-3 bg-white border border-slate-200/80 rounded-3xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between min-h-[340px]">
              <div className="space-y-3 flex-1 flex flex-col justify-center">
                {/* Node 1: Trigger */}
                <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-3 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-lg bg-indigo-50 border border-indigo-100 text-xs flex items-center justify-center">💳</span>
                    <div>
                      <p className="text-[10px] font-extrabold text-slate-800 leading-none">Stripe Webhook Trigger</p>
                      <p className="text-[8px] text-slate-400 mt-0.5">invoice.payment_failed</p>
                    </div>
                  </div>
                  <span className="bg-rose-50 text-rose-600 text-[8px] font-extrabold px-2 py-0.5 rounded-full border border-rose-100">Failed</span>
                </div>

                {/* Connector Dot line */}
                <div className="flex justify-center -my-1.5">
                  <div className="h-6 w-0.5 border-l border-dashed border-slate-300 relative">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-brand-teal" />
                  </div>
                </div>

                {/* Node 2: AI Action */}
                <div className="bg-[#199874]/5 border border-brand-teal/20 rounded-xl p-3 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-lg bg-teal-50 border border-teal-100 text-xs flex items-center justify-center">🤖</span>
                    <div>
                      <p className="text-[10px] font-extrabold text-slate-800 leading-none">AI Recovery Agent</p>
                      <p className="text-[8px] text-slate-500 mt-0.5">LTV Assessment & Churn Risk</p>
                    </div>
                  </div>
                  <span className="bg-teal-50 text-brand-teal text-[8px] font-extrabold px-2 py-0.5 rounded-full border border-teal-100">Active</span>
                </div>

                {/* Connector Dot line */}
                <div className="flex justify-center -my-1.5">
                  <div className="h-6 w-0.5 border-l border-dashed border-slate-300 relative">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-brand-teal" />
                  </div>
                </div>

                {/* Node 3: Action */}
                <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-3 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-lg bg-sky-50 border border-sky-100 text-xs flex items-center justify-center">📧</span>
                    <div>
                      <p className="text-[10px] font-extrabold text-slate-800 leading-none">HubSpot Mailer</p>
                      <p className="text-[8px] text-slate-400 mt-0.5">Send tailored rescue offer</p>
                    </div>
                  </div>
                  <span className="bg-slate-100 text-slate-600 text-[8px] font-extrabold px-2 py-0.5 rounded-full">Dispatched</span>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-50">
                <h4 className="font-extrabold text-slate-900 text-sm">SmartWorkflow Automation</h4>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">Automate repetitive tasks and save valuable time.</p>
              </div>
            </div>

            {/* Feature 2: Real-Time Analytics */}
            <div className="md:col-span-3 bg-white border border-slate-200/80 rounded-3xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between min-h-[340px]">
              <div className="space-y-4 flex-1 flex flex-col justify-center">
                <div className="bg-slate-50/30 border border-slate-100 rounded-2xl p-4 shadow-sm">
                  {/* Metric Box Header */}
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Active Revenue Rescue</span>
                      <h4 className="text-xl font-black text-slate-900 mt-0.5">$8,142.60</h4>
                    </div>
                    <span className="bg-emerald-50 text-emerald-600 text-[9px] font-bold px-2 py-1 rounded-lg border border-emerald-100 flex items-center gap-0.5">
                      <span>▲</span> 14.2%
                    </span>
                  </div>

                  {/* High Fidelity Chart Simulation */}
                  <div className="h-20 w-full relative flex items-end pt-2">
                    {/* Horizontal gridlines */}
                    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-40">
                      <div className="border-t border-slate-200/60 w-full" />
                      <div className="border-t border-slate-200/60 w-full" />
                      <div className="border-t border-slate-200/60 w-full" />
                    </div>

                    <svg className="w-full h-12 text-brand-teal overflow-visible" viewBox="0 0 100 50" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#199874" stopOpacity="0.25" />
                          <stop offset="100%" stopColor="#199874" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                      {/* Area Under Curve */}
                      <path d="M0 45 L0 38 Q 20 20, 40 32 T 80 15 L 100 8 L 100 50 L 0 50 Z" fill="url(#chart-grad)" />
                      {/* Line */}
                      <path d="M0 38 Q 20 20, 40 32 T 80 15 L 100 8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                      {/* Hover Dot */}
                      <circle cx="80" cy="15" r="3" fill="#199874" stroke="white" strokeWidth="1.5" />
                    </svg>
                  </div>

                  {/* X Axis labels */}
                  <div className="flex justify-between text-[8px] font-bold text-slate-400 mt-2 px-1">
                    <span>Mon</span>
                    <span>Wed</span>
                    <span>Fri</span>
                    <span>Sun</span>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-50">
                <h4 className="font-extrabold text-slate-900 text-sm">Real-Time Analytics</h4>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">Track performance and make smarter decisions.</p>
              </div>
            </div>

            {/* Feature 3: Team Collaboration */}
            <div className="md:col-span-2 bg-white border border-slate-200/80 rounded-3xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between min-h-[340px]">
              <div className="flex-1 flex items-center justify-center py-4">
                {/* Avatar cluster and orbit */}
                <div className="relative w-32 h-32 flex items-center justify-center">
                  {/* Central Pulse Ring */}
                  <div className="absolute w-16 h-16 rounded-full bg-teal-50 border border-teal-100 flex items-center justify-center shadow-sm">
                    <span className="text-xl font-bold animate-pulse">🤖</span>
                  </div>

                  {/* Outer Orbit Line */}
                  <div className="absolute w-28 h-28 rounded-full border border-dashed border-slate-200 animate-spin [animation-duration:25s]" />

                  {/* Orbit Nodes (Positioned absolutely around the circle) */}
                  <div className="absolute top-1 left-6 flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-amber-50 border-2 border-white shadow-md flex items-center justify-center text-xs">👨‍💻</div>
                    <span className="bg-slate-900 text-white text-[7px] font-bold px-1 py-0.5 rounded shadow mt-0.5">SEO</span>
                  </div>

                  <div className="absolute bottom-2 left-3 flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-sky-50 border-2 border-white shadow-md flex items-center justify-center text-xs">👩‍💼</div>
                    <span className="bg-slate-900 text-white text-[7px] font-bold px-1 py-0.5 rounded shadow mt-0.5">CEO</span>
                  </div>

                  <div className="absolute top-8 -right-3 flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-pink-50 border-2 border-white shadow-md flex items-center justify-center text-xs">👩‍💻</div>
                    <span className="bg-slate-900 text-white text-[7px] font-bold px-1 py-0.5 rounded shadow mt-0.5">Growth</span>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-50">
                <h4 className="font-extrabold text-slate-900 text-sm">Team Collaboration</h4>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">Keep your team aligned and productive.</p>
              </div>
            </div>

            {/* Feature 4: Task Management */}
            <div className="md:col-span-2 bg-white border border-slate-200/80 rounded-3xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between min-h-[340px]">
              <div className="space-y-2.5 flex-1 flex flex-col justify-center">
                {/* Sprint Board List */}
                <div className="border border-slate-100 bg-slate-50/50 rounded-2xl p-4 shadow-inner space-y-2.5">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-200/40">
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider">Active Sprint Actions</span>
                    <span className="bg-indigo-50 text-indigo-600 text-[7px] font-black px-1.5 py-0.5 rounded uppercase">Sprint 2</span>
                  </div>
                  
                  {/* Task 1 */}
                  <div className="flex items-center justify-between text-[10px] bg-white border border-slate-100 p-2 rounded-xl shadow-sm">
                    <span className="font-bold text-slate-700 truncate max-w-[110px]">Competitor SEO Gap Analysis</span>
                    <span className="text-[8px] bg-emerald-50 text-emerald-600 font-extrabold px-1.5 py-0.5 rounded-full border border-emerald-100">Done</span>
                  </div>

                  {/* Task 2 */}
                  <div className="flex items-center justify-between text-[10px] bg-white border border-slate-100 p-2 rounded-xl shadow-sm">
                    <span className="font-bold text-slate-700 truncate max-w-[110px]">Stripe Dunning Hooks Setup</span>
                    <span className="text-[8px] bg-amber-50 text-amber-600 font-extrabold px-1.5 py-0.5 rounded-full border border-amber-100 animate-pulse">Running</span>
                  </div>

                  {/* Task 3 */}
                  <div className="flex items-center justify-between text-[10px] bg-white border border-slate-100 p-2 rounded-xl shadow-sm opacity-60">
                    <span className="font-bold text-slate-700 truncate max-w-[110px]">Draft SEO Optimization Mailers</span>
                    <span className="text-[8px] bg-slate-100 text-slate-500 font-extrabold px-1.5 py-0.5 rounded-full">Pending</span>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-50">
                <h4 className="font-extrabold text-slate-900 text-sm">Task Management</h4>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed font-medium">Organize and monitor work effortlessly.</p>
              </div>
            </div>

            {/* Feature 5: AI-Powered Insights */}
            <div className="md:col-span-2 bg-white border border-slate-200/80 rounded-3xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between min-h-[340px]">
              <div className="space-y-3.5 flex-1 flex flex-col justify-center">
                <div className="border border-slate-100 bg-slate-50/50 rounded-2xl p-4 shadow-inner space-y-3">
                  {/* Stat 1 */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] font-bold">
                      <span className="text-slate-400">Card Payment Recovery Rate</span>
                      <span className="text-slate-800 font-extrabold">83%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-neon-lime rounded-full" style={{ width: '83%' }} />
                    </div>
                  </div>

                  {/* Stat 2 */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] font-bold">
                      <span className="text-slate-400">SEO Competitor Keyword Gap</span>
                      <span className="text-slate-800 font-extrabold">64%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-gold rounded-full" style={{ width: '64%' }} />
                    </div>
                  </div>

                  {/* Stat 3 */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] font-bold">
                      <span className="text-slate-400">Autonomous Workflow Yield</span>
                      <span className="text-slate-800 font-extrabold">91%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-teal rounded-full" style={{ width: '91%' }} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-50">
                <h4 className="font-extrabold text-slate-900 text-sm">AI-Powered Insights</h4>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">Use AI insights to improve productivity.</p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* INTERACTIVE SCAN SECTION (Pure white card in white background mode) */}
      <section id="scan-section" className="py-16 scroll-mt-20 border-b border-slate-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-3xl font-black text-slate-900">
              Run a Free Discovery Scan
            </h2>
            <p className="text-slate-500 mt-3 text-sm font-semibold">
              Enter details below. Our scraping and analysis agents will simulate sitemap crawls, competitor pricing checks, and compose score sheets.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
            {scanStep === "idle" && (
              <form onSubmit={handleStartScan} className="p-6 sm:p-8 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider">Startup Name *</label>
                    <input
                      type="text"
                      required
                      value={startupName}
                      onChange={(e) => setStartupName(e.target.value)}
                      placeholder="e.g., AcmeCorp"
                      className="w-full bg-[#f8fafc] border border-slate-200 rounded-2xl px-4 py-3.5 text-slate-900 text-sm focus:outline-none focus:border-slate-900 transition-colors"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider">Website URL (Optional)</label>
                    <input
                      type="url"
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      onBlur={() => {
                        const val = websiteUrl.trim();
                        if (val && !/^https?:\/\//i.test(val)) {
                          setWebsiteUrl(`https://${val}`);
                        }
                      }}
                      placeholder="e.g., https://acme.co"
                      className="w-full bg-[#f8fafc] border border-slate-200 rounded-2xl px-4 py-3.5 text-slate-900 text-sm focus:outline-none focus:border-slate-900 transition-colors"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider">Startup Stage</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(["Idea", "MVP", "Growth"] as const).map((stage) => (
                        <button
                          key={stage}
                          type="button"
                          onClick={() => setStartupStage(stage)}
                          className={`py-2.5 text-xs font-bold rounded-xl border transition-all ${startupStage === stage
                            ? "bg-slate-900 border-slate-900 text-white shadow"
                            : "bg-[#f8fafc] border-slate-200 text-slate-600 hover:text-slate-900"
                            }`}
                        >
                          {stage}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider">Primary Goal</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPrimaryGoal("acquisition")}
                        className={`py-2.5 px-2 text-xs font-bold rounded-xl border transition-all ${primaryGoal === "acquisition"
                          ? "bg-slate-900 border-slate-900 text-white shadow"
                          : "bg-[#f8fafc] border-slate-200 text-slate-600 hover:text-slate-900"
                          }`}
                      >
                        Acquire Customers
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrimaryGoal("retention")}
                        className={`py-2.5 px-2 text-xs font-bold rounded-xl border transition-all ${primaryGoal === "retention"
                          ? "bg-slate-900 border-slate-900 text-white shadow"
                          : "bg-[#f8fafc] border-slate-200 text-slate-600 hover:text-slate-900"
                          }`}
                      >
                        Retain Customers
                      </button>
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex justify-center">
                  <button
                    type="submit"
                    className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white font-extrabold px-8 py-4.5 rounded-2xl shadow-md transition-all flex items-center justify-center gap-2"
                  >
                    <SparklesIcon className="w-5 h-5 text-white" />
                    <span>Scan my Startup now</span>
                  </button>
                </div>
              </form>
            )}

            {scanStep === "scanning" && (
              <div className="p-6 sm:p-8 space-y-6 min-h-[350px] flex flex-col justify-between scan-line-effect-light">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-brand-teal font-extrabold tracking-wider uppercase text-xs">AI Discovery Scan In Progress</span>
                    <span className="text-slate-900 font-mono font-bold">{Math.round(scanProgress)}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-slate-900 rounded-full transition-all duration-300" style={{ width: `${scanProgress}%` }} />
                  </div>
                </div>

                <div className="flex-1 my-6 bg-slate-50 rounded-2xl p-5 border border-slate-200 font-mono text-[11px] text-slate-600 overflow-y-auto max-h-[220px] space-y-2">
                  {scanLogs.map((log, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="text-brand-teal">✓</span>
                      <span className="text-slate-800 font-bold">{log}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 text-brand-gold animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-gold" />
                    <span>Analyzing graph structures and sizing opportunities...</span>
                  </div>
                </div>

                <div className="text-center text-xs text-slate-400 font-semibold">
                  Please keep this window open. Building custom recommendation pipeline.
                </div>
              </div>
            )}

            {scanStep === "report" && (
              <div className="divide-y divide-slate-100">
                {/* Report Header */}
                <div className="p-6 sm:p-8 bg-slate-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <span className="text-[10px] text-brand-gold font-bold uppercase tracking-wider border border-brand-gold/20 bg-brand-gold/5 px-2.5 py-1 rounded-full">
                      Scan Results for {startupName}
                    </span>
                    <h3 className="text-2xl font-black text-slate-900 mt-2">AI Startup Discovery Report</h3>
                    <p className="text-xs text-slate-500 mt-1">Configured for {startupStage} stage founders, focused on {primaryGoal === 'acquisition' ? 'Customer Acquisition' : 'Customer Retention'}.</p>
                  </div>

                  <button
                    onClick={() => setScanStep("idle")}
                    className="text-xs text-slate-600 hover:text-slate-950 flex items-center gap-1 bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl transition-all shadow-sm font-bold"
                  >
                    <RefreshIcon />
                    <span>Run New Scan</span>
                  </button>
                </div>

                {/* Score Matrix */}
                <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Overall Score */}
                  <div
                    onClick={() => setSelectedScoreExplainer("health")}
                    className="bg-white border border-slate-200 rounded-2xl p-5 text-center space-y-3 cursor-pointer hover:border-brand-teal/50 hover:bg-slate-50/50 transition-all group shadow-sm"
                  >
                    <span className="text-xs text-slate-500 font-extrabold uppercase tracking-wider block">Overall Health Score</span>
                    <div className="relative inline-flex items-center justify-center">
                      <div className="w-24 h-24 rounded-full border-4 border-slate-100 border-r-brand-teal border-t-brand-teal border-b-brand-teal flex items-center justify-center shadow-inner">
                        <span className="text-3xl font-black text-slate-900">
                          {scanResult?.scores
                            ? Math.round(scanResult.scores.overall)
                            : primaryGoal === "acquisition" ? "73" : "78"}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] text-brand-teal group-hover:underline block font-bold">
                      Explain Score &raquo;
                    </span>
                  </div>

                  {/* Validation Score */}
                  <div
                    onClick={() => setSelectedScoreExplainer("validation")}
                    className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 cursor-pointer hover:border-brand-gold/50 hover:bg-slate-50/50 transition-all group shadow-sm"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-extrabold uppercase tracking-wider">Validation Index</span>
                      <span className="text-brand-gold font-black">
                        {scanResult?.scores
                          ? `${Math.round(scanResult.scores.validation)}%`
                          : startupStage === "Idea" ? "42%" : startupStage === "MVP" ? "65%" : "88%"}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-gold rounded-full"
                        style={{ width: scanResult?.scores
                          ? `${Math.round(scanResult.scores.validation)}%`
                          : startupStage === "Idea" ? "42%" : startupStage === "MVP" ? "65%" : "88%" }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed font-semibold">
                      {startupStage === "Idea"
                        ? "High risk. High density of competitors with overlapping feature positioning."
                        : "Moderate validation. Active early users, but lacks SEO footprint."}
                    </p>
                    <span className="text-[10px] text-brand-gold group-hover:underline block font-bold">
                      Explain Score &raquo;
                    </span>
                  </div>

                  {/* Growth Score */}
                  <div
                    onClick={() => setSelectedScoreExplainer("growth")}
                    className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 cursor-pointer hover:border-brand-teal/50 hover:bg-slate-50/50 transition-all group shadow-sm"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-extrabold uppercase tracking-wider">Growth Index</span>
                      <span className="text-brand-teal font-black">
                        {scanResult?.scores
                          ? `${Math.round(scanResult.scores.growth)}%`
                          : primaryGoal === "acquisition" ? "58%" : "82%"}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-teal rounded-full"
                        style={{ width: scanResult?.scores
                          ? `${Math.round(scanResult.scores.growth)}%`
                          : primaryGoal === "acquisition" ? "58%" : "82%" }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed font-semibold">
                      {primaryGoal === "acquisition"
                        ? "Slow organic traffic growth. Heavy dependency on direct/referral channels."
                        : "High retention score, but expansion opportunities remain untapped."}
                    </p>
                    <span className="text-[10px] text-brand-teal group-hover:underline block font-bold">
                      Explain Score &raquo;
                    </span>
                  </div>
                </div>

                {/* Gaps & Opportunities */}
                <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="font-extrabold text-slate-800 flex items-center gap-2 text-xs uppercase tracking-wider">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      <span>Top Gaps & Problems</span>
                    </h4>
                    <ul className="space-y-3">
                      {(scanResult?.gaps ?? [
                        {
                          title: "Weak Positioning Copy",
                          description: "Landing page doesn't highlight uniqueness. Overlap with competitors 'SyncUp' and 'ScaleEngine' is 82%.",
                        },
                      ]).map((gap, i) => (
                        <li key={i} className="bg-red-50 border border-red-100 p-3.5 rounded-xl text-xs">
                          <p className="font-extrabold text-red-950">{gap.title}</p>
                          <p className="text-slate-600 mt-1">{gap.description}</p>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-extrabold text-slate-800 flex items-center gap-2 text-xs uppercase tracking-wider">
                      <span className="w-2 h-2 rounded-full bg-brand-teal" />
                      <span>Growth Opportunities</span>
                    </h4>
                    <ul className="space-y-3">
                      {(scanResult?.opportunities ?? [
                        {
                          title: "Hero Copy optimization",
                          description: "Rewriting headings to target '30-day autonomous roadmaps' could improve conversion rate by 15%.",
                        },
                      ]).map((opp, i) => (
                        <li key={i} className="bg-[#199874]/5 border border-brand-teal/10 p-3.5 rounded-xl text-xs">
                          <p className="font-extrabold text-slate-900">{opp.title}</p>
                          <p className="text-slate-600 mt-1">{opp.description}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* 30-Day Growth Plan Tracker */}
                <div className="p-6 sm:p-8 space-y-6">
                  <div>
                    <h4 className="font-black text-slate-900 text-lg">Your Customized 30-Day Action Roadmap</h4>
                    <p className="text-xs text-slate-500 mt-1">Sequenced tasks based on impact, complexity, and resource footprint. Approve or ignore to shape execution.</p>
                  </div>

                  <div className="space-y-4">
                    {planTasks.map((task) => (
                      <div
                        key={task.id}
                        className={`p-4 rounded-xl border transition-all ${task.status === "approved"
                          ? "bg-[#199874]/5 border-brand-teal/30"
                          : task.status === "ignored"
                            ? "bg-slate-50 border-slate-100 opacity-55"
                            : "bg-white border-slate-200/80 shadow-sm"
                          }`}
                      >
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-brand-gold uppercase tracking-wider">{task.week}</span>
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                            <span className="text-[10px] text-slate-500 font-extrabold bg-slate-100 px-2.5 py-1 rounded-full">{task.agent}</span>
                          </div>

                          {task.status === "pending" && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleIgnoreTask(task.id)}
                                className="text-[11px] text-slate-500 hover:text-slate-950 bg-slate-100 px-2.5 py-1.5 rounded-lg transition-colors font-bold"
                              >
                                Ignore
                              </button>
                              <button
                                onClick={() => handleStartEditTask(task.id, task.title)}
                                className="text-[11px] text-brand-gold hover:underline bg-brand-gold/5 border border-brand-gold/15 px-2.5 py-1.5 rounded-lg transition-colors font-bold"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleApproveTask(task.id)}
                                className="text-[11px] bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-1.5 rounded-lg transition-colors font-extrabold shadow-sm"
                              >
                                Approve
                              </button>
                            </div>
                          )}

                          {task.status === "approved" && (
                            <div className="flex items-center gap-1.5 text-xs text-brand-teal font-extrabold bg-[#199874]/10 px-3 py-1 rounded-full border border-brand-teal/20 shadow-sm">
                              <CheckIcon className="w-3.5 h-3.5" />
                              <span>Approved — Draft Scheduled</span>
                            </div>
                          )}

                          {task.status === "ignored" && (
                            <div className="text-xs text-slate-400 font-bold bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                              Ignored
                            </div>
                          )}
                        </div>

                        {editingTaskId === task.id ? (
                          <div className="mt-3 flex gap-2">
                            <input
                              type="text"
                              value={editingTaskText}
                              onChange={(e) => setEditingTaskText(e.target.value)}
                              className="flex-1 bg-white border border-brand-gold rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none"
                            />
                            <button
                              onClick={() => handleSaveEditTask(task.id)}
                              className="bg-brand-gold text-white font-bold px-4 py-2 rounded-xl text-xs shadow transition-colors"
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <h5 className="font-extrabold text-slate-900 text-base mt-2">{task.title}</h5>
                        )}

                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">{task.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* GET STARTED IN 3 SIMPLE STEPS SECTION (Styled exactly like image) */}
      <section className="py-20 border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">

          <div className="max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">
              Get started in 3 simple steps
            </h2>
            <p className="text-xs text-slate-500 mt-3 font-semibold leading-relaxed">
              Built to help service leaders scale efficiency and deliver exceptional support through intelligent AI automation.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left items-stretch">

            {/* Step 1: Sign Up & Setup */}
            <div className="bg-white border border-slate-200/80 rounded-3xl p-6 shadow-sm flex flex-col justify-between min-h-[300px] hover:shadow-md transition-shadow">
              <div className="space-y-4">
                {/* Simulated Quick Signup form */}
                <div className="border border-slate-100 bg-slate-50 rounded-2xl p-4 space-y-3 shadow-inner">
                  <div className="bg-white border border-slate-200 rounded-xl py-2 px-3 text-center text-[10px] font-bold text-slate-600 flex items-center justify-center gap-1.5 shadow-sm cursor-pointer hover:bg-slate-50 transition-all">
                    <span>Google Icon</span>
                    <span>Continue with Google</span>
                  </div>
                  <div className="text-center text-[8px] text-slate-400 font-bold uppercase tracking-wider">Or</div>
                  <div className="flex gap-2">
                    <input type="text" placeholder="Enter your email address..." disabled className="flex-1 bg-white border border-slate-100 rounded-lg px-2.5 py-2 text-[9px] text-slate-400 focus:outline-none" />
                    <button type="button" disabled className="bg-slate-900 text-white rounded-lg px-3 py-2 text-[9px] font-bold">Signup</button>
                  </div>
                </div>
              </div>
              <div className="pt-6 space-y-1">
                <span className="text-[10px] font-black text-brand-gold uppercase tracking-widest block">Step 1</span>
                <h4 className="font-extrabold text-slate-900 text-base">Sign Up & Setup</h4>
                <p className="text-[11px] text-slate-500 leading-relaxed mt-1 font-semibold">
                  Create your account, customize your workspace, and select the primary goal.
                </p>
              </div>
            </div>

            {/* Step 2: Build & Automate */}
            <div className="bg-white border border-slate-200/80 rounded-3xl p-6 shadow-sm flex flex-col justify-between min-h-[300px] hover:shadow-md transition-shadow">
              <div className="space-y-4">
                {/* Simulated Affiliate link generator */}
                <div className="border border-slate-100 bg-slate-50 rounded-2xl p-4 space-y-3 shadow-inner">
                  <span className="text-[8px] font-bold text-slate-400 block uppercase tracking-wider">Affiliate Tracking link</span>
                  <div className="bg-white border border-slate-100 rounded-xl p-2.5 flex items-center justify-between text-[9px] text-slate-600 font-bold shadow-sm">
                    <span className="truncate">growthsaarthi.ai/ref=910</span>
                    <span className="text-brand-teal font-extrabold cursor-pointer">Copy link</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input type="checkbox" checked disabled className="accent-brand-teal" />
                    <span className="text-[8px] font-bold text-slate-500">Auto-tracking enabled</span>
                  </div>
                  <button type="button" disabled className="w-full bg-slate-900 text-white rounded-lg py-2.5 text-[9px] font-bold">Save & Continue</button>
                </div>
              </div>
              <div className="pt-6 space-y-1">
                <span className="text-[10px] font-black text-brand-gold uppercase tracking-widest block">Step 2</span>
                <h4 className="font-extrabold text-slate-900 text-base">Build & Automate</h4>
                <p className="text-[11px] text-slate-500 leading-relaxed mt-1 font-semibold">
                  Integrate your tracking pixel, or let AI agents publish optimized content.
                </p>
              </div>
            </div>

            {/* Step 3: Track, Optimize & Scale */}
            <div className="bg-white border border-slate-200/80 rounded-3xl p-6 shadow-sm flex flex-col justify-between min-h-[300px] hover:shadow-md transition-shadow">
              <div className="space-y-4 flex-1 flex flex-col justify-center items-center">
                {/* Speedometer progress bar */}
                <div className="relative w-28 h-28 flex items-center justify-center">
                  <div className="w-24 h-24 rounded-full border-4 border-slate-100 border-t-neon-lime border-r-neon-lime flex flex-col items-center justify-center shadow-inner">
                    <span className="text-xs text-slate-400 font-bold">Progress</span>
                    <span className="text-lg font-black text-slate-800">78%</span>
                  </div>
                </div>
              </div>
              <div className="pt-6 space-y-1">
                <span className="text-[10px] font-black text-brand-gold uppercase tracking-widest block">Step 3</span>
                <h4 className="font-extrabold text-slate-900 text-base">Track, Optimize & Scale</h4>
                <p className="text-[11px] text-slate-500 leading-relaxed mt-1 font-semibold">
                  Monitor raw traffic parameters, organic indexing keyword volumes, and scale conversions.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* TRUST LADDER SECTION */}
      <section id="trust-ladder" className="py-20 border-b border-slate-100 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-6 text-left">
              <span className="text-xs text-brand-gold uppercase tracking-wider font-extrabold">Safety & Control</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 leading-tight">
                Control autonomy with the <br />
                <span className="gradient-text-teal-green">Staged Trust Ladder</span>
              </h2>
              <p className="text-slate-600 leading-relaxed text-sm">
                We know founders are protective of their customer-facing copy and setups. That's why GrowthSaarthi operates on a trust ladder. Trust is earned per agent, ensuring you never wake up to an unintended billing configuration change or social post.
              </p>

              {/* Slider Controls */}
              <div className="space-y-4 pt-4">
                <div className="flex justify-between text-[10px] font-extrabold text-slate-500 tracking-wider">
                  <span>LEVEL 1: SUGGEST</span>
                  <span>LEVEL 2: DRAFT</span>
                  <span>LEVEL 3: CONFIRM</span>
                  <span>LEVEL 4: AUTOPILOT</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="4"
                  value={trustLevel}
                  onChange={(e) => setTrustLevel(parseInt(e.target.value))}
                  className="w-full accent-slate-900 bg-slate-200 h-2 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                  <span>Suggest Only</span>
                  <span>Draft in App</span>
                  <span>Push Notification Gates</span>
                  <span>Guarded Execution</span>
                </div>
              </div>
            </div>

            {/* Dynamic Card Display based on Level */}
            <div className="bg-white border border-slate-200 p-6 sm:p-8 rounded-3xl shadow-sm relative">
              <div className="absolute top-4 right-4 bg-[#199874]/10 text-brand-teal text-xs px-2.5 py-1.5 rounded-full font-extrabold border border-brand-teal/20">
                {trustLadderDetails[trustLevel - 1].timeline}
              </div>
              <span className="text-[10px] text-brand-gold font-bold uppercase tracking-wider block">Ladder Stage</span>
              <h3 className="text-xl font-extrabold text-slate-900 mt-1">
                {trustLadderDetails[trustLevel - 1].name}
              </h3>

              <div className="mt-6 space-y-4 text-xs">
                <div>
                  <p className="text-slate-700 font-bold">How it operates:</p>
                  <p className="text-slate-500 mt-1 leading-relaxed">{trustLadderDetails[trustLevel - 1].desc}</p>
                </div>

                <div className="bg-[#f8fafc] p-4 rounded-2xl border border-slate-100">
                  <p className="text-brand-gold font-bold uppercase tracking-wider text-[9px]">Execution Example:</p>
                  <p className="text-slate-600 mt-1 italic font-mono">"{trustLadderDetails[trustLevel - 1].example}"</p>
                </div>

                <div className="flex items-center gap-2 pt-2 text-brand-teal">
                  <ShieldCheckIcon />
                  <span className="font-semibold text-slate-600">
                    Risk Assessment: <strong className="text-brand-teal">{trustLadderDetails[trustLevel - 1].risk}</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CONTINUOUS MONITORING FEATURE */}
      <section id="features" className="py-20 border-b border-slate-100 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="text-xs text-brand-gold uppercase tracking-wider font-extrabold">24/7 Monitoring Schedules</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mt-2">
              Continuous vigilance, <br />
              <span className="gradient-text-teal-green">never manual checking</span>
            </h2>
            <p className="text-slate-600 mt-4 leading-relaxed text-sm">
              We monitor different layers of your business on schedules optimized for their rate of change. You don't have to manually check sitemaps or competitor pricing.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 uppercase tracking-wider font-extrabold text-[10px]">
                    <th className="p-4 sm:p-5">Data Source</th>
                    <th className="p-4 sm:p-5">Check Frequency</th>
                    <th className="p-4 sm:p-5">Why it matters</th>
                    <th className="p-4 sm:p-5">AI action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  <tr>
                    <td className="p-4 sm:p-5 font-bold text-slate-900 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-brand-teal animate-pulse" />
                      <span>Website Codebase</span>
                    </td>
                    <td className="p-4 sm:p-5"><span className="bg-brand-teal/10 text-brand-teal text-[10px] px-2.5 py-1 rounded-full font-extrabold">Daily</span></td>
                    <td className="p-4 sm:p-5 text-slate-500">Catch SEO code drift, broken redirect links, and load time spikes.</td>
                    <td className="p-4 sm:p-5 font-mono text-[11px] text-brand-gold font-bold">Alerts dashboard & maps fixes</td>
                  </tr>
                  <tr>
                    <td className="p-4 sm:p-5 font-bold text-slate-900 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-brand-teal animate-pulse" />
                      <span>Analytics (GA4/PostHog)</span>
                    </td>
                    <td className="p-4 sm:p-5"><span className="bg-brand-teal/10 text-brand-teal text-[10px] px-2.5 py-1 rounded-full font-extrabold">Daily</span></td>
                    <td className="p-4 sm:p-5 text-slate-500">Detect sudden drop-offs in activation rate and source conversion anomalies.</td>
                    <td className="p-4 sm:p-5 font-mono text-[11px] text-brand-gold font-bold">Re-ranks roadmap focus</td>
                  </tr>
                  <tr>
                    <td className="p-4 sm:p-5 font-bold text-slate-900 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-brand-teal animate-pulse" />
                      <span>Competitor Footprint</span>
                    </td>
                    <td className="p-4 sm:p-5"><span className="bg-brand-gold/10 text-brand-gold text-[10px] px-2.5 py-1 rounded-full font-extrabold">Weekly</span></td>
                    <td className="p-4 sm:p-5 text-slate-500">Flags competitor pricing changes, product releases, or positioning overhauls.</td>
                    <td className="p-4 sm:p-5 font-mono text-[11px] text-brand-gold font-bold">Drafts competitor positioning gap briefs</td>
                  </tr>
                  <tr>
                    <td className="p-4 sm:p-5 font-bold text-slate-900 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-brand-teal animate-pulse" />
                      <span>SEO Keywords & Rankings</span>
                    </td>
                    <td className="p-4 sm:p-5"><span className="bg-brand-gold/10 text-brand-gold text-[10px] px-2.5 py-1 rounded-full font-extrabold">Weekly</span></td>
                    <td className="p-4 sm:p-5 text-slate-500">Tracks keyword indexation movements. Daily checks are redundant due to crawl delays.</td>
                    <td className="p-4 sm:p-5 font-mono text-[11px] text-brand-gold font-bold">Triggers content engine ideas</td>
                  </tr>
                  <tr>
                    <td className="p-4 sm:p-5 font-bold text-slate-900 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-brand-teal animate-pulse" />
                      <span>Revenue & Stripe</span>
                    </td>
                    <td className="p-4 sm:p-5"><span className="bg-red-100 text-red-600 text-[10px] px-2.5 py-1 rounded-full font-extrabold">Real-time</span></td>
                    <td className="p-4 sm:p-5 text-slate-500">Immediate response to failed payments, trial cancellations, or chargebacks.</td>
                    <td className="p-4 sm:p-5 font-mono text-[11px] text-brand-gold font-bold">Triggers churn campaigns</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING SECTION (Exactly modeled after Simple Transparent Pricing in image) */}
      <section id="pricing-section" className="py-20 scroll-mt-20 border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">

          <div className="max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">
              Simple transparent pricing
            </h2>
            <p className="text-xs text-slate-500 mt-3 font-semibold leading-relaxed">
              Choose a plan that fits your team and start automating your workflows with ease.
            </p>

            {/* Monthly/Yearly Toggle */}
            <div className="mt-8 flex items-center justify-center gap-3">
              <span className={`text-xs ${!isAnnual ? 'text-slate-900 font-bold' : 'text-slate-400'}`}>Monthly</span>
              <button
                onClick={() => setIsAnnual(!isAnnual)}
                className="w-12 h-6 bg-slate-200 border border-slate-300 rounded-full p-1 relative transition-colors duration-200"
              >
                <div className={`w-4 h-4 rounded-full bg-slate-800 transition-all duration-200 ${isAnnual ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
              <span className={`text-xs flex items-center gap-1.5 ${isAnnual ? 'text-slate-900 font-bold' : 'text-slate-400'}`}>
                <span>Yearly</span>
                <span className="bg-brand-gold/15 text-brand-gold text-[9px] font-bold px-2 py-0.5 rounded-full border border-brand-gold/20">
                  Save 20%
                </span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch max-w-5xl mx-auto">

            {/* Starter Plan */}
            <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 flex flex-col justify-between space-y-6 hover:shadow-md transition-shadow text-left">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900">Starter Plan</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">For freelancers and small teams</p>
                </div>
                <div className="flex items-baseline gap-0.5 pt-2">
                  <span className="text-3xl font-black text-slate-900">${isAnnual ? "39.00" : "49.00"}</span>
                  <span className="text-[10px] text-slate-500 font-bold">/ yearly</span>
                </div>
                <button className="w-full py-3.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs shadow transition-all">
                  Get Started
                </button>
                <div className="w-full h-[1px] bg-slate-100" />
                <ul className="space-y-3.5 text-xs text-slate-600 font-medium">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
                    <span>Basic task management</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
                    <span>Limited automation workflows</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
                    <span>Team collaboration</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
                    <span>Basic analytics</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
                    <span>Email support</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Professional Plan (Featured - Dark Card with Lime highlights) */}
            <div className="bg-[#0f172a] rounded-3xl p-6 sm:p-8 flex flex-col justify-between space-y-6 shadow-xl text-left scale-100 lg:scale-105 relative">
              <div className="absolute top-0 right-8 -translate-y-1/2 bg-neon-lime text-slate-900 text-[8px] uppercase tracking-widest font-black px-3.5 py-1.5 rounded-full shadow-sm">
                Popular
              </div>
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-black text-white">Professional Plan</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">For growing organizations</p>
                </div>
                <div className="flex items-baseline gap-0.5 pt-2">
                  <span className="text-3xl font-black text-white">${isAnnual ? "259.00" : "299.00"}</span>
                  <span className="text-[10px] text-slate-400 font-bold">/ yearly</span>
                </div>
                <button className="w-full py-3.5 rounded-full bg-neon-lime hover:bg-[#b0df48] text-slate-900 font-black text-xs transition-all shadow-sm">
                  Get Started
                </button>
                <div className="w-full h-[1px] bg-slate-800" />
                <ul className="space-y-3.5 text-xs text-slate-300 font-medium">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-neon-lime" />
                    <span>Everything in Starter</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-neon-lime" />
                    <span>Unlimited users</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-neon-lime" />
                    <span>Custom automation rules</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-neon-lime" />
                    <span>Advanced analytics</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-neon-lime" />
                    <span>Dedicated support</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Enterprise Plan */}
            <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 flex flex-col justify-between space-y-6 hover:shadow-md transition-shadow text-left">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900">Enterprise Plan</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">For large organizations</p>
                </div>
                <div className="flex items-baseline gap-0.5 pt-2">
                  <span className="text-3xl font-black text-slate-900">${isAnnual ? "900.00" : "990.00"}</span>
                  <span className="text-[10px] text-slate-500 font-bold">/ yearly</span>
                </div>
                <button className="w-full py-3.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs shadow transition-all">
                  Get Started
                </button>
                <div className="w-full h-[1px] bg-slate-100" />
                <ul className="space-y-3.5 text-xs text-slate-600 font-medium">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
                    <span>Unlimited task management</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
                    <span>Real-time analytics</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
                    <span>Priority support</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
                    <span>Unlimited users</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
                    <span>Full automation suite</span>
                  </li>
                </ul>
              </div>
            </div>

          </div>

          {/* Need custom solution footer card */}
          <div className="mt-12 bg-slate-900 text-white border border-slate-800 rounded-3xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 max-w-5xl mx-auto shadow-md">
            <div className="text-left">
              <h4 className="font-extrabold text-base">Need a custom automate solution?</h4>
              <p className="text-xs text-slate-400 mt-0.5">We can build custom agent pipelines specifically for your legacy data structures.</p>
            </div>
            <button type="button" className="bg-white hover:bg-slate-50 text-slate-900 font-extrabold text-xs px-6 py-3 rounded-full shadow transition-all">
              Contact Us
            </button>
          </div>

        </div>
      </section>

      {/* TESTIMONIAL SECTION */}
      <section className="py-20 border-b border-slate-100">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs text-brand-gold uppercase tracking-wider font-extrabold">Founder Success Stories</span>
          <h2 className="text-3xl font-extrabold text-slate-900 mt-2">
            Trusted by founders building <span className="gradient-text-teal-green">the future</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          <div className="bg-white border border-slate-200 p-6 sm:p-8 rounded-3xl shadow-sm space-y-4 hover:shadow-md transition-shadow text-left">
            <p className="text-xs text-slate-600 italic leading-relaxed">
              "Within 10 days of connecting GrowthSaarthi, the SEO agent spotted 3 critical keyword gaps where our primary competitor ranked #1 but had zero content depth. We approved the auto-generated drafts, and our organic acquisition increased by 38% inside the month."
            </p>
            <div className="flex items-center gap-3 pt-2">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-black text-slate-700 border border-slate-200 text-xs">
                AR
              </div>
              <div>
                <h4 className="font-extrabold text-slate-900 text-xs">Alex Rivera</h4>
                <p className="text-[10px] text-slate-400 font-semibold">Co-founder, SaaSify</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 p-6 sm:p-8 rounded-3xl shadow-sm space-y-4 hover:shadow-md transition-shadow text-left">
            <p className="text-xs text-slate-600 italic leading-relaxed">
              "We were losing about 4% of our subscription revenue to failed card payments without even knowing. GrowthSaarthi's Stripe integrations auto-provisioned recovery hooks and dunned users without spamming them. It paid for itself in week two."
            </p>
            <div className="flex items-center gap-3 pt-2">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-black text-slate-700 border border-slate-200 text-xs">
                SC
              </div>
              <div>
                <h4 className="font-extrabold text-slate-900 text-xs">Sarah Chen</h4>
                <p className="text-[10px] text-slate-400 font-semibold">Founder, FlowState</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 py-12 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 sm:grid-cols-4 gap-8 text-left">
          <div className="sm:col-span-2 space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center p-1.5 overflow-hidden shadow-sm">
                <Image
                  src="/logo.png"
                  alt="GrowthSaarthi Logo"
                  fill
                  className="object-contain p-1.5"
                />
              </div>
              <div>
                <span className="font-extrabold text-lg text-slate-900">GrowthSaarthi</span>
                <span className="text-[9px] uppercase tracking-wider text-brand-teal font-extrabold block -mt-1">
                  Your AI Chief of Staff
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-500 max-w-xs leading-relaxed font-medium">
              GrowthSaarthi connects startup tools, builds operational knowledge graphs, and guides founders through acquisition and retention with autonomous, trust-gated AI agents.
            </p>
            <p className="text-[10px] text-slate-400 font-semibold">
              &copy; {new Date().getFullYear()} GrowthSaarthi. All rights reserved.
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">Product Features</h4>
            <ul className="space-y-2 text-xs text-slate-500 font-medium">
              <li><Link href="/auth" className="hover:text-slate-900 transition-colors">AI Discovery Scan</Link></li>
              <li><a href="#features-section" className="hover:text-slate-900 transition-colors">Multi-Agent Engine</a></li>
              <li><a href="#trust-ladder" className="hover:text-slate-900 transition-colors">Staged Trust Ladder</a></li>
              <li><a href="#features" className="hover:text-slate-900 transition-colors">24/7 Monitoring</a></li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">Company & Legal</h4>
            <ul className="space-y-2 text-xs text-slate-500 font-medium">
              <li><a href="#" className="hover:text-slate-900 transition-colors">About Us</a></li>
              <li><a href="#" className="hover:text-slate-900 transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="hover:text-slate-900 transition-colors">Terms of Service</a></li>
              <li><a href="#" className="hover:text-slate-900 transition-colors">SOC2 Compliance</a></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
