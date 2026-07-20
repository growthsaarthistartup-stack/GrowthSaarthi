"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

interface Task {
  id: number;
  recId: string;
  week: string;
  title: string;
  detail: string;
  status: "pending" | "approved" | "edited" | "ignored";
  source: string;
  metric: string;
  agent: string;
}

interface ScoreMatrix {
  overall: number;
  validation: number;
  growth: number;
  technical: number;
}

interface Brand {
  name: string;
  url: string;
  stage: string;
  goal: string;
  markets: string[];
  scores: ScoreMatrix;
  gaps: { title: string; description: string }[];
  opportunities: { title: string; description: string }[];
  tasks: Task[];
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  
  // Navigation Sidebar active tab
  const [activeTab, setActiveTab] = useState<"brand_create" | "overview" | "seo" | "competitors" | "blogs" | "socials">("brand_create");
  
  // Brand creation flow state: "input" | "step1" | "step2" | "step3" | "running" | "ready"
  const [createState, setCreateState] = useState<"input" | "step1" | "step2" | "step3" | "running" | "ready">("input");
  
  // Inputs collected
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [startupName, setStartupName] = useState("");
  const [describeAnswer, setDescribeAnswer] = useState<string>("");
  const [fixAnswer, setFixAnswer] = useState<string>("");
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>(["English (US)"]);
  const [searchMarket, setSearchMarket] = useState("");

  // Agent execution progress states
  const [scanProgress, setScanProgress] = useState(0);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [activeAgentMessage, setActiveAgentMessage] = useState("");
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Multi-brand state
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeBrandIndex, setActiveBrandIndex] = useState<number>(-1);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Derived discovery results state
  const activeBrand = activeBrandIndex >= 0 ? brands[activeBrandIndex] : null;
  const scores = activeBrand?.scores ?? { overall: 0, validation: 0, growth: 0, technical: 0 };
  const gaps = activeBrand?.gaps ?? [];
  const opportunities = activeBrand?.opportunities ?? [];
  const tasks = activeBrand?.tasks ?? [];

  // Selected task for draft review
  const [activeDraftTask, setActiveDraftTask] = useState<Task | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [draftTitle, setDraftTitle] = useState("");

  // Check auth session on load
  useEffect(() => {
    const session = localStorage.getItem("gs_user");
    if (!session) {
      router.push("/auth");
    } else {
      const parsed = JSON.parse(session);
      setUser(parsed);
      setStartupName(parsed.name ? `${parsed.name} Corp` : "My Startup");
    }
  }, [router]);

  // Handle Switch Brand
  const handleSwitchBrand = (idx: number) => {
    setActiveBrandIndex(idx);
    setCreateState("ready");
    setActiveTab("overview");
    setIsDropdownOpen(false);
  };

  // Reset wizard to create another brand
  const handleCreateNewBrand = () => {
    setWebsiteUrl("");
    setStartupName(user?.name ? `${user.name} Corp` : "My Startup");
    setDescribeAnswer("");
    setFixAnswer("");
    setSelectedMarkets(["English (US)"]);
    setScanProgress(0);
    setScanLogs([]);
    setCreateState("input");
    setActiveTab("brand_create");
    setIsDropdownOpen(false);
  };

  // Handle Starting Website Scraping & Agents Workflow
  const handleStartAgents = () => {
    setCreateState("running");
    setScanProgress(0);
    setScanLogs([]);
    setActiveAgentMessage("Spawning Website Scraper Agent...");

    const messages = [
      { prg: 10, log: "Initiating GrowthSaarthi Discovery Scan for " + startupName + "..." },
      { prg: 20, log: "[website-scraper] playwright_fetch() initiated for " + (websiteUrl || "industry databases") },
      { prg: 35, log: "[website-scraper] Crawling sitemaps, extracting metadata & headings (H1: 'Next-Gen Growth SaaS')." },
      { prg: 50, log: "[competitor-agent] Running vector similarity matches on SerpApi competitor results..." },
      { prg: 65, log: "[seo-agent] Scanning keyword density parameters, GSC indexation rules..." },
      { prg: 80, log: "[seo-analysis-agent] Structuring recommendations, validating graph constraints..." },
      { prg: 90, log: "[plan-sequencer] Mapping dependencies and ordering 30-day growth plan..." },
      { prg: 100, log: "Discovery scan successfully completed. Graph facts registered." }
    ];

    let currentStepIndex = 0;
    
    // Simulate SSE progress streaming
    progressTimerRef.current = setInterval(() => {
      if (currentStepIndex < messages.length) {
        const step = messages[currentStepIndex];
        setScanProgress(step.prg);
        setScanLogs(prev => [...prev, step.log]);
        
        // Dynamic active status messages
        if (step.prg < 35) {
          setActiveAgentMessage("Webscraping is done by our website-scraper agent. Crawling elements...");
        } else if (step.prg < 60) {
          setActiveAgentMessage("Competitor discovery agent analyzing positioning overlaps...");
        } else if (step.prg < 80) {
          setActiveAgentMessage("SEO recommendation agent running semantic keyword scans...");
        } else {
          setActiveAgentMessage("Orchestrator building your custom 30-day action roadmap...");
        }

        currentStepIndex++;
      } else {
        if (progressTimerRef.current) clearInterval(progressTimerRef.current);
        
        // Fetch results via API POST (which falls back gracefully to high-quality mock data)
        fetch("/api/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startupName,
            websiteUrl,
            stage: describeAnswer === "Idea" ? "Idea" : describeAnswer === "MVP" ? "MVP" : "Growth",
            primaryGoal: fixAnswer.includes("ads") || fixAnswer.includes("hooks") ? "acquisition" : "retention"
          })
        })
        .then(res => res.json())
        .then(data => {
          if (data.ok) {
            const newBrand: Brand = {
              name: startupName,
              url: websiteUrl || "devsking.com",
              stage: describeAnswer || "E-commerce",
              goal: fixAnswer || "Growth",
              markets: selectedMarkets,
              scores: data.scores,
              gaps: data.gaps,
              opportunities: data.opportunities,
              tasks: data.plan
            };
            setBrands(prev => {
              const updated = [...prev, newBrand];
              setActiveBrandIndex(updated.length - 1);
              return updated;
            });
            setCreateState("ready");
            setActiveTab("overview");
          }
        })
        .catch(() => {
          // Fallback Brand
          const fallbackBrand: Brand = {
            name: startupName,
            url: websiteUrl || "devsking.com",
            stage: describeAnswer || "E-commerce",
            goal: fixAnswer || "Growth",
            markets: selectedMarkets,
            scores: { overall: 76, validation: 65, growth: 58, technical: 72 },
            gaps: [
              {
                title: "Value Proposition Overlap",
                description: `Your value proposition significantly overlaps with competitors. High risk of search impression loss. Clear differentiation is required.`,
              },
              {
                title: "SEO Indexation Gap",
                description: `Lack of structured content keywords. Major search engines are not indexing organic search pages for key search intents.`,
              }
            ],
            opportunities: [
              {
                title: "Landing Page Copy Optimization",
                description: "Re-writing product copy and CTAs can increase your signup conversions by up to 15%.",
              },
              {
                title: "Competitor Keyword Capture",
                description: "Targeting gap keywords present on competitors' blogs can capture high-intent organic traffic.",
              }
            ],
            tasks: [
              {
                id: 1,
                recId: "rec_1",
                week: "Week 1",
                title: "Optimize Landing Page Hero Copy for SEO",
                detail: "Replace current header copy with a benefit-driven statement targeting your primary audience keywords. Agent has drafted a custom copy.",
                status: "pending" as const,
                source: "Website Scraper Agent: Identified weak CTA alignment and missing H1 keywords.",
                metric: "Target: Conversion Rate (+18%)",
                agent: "Content Agent",
              },
              {
                id: 2,
                recId: "rec_2",
                week: "Week 1",
                title: "Implement Stripe Churn Recovery",
                detail: "Create an automatic email sequence triggered when payments fail. Recovers lost MRR without manual intervention.",
                status: "pending" as const,
                source: "Revenue Agent: Churn rates increased by 2.8% due to payment failures last month.",
                metric: "Target: Customer Churn (-4%)",
                agent: "Revenue Agent",
              },
              {
                id: 3,
                recId: "rec_3",
                week: "Week 2",
                title: "Publish Blog Post Targeting Competitor Keyword Gaps",
                detail: "Draft and publish a high-quality article targeting keywords your competitors rank for but you are missing. Agent has drafted a blog post.",
                status: "pending" as const,
                source: "SEO Agent: Found 3 high-volume keywords dominated by competitor domains.",
                metric: "Target: Organic Traffic (+12%)",
                agent: "SEO Agent",
              },
              {
                id: 4,
                recId: "rec_4",
                week: "Week 3",
                title: "Configure Conversion Event Tracking in GA4",
                detail: "Setup explicit tracking for signup button clicks and purchase success pages to map the conversion funnel correctly.",
                status: "pending" as const,
                source: "Orchestrator: Missing conversions data stream in GA4 config.",
                metric: "Target: Funnel Visibility (100%)",
                agent: "SEO & Integration Agent",
              },
              {
                id: 5,
                recId: "rec_5",
                week: "Week 4",
                title: "Run LinkedIn Thought Leadership Campaign",
                detail: "Publish a series of 3 short posts on LinkedIn establishing authority in your niche. Agent has drafted the social copy.",
                status: "pending" as const,
                source: "Competitor Agent: Top competitors drive 15% of traffic through LinkedIn organic content.",
                metric: "Target: Referral Traffic (+22%)",
                agent: "Competitor Agent",
              }
            ]
          };
          setBrands(prev => {
            const updated = [...prev, fallbackBrand];
            setActiveBrandIndex(updated.length - 1);
            return updated;
          });
          setCreateState("ready");
          setActiveTab("overview");
        });
      }
    }, 1000);
  };

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, []);

  // Handle Task Action (Approve / Ignore / Edit)
  const handleTaskStatusChange = (id: number, nextStatus: "approved" | "ignored") => {
    if (activeBrandIndex < 0) return;

    setBrands(prev => {
      return prev.map((brand, idx) => {
        if (idx !== activeBrandIndex) return brand;
        const updatedTasks = brand.tasks.map(t => 
          t.id === id ? { ...t, status: nextStatus } : t
        );
        return { ...brand, tasks: updatedTasks };
      });
    });

    const activeBrandData = brands[activeBrandIndex];
    if (activeBrandData) {
      const approvedTask = activeBrandData.tasks.find(t => t.id === id);
      if (approvedTask && nextStatus === "approved") {
        // Auto-generate content draft based on task type
        let generatedContent = "";
        let generatedTitle = approvedTask.title;

        if (approvedTask.agent.includes("Content") || approvedTask.agent.includes("SEO")) {
          if (approvedTask.title.toLowerCase().includes("hero")) {
            generatedTitle = "Website Hero Section Copy Draft";
            generatedContent = `[Landing Page Copy Revision]
Target Keywords: startup growth platform, automated playbooks

--- H1 Tag (Proposed Update) ---
"Autopilot your startup's growth loops in minutes."

--- H2 Subheading (Proposed Update) ---
"GrowthSaarthi automatically connects your marketing tools, uncovers competitor positioning gaps, and launches high-converting campaigns with autonomous AI agents."

--- Primary Call to Action Button ---
"Claim Your Live Growth Scan"

--- Secondary Button ---
"Explore Case Studies"`;
          } else if (approvedTask.title.toLowerCase().includes("blog")) {
            generatedTitle = "SEO Article: Unlocking Autonomous Growth Autopilot";
            generatedContent = `# Unlocking Startup Growth: The Shift to Autonomous AI Autopilots

In the early stages of a startup, founders spend up to 40% of their day juggling operations instead of building products. Discover how autonomous growth systems are replacing conventional analytics dashboards.

## 1. The Death of Static Dashboards
Traditional tools like Google Analytics show you *what* happened, but never *why* or *how* to fix it. Autonomous agents bridge this gap by constantly auditing your site traffic and proposing pre-drafted adjustments.

## 2. Ingesting Live Value-Prop Data
By scraping search results and mapping competitor pricing models weekly, AI engines detect exactly where your product messaging overlaps with industry leaders.

## 3. Taking Autopilot Action Safely
With a structured "Trust Ladder", startup operators maintain full control, reviewing and approving blog articles, social posts, and meta details before anything goes live.

---
*Ready to scale? Book a demo with GrowthSaarthi to audit your website today.*`;
          } else {
            generatedTitle = "LinkedIn Post Draft: How We Built GrowthSaarthi";
            generatedContent = `🚀 Founders: Stop staring at empty dashboards. 

Traditional analytics tell you what happened. 
They don't tell you how to fix it. 

We built GrowthSaarthi to change that:
1. Scrapes competitor H1 tags & pricing tiers hourly.
2. Identifies organic search keyword gaps.
3. Automatically drafts blog posts and social content.
4. Gated by a strict "Trust Ladder" so you hit publish.

The result? Up to 15% increase in conversion rates in the first 30 days without hire costs.

👉 What is your biggest bottleneck in customer acquisition right now? Let's discuss below.

#GrowthMarketing #SaaSGrowth #FounderHack #AIAgents`;
          }
        } else if (approvedTask.agent.includes("Revenue")) {
          generatedTitle = "Customer Retention: Dunning Email Sequence";
          generatedContent = `Subject: ACTION REQUIRED: Update your billing details for [Company]

Hi {{first_name}},

We were unable to process your recent monthly payment. To prevent any interruptions to your workspace services, please take 30 seconds to update your billing profile:

[Update Billing Details Link]

If you have any questions or recently received a replacement card, feel free to reply directly to this email and our support team will help you out.

Best,
The Growth team`;
        }

        setDraftTitle(generatedTitle);
        setDraftContent(generatedContent);
        setActiveDraftTask({ ...approvedTask, status: nextStatus });
      }
    }
  };

  const handleSaveDraft = () => {
    if (activeDraftTask && activeBrandIndex >= 0) {
      setBrands(prev => {
        return prev.map((brand, idx) => {
          if (idx !== activeBrandIndex) return brand;
          const updatedTasks = brand.tasks.map(t => 
            t.id === activeDraftTask.id 
              ? { ...t, status: "approved" as const, detail: draftContent } 
              : t
          );
          return { ...brand, tasks: updatedTasks };
        });
      });
    }
    setActiveDraftTask(null);
  };

  // Toggle markets selection
  const handleMarketSelect = (market: string) => {
    setSelectedMarkets(prev => 
      prev.includes(market) ? prev.filter(m => m !== market) : [...prev, market]
    );
  };

  // Sidebar navigation elements
  const navItems = [
    { id: "brand_create", label: "Brand Create", icon: "🌐", disabled: false },
    { id: "overview", label: "Dashboard", icon: "📊", disabled: activeBrandIndex < 0 },
    { id: "seo", label: "SEO Analysis", icon: "📈", disabled: activeBrandIndex < 0 },
    { id: "competitors", label: "Competitor Insights", icon: "👥", disabled: activeBrandIndex < 0 },
    { id: "blogs", label: "Blog Drafts", icon: "✍️", disabled: activeBrandIndex < 0 },
    { id: "socials", label: "Social Drafts", icon: "📢", disabled: activeBrandIndex < 0 }
  ] as const;

  const marketsList = {
    "AMERICAS": ["English (US)", "English (Canada)", "Spanish (Mexico)", "Spanish (Argentina)", "Spanish (Colombia)", "Spanish (Chile)", "Portuguese (Brazil)", "French (Canada)"],
    "EUROPE": ["English (UK)", "Spanish (Spain)", "French (France)", "German", "Portuguese (Portugal)", "Italian", "Dutch", "Polish", "Swedish", "Norwegian", "Danish", "Finnish"]
  };

  return (
    <div className="min-h-screen bg-staggered-blocks text-slate-800 flex font-sans overflow-hidden">
      
      {/* LEFT SIDEBAR NAVBAR */}
      <aside className="w-64 bg-slate-50 border-r border-slate-200 flex flex-col justify-between shrink-0 z-10">
        <div>
          {/* Logo Section */}
          <div className="p-6 border-b border-slate-200/80 flex items-center gap-2">
            <div className="relative w-8 h-8 rounded-lg bg-white flex items-center justify-center p-1 border border-slate-200 shadow-sm">
              <Image src="/logo.png" alt="GrowthSaarthi Logo" width={24} height={24} className="object-contain" />
            </div>
            <div>
              <div className="flex items-center">
                <span className="font-extrabold text-sm tracking-tight text-slate-900">Growth</span>
                <span className="font-extrabold text-sm tracking-tight text-[#E79E24]">Saarthi</span>
              </div>
              <span className="text-[7px] uppercase tracking-widest text-[#199874] font-extrabold block -mt-1">
                Your AI Chief of Staff
              </span>
            </div>
          </div>

          {/* User Status Profile Dropdown */}
          {activeBrandIndex >= 0 && (
            <div className="relative">
              <div 
                onClick={() => setIsDropdownOpen(prev => !prev)}
                className="p-4 mx-3 my-4 bg-white hover:bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-between gap-3 cursor-pointer select-none transition-colors shadow-sm"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#199874] to-[#E79E24] flex items-center justify-center font-bold text-white text-sm shrink-0 shadow-sm">
                    {activeBrand?.url ? activeBrand.url.replace(/https?:\/\//, "").substring(0, 2).toUpperCase() : "GS"}
                  </div>
                  <div className="overflow-hidden text-left">
                    <p className="text-xs font-bold text-slate-900 truncate">{activeBrand?.url || "puravidamindbody.com"}</p>
                    <span className="text-[9px] font-bold text-[#199874] bg-[#199874]/10 px-2 py-0.5 rounded-full mt-0.5 inline-block">
                      {activeBrand?.stage || "E-commerce"}
                    </span>
                  </div>
                </div>
                <span className="text-slate-400 text-[10px] shrink-0">{isDropdownOpen ? "▲" : "▼"}</span>
              </div>

              {/* Dropdown Menu */}
              {isDropdownOpen && (
                <div className="absolute left-3 right-3 top-[calc(100%-8px)] bg-white border border-slate-200 rounded-2xl shadow-xl z-30 overflow-hidden font-sans">
                  <div className="py-1.5 divide-y divide-slate-100 max-h-60 overflow-y-auto">
                    {brands.map((brand, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSwitchBrand(idx)}
                        className={`w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-55 transition-colors ${
                          idx === activeBrandIndex ? "bg-slate-50/80" : ""
                        }`}
                      >
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#199874] to-[#E79E24] flex items-center justify-center font-extrabold text-white text-xs shrink-0 shadow-sm">
                          {brand.url.replace(/https?:\/\//, "").substring(0, 2).toUpperCase()}
                        </div>
                        <div className="overflow-hidden flex-1">
                          <p className="text-xs font-bold text-slate-900 truncate">{brand.url}</p>
                          <p className="text-[9px] text-slate-500 truncate font-bold">{brand.name}</p>
                        </div>
                        {idx === activeBrandIndex && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#199874] shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="p-2 border-t border-slate-150 bg-slate-50/50">
                    <button
                      onClick={handleCreateNewBrand}
                      className="w-full py-2 bg-[#199874]/10 hover:bg-[#199874]/20 border border-[#199874]/15 text-[#199874] rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span>+ Create New Brand</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Navigation Links */}
          <nav className="p-4 space-y-1">
            {navItems.map(item => (
              <button
                key={item.id}
                disabled={item.disabled}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                  item.disabled 
                    ? "opacity-35 cursor-not-allowed text-slate-400" 
                    : activeTab === item.id
                      ? "bg-[#199874] text-white shadow-md"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-base">{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.id === "brand_create" && activeBrandIndex >= 0 && (
                  <span className="text-[#199874] font-black text-xs bg-[#199874]/15 px-1.5 py-0.5 rounded-full">✓</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-200/80 text-center">
          <button
            onClick={() => {
              localStorage.removeItem("gs_user");
              router.push("/auth");
            }}
            className="text-[10px] text-slate-400 hover:text-slate-700 font-bold transition-colors cursor-pointer"
          >
            Logout session
          </button>
        </div>
      </aside>

      {/* MAIN CONTAINER */}
      <main className="flex-1 flex flex-col min-h-screen overflow-y-auto bg-transparent relative">
        <header className="h-16 border-b border-slate-200/80 flex items-center justify-between px-8 bg-white/80 backdrop-blur-md sticky top-0 z-20 shadow-sm">
          <h1 className="text-sm font-black tracking-wider uppercase text-slate-800">
            {activeTab === "brand_create" ? "Brand Setup Wizard" : activeTab === "overview" ? "Discovery Dashboard" : activeTab.replace("_", " ")}
          </h1>
          <div className="flex items-center gap-4 text-xs font-bold text-slate-500">
            <span>Server status: <strong className="text-[#199874]">Online</strong></span>
            {user && <span className="text-slate-800">{user.email}</span>}
          </div>
        </header>

        {/* CONTENT AREA */}
        <div className="flex-1 p-8">
          
          {/* TAB 1: BRAND CREATE */}
          {activeTab === "brand_create" && (
            <div className="max-w-3xl mx-auto py-4">
              
              {/* STATE 0: WEBSITE INPUT (Image 3 UI with brand gradient) */}
              {createState === "input" && (
                <div className="space-y-8 text-center pt-8">
                  <div className="space-y-4">
                    <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
                      Build your brand <br />
                      in <span className="bg-gradient-to-r from-[#199874] to-[#E79E24] bg-clip-text text-transparent">60 seconds.</span>
                    </h2>
                    <p className="text-slate-500 max-w-lg mx-auto text-sm font-semibold leading-relaxed">
                      Paste your store link. Our autonomous agents will scrape the landing page elements, identify top competitors, and configure marketing campaigns.
                    </p>
                  </div>

                  <div className="max-w-xl mx-auto bg-white border border-slate-200/80 p-6 rounded-3xl shadow-xl space-y-6">
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <span className="text-slate-400 text-sm">🌐</span>
                      </div>
                      <input
                        type="text"
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        placeholder="your-store.com"
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-10 pr-4 py-4 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-[#199874] focus:ring-1 focus:ring-[#199874] transition-all"
                      />
                    </div>

                    {/* Badge Tags in Brand Colors */}
                    <div className="flex flex-wrap justify-center gap-2">
                      {["Static ads", "Video ads", "Advertorials", "Marketing angles"].map((tag, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] font-extrabold px-3.5 py-1.5 rounded-full border border-slate-200 bg-slate-50 text-slate-600 shadow-sm"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-[#199874] inline-block mr-1.5 animate-pulse" />
                          {tag}
                        </span>
                      ))}
                    </div>

                    <button
                      onClick={() => {
                        if (!websiteUrl.trim()) {
                          alert("Please enter a website link first!");
                          return;
                        }
                        setCreateState("step1");
                      }}
                      className="w-full bg-gradient-to-r from-[#199874] to-[#E79E24] hover:from-[#1da881] hover:to-[#f0ab35] text-white font-extrabold py-4 rounded-2xl shadow-lg transition-all tracking-wider text-sm flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <span>Build my brand</span>
                      <span>&rarr;</span>
                    </button>
                  </div>
                </div>
              )}

              {/* STATE 1: QUESTION 1 - DESCRIBE YOU (Image 4 UI in brand colors) */}
              {createState === "step1" && (
                <div className="space-y-6 max-w-2xl mx-auto pt-6">
                  {/* Progress Indicator */}
                  <div className="flex justify-between items-center text-xs font-bold text-slate-500 px-2">
                    <span className="text-[#199874]">STEP 1 OF 3</span>
                    <span>33% Complete</span>
                  </div>
                  <div className="w-full h-1 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-[#199874] w-1/3 transition-all" />
                  </div>

                  <div className="text-center space-y-2">
                    <h2 className="text-2xl font-black text-slate-900">Which best describes you?</h2>
                    <p className="text-xs text-slate-500">This tailors your workspace, templates, and 30-day marketing plan.</p>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    {[
                      { key: "E-commerce", title: "E-commerce Brand / Store Owner", desc: "You sell physical goods via Shopify, WooCommerce, or custom checkouts." },
                      { key: "Agency", title: "Marketing Agency Operator", desc: "You manage campaigns, content pipelines, and retention setups for clients." },
                      { key: "Freelancer", title: "Freelancer / Consultant", desc: "You provide growth services, write copy, or advise growing brands." },
                      { key: "Solo", title: "Solo Founder / Creator", desc: "You run a lean business, newsletters, or digital infoproducts." }
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => setDescribeAnswer(opt.key)}
                        className={`p-4 rounded-2xl border text-left flex justify-between items-center transition-all cursor-pointer ${
                          describeAnswer === opt.key 
                            ? "bg-[#199874]/5 border-[#199874] text-slate-900 shadow-sm" 
                            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <div>
                          <p className="font-extrabold text-sm">{opt.title}</p>
                          <p className="text-xs text-slate-500 mt-1 font-semibold">{opt.desc}</p>
                        </div>
                        <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                          describeAnswer === opt.key ? "border-[#199874] bg-[#199874]" : "border-slate-350"
                        }`}>
                          {describeAnswer === opt.key && <span className="text-[10px] text-white">✓</span>}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-4 pt-4">
                    <button
                      onClick={() => setCreateState("input")}
                      className="flex-1 bg-white hover:bg-slate-55 text-slate-600 border border-slate-200 font-bold py-3.5 rounded-xl transition-all text-xs cursor-pointer shadow-sm"
                    >
                      Back
                    </button>
                    <button
                      disabled={!describeAnswer}
                      onClick={() => setCreateState("step2")}
                      className="flex-1 bg-[#199874] hover:bg-[#1ca881] disabled:opacity-50 text-white font-extrabold py-3.5 rounded-xl transition-all text-xs shadow-lg cursor-pointer"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {/* STATE 2: QUESTION 2 - OBJECTIVE CHECKLIST (Image 2 UI in brand colors) */}
              {createState === "step2" && (
                <div className="space-y-6 max-w-2xl mx-auto pt-6">
                  {/* Progress Indicator */}
                  <div className="flex justify-between items-center text-xs font-bold text-slate-500 px-2">
                    <span className="text-[#199874]">STEP 2 OF 3</span>
                    <span>66% Complete</span>
                  </div>
                  <div className="w-full h-1 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-[#199874] w-2/3 transition-all" />
                  </div>

                  <div className="text-center space-y-2">
                    <h2 className="text-2xl font-black text-slate-900">What are you here to fix?</h2>
                    <p className="text-xs text-slate-500">Pick your priority bottleneck. Our scraper will focus audits on these conversion assets.</p>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    {[
                      { key: "ads", title: "Pump Ad Creative Volume", desc: "Generate static and video script concepts for TikTok/Meta feeds weekly." },
                      { key: "hooks", title: "Test New Marketing Angles & Hooks", desc: "Inject fresh angles based on competitor data into cold traffic paths." },
                      { key: "scale", title: "Scale Existing Winning Creatives", desc: "Iterate on templates that convert, improving CTR and lowering CPC parameters." },
                      { key: "articles", title: "Write Native Advertorials & Blogs", desc: "Draft high-converting organic landing pages, blogs, and SEO keywords." }
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => setFixAnswer(opt.key)}
                        className={`p-4 rounded-2xl border text-left flex justify-between items-center transition-all cursor-pointer ${
                          fixAnswer === opt.key 
                            ? "bg-[#199874]/5 border-[#199874] text-slate-900 shadow-sm" 
                            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-55"
                        }`}
                      >
                        <div>
                          <p className="font-extrabold text-sm">{opt.title}</p>
                          <p className="text-xs text-slate-500 mt-1 font-semibold">{opt.desc}</p>
                        </div>
                        <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                          fixAnswer === opt.key ? "border-[#199874] bg-[#199874]" : "border-slate-350"
                        }`}>
                          {fixAnswer === opt.key && <span className="text-[10px] text-white">✓</span>}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-4 pt-4">
                    <button
                      onClick={() => setCreateState("step1")}
                      className="flex-1 bg-white hover:bg-slate-55 text-slate-600 border border-slate-200 font-bold py-3.5 rounded-xl transition-all text-xs cursor-pointer shadow-sm"
                    >
                      Back
                    </button>
                    <button
                      disabled={!fixAnswer}
                      onClick={() => setCreateState("step3")}
                      className="flex-1 bg-[#199874] hover:bg-[#1ca881] disabled:opacity-50 text-white font-extrabold py-3.5 rounded-xl transition-all text-xs shadow-lg cursor-pointer"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {/* STATE 3: QUESTION 3 - TARGET MARKETS (Image 5 UI in brand colors) */}
              {createState === "step3" && (
                <div className="space-y-6 max-w-3xl mx-auto pt-6">
                  {/* Progress Indicator */}
                  <div className="flex justify-between items-center text-xs font-bold text-slate-500 px-2">
                    <span className="text-[#199874]">STEP 3 OF 3</span>
                    <span>99% Complete</span>
                  </div>
                  <div className="w-full h-1 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-[#199874] w-[99%] transition-all" />
                  </div>

                  <div className="text-center space-y-2">
                    <h2 className="text-2xl font-black text-slate-900">Target Markets</h2>
                    <p className="text-xs text-slate-500 font-semibold">Select the regions/languages you want the SEO and Competitor Agents to check volume for.</p>
                  </div>

                  {/* Market Search Box */}
                  <div className="max-w-md mx-auto">
                    <input
                      type="text"
                      value={searchMarket}
                      onChange={(e) => setSearchMarket(e.target.value)}
                      placeholder="Search language or region..."
                      className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-slate-950 placeholder-slate-400 text-xs focus:outline-none focus:border-[#199874] transition-all shadow-sm"
                    />
                  </div>

                  {/* Markets Grid Section */}
                  <div className="space-y-6">
                    {Object.entries(marketsList).map(([region, list]) => {
                      const filteredList = list.filter(item => 
                        item.toLowerCase().includes(searchMarket.toLowerCase()) ||
                        region.toLowerCase().includes(searchMarket.toLowerCase())
                      );
                      
                      if (filteredList.length === 0) return null;

                      return (
                        <div key={region} className="space-y-2.5 text-left bg-white border border-slate-200 p-5 rounded-3xl shadow-sm">
                          <h4 className="text-[10px] font-black text-slate-800 tracking-wider uppercase">{region}</h4>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {filteredList.map((market) => {
                              const isSelected = selectedMarkets.includes(market);
                              return (
                                <button
                                  key={market}
                                  onClick={() => handleMarketSelect(market)}
                                  className={`py-2 px-3 text-xs font-bold rounded-xl border text-center transition-all cursor-pointer ${
                                    isSelected 
                                      ? "bg-[#199874] text-white border-[#199874] shadow-sm" 
                                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                                  }`}
                                >
                                  {market}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex gap-4 pt-4">
                    <button
                      onClick={() => setCreateState("step2")}
                      className="flex-1 bg-white hover:bg-slate-55 text-slate-600 border border-slate-200 font-bold py-3.5 rounded-xl transition-all text-xs cursor-pointer shadow-sm"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleStartAgents}
                      className="flex-1 bg-gradient-to-r from-[#199874] to-[#E79E24] hover:from-[#1da881] hover:to-[#f0ab35] text-white font-extrabold py-3.5 rounded-xl transition-all text-xs shadow-lg cursor-pointer"
                    >
                      Initialize Autonomous Scan
                    </button>
                  </div>
                </div>
              )}

              {/* STATE 4: AGENTS RUNNING & SCRAPING (Console logs + spinner) */}
              {createState === "running" && (
                <div className="max-w-2xl mx-auto space-y-6 pt-10">
                  <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-8 flex flex-col justify-between min-h-[400px] shadow-2xl relative overflow-hidden">
                    
                    {/* Glowing Top Scanning Wheel */}
                    <div className="flex flex-col items-center gap-3 text-center">
                      <div className="relative w-16 h-16 rounded-full border-4 border-slate-200 border-t-[#199874] border-r-[#E79E24] animate-spin flex items-center justify-center shadow-md">
                        <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center font-bold text-xs text-[#199874]">
                          {Math.round(scanProgress)}%
                        </div>
                      </div>
                      <div>
                        <h3 className="text-lg font-black text-slate-900">Analyzing Website & Competitors...</h3>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">{activeAgentMessage}</p>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-2">
                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-[#199874] to-[#E79E24] rounded-full transition-all duration-300" style={{ width: `${scanProgress}%` }} />
                      </div>
                    </div>

                    {/* Live Scrolling Console Logs - Developer dark theme for authenticity */}
                    <div className="flex-1 bg-slate-950 rounded-2xl p-5 border border-slate-800 font-mono text-[10px] text-slate-350 overflow-y-auto max-h-[160px] space-y-1.5 shadow-inner">
                      {scanLogs.map((log, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <span className="text-[#199874] font-extrabold shrink-0">✓</span>
                          <span className="text-slate-300 font-bold leading-relaxed">{log}</span>
                        </div>
                      ))}
                      {scanProgress < 100 && (
                        <div className="flex items-center gap-2 text-[#E79E24] animate-pulse py-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#E79E24] shrink-0" />
                          <span className="font-bold">Agents are crawling sitemaps & pulling competitors...</span>
                        </div>
                      )}
                    </div>

                    <div className="text-center text-[10px] text-slate-450 font-extrabold uppercase tracking-wider">
                      Please hold on. Preparing brand indexation dataset.
                    </div>
                  </div>
                </div>
              )}

              {/* STATE 5: SCAN COMPLETE BRAND MANAGEMENT */}
              {createState === "ready" && (
                <div className="space-y-8 text-center pt-8 max-w-2xl mx-auto">
                  <div className="space-y-3">
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight">
                      Your Created Brands
                    </h2>
                    <p className="text-slate-500 text-sm font-semibold">
                      Manage existing configured brands or initialize a discovery scan for a new one.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    {brands.map((brand, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          setActiveBrandIndex(idx);
                          setActiveTab("overview");
                        }}
                        className={`p-6 rounded-3xl border text-left cursor-pointer transition-all flex items-center justify-between ${
                          idx === activeBrandIndex
                            ? "bg-[#199874]/5 border-[#199874] text-slate-900 shadow-sm"
                            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-55"
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#199874] to-[#E79E24] flex items-center justify-center font-black text-white text-base shadow">
                            {brand.url.replace(/https?:\/\//, "").substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <h4 className="font-extrabold text-slate-900 text-sm">{brand.name}</h4>
                            <p className="text-xs text-slate-500 font-bold mt-0.5">{brand.url}</p>
                            <span className="text-[9px] font-bold text-[#199874] bg-[#199874]/10 px-2 py-0.5 rounded-full mt-1.5 inline-block">
                              {brand.stage}
                            </span>
                          </div>
                        </div>
                        {idx === activeBrandIndex && (
                          <span className="text-xs text-[#199874] font-black uppercase tracking-wider bg-[#199874]/10 px-3 py-1.5 border border-[#199874]/20 rounded-full shadow-sm">
                            Active Brand
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={handleCreateNewBrand}
                    className="w-full bg-gradient-to-r from-[#199874] to-[#E79E24] hover:from-[#1da881] hover:to-[#f0ab35] text-white font-extrabold py-4 rounded-2xl shadow-xl transition-all tracking-wider text-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>+ Create New Brand</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ACTIVE OVERVIEW */}
          {activeTab === "overview" && createState === "ready" && (
            <div className="space-y-8">
              
              {/* Header metrics card */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
                
                {/* Score matrix item 1 */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 text-center flex flex-col items-center justify-between min-h-[160px] shadow-sm">
                  <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Overall Health Score</span>
                  <div className="relative inline-flex items-center justify-center my-3">
                    <div className="w-20 h-20 rounded-full border-4 border-slate-100 border-r-[#199874] border-t-[#199874] border-b-[#199874] flex items-center justify-center shadow-inner bg-slate-50/50">
                      <span className="text-2xl font-black text-slate-900">{scores.overall}</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-[#199874] font-black">Standard Target: 85+</span>
                </div>

                {/* Score matrix item 2 */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between min-h-[160px] shadow-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Validation Index</span>
                    <span className="text-[#E79E24] font-black text-sm">{scores.validation}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden my-3">
                    <div className="h-full bg-[#E79E24] rounded-full" style={{ width: `${scores.validation}%` }} />
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                    Overlaps with 2 identified competitors. Mid-range validation risks.
                  </p>
                </div>

                {/* Score matrix item 3 */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between min-h-[160px] shadow-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Growth Index</span>
                    <span className="text-[#199874] font-black text-sm">{scores.growth}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden my-3">
                    <div className="h-full bg-[#199874] rounded-full" style={{ width: `${scores.growth}%` }} />
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                    Organic search volume lacks coverage. Needs content scaling.
                  </p>
                </div>

                {/* Score matrix item 4 */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between min-h-[160px] shadow-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Technical Index</span>
                    <span className="text-slate-800 font-black text-sm">{scores.technical}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden my-3">
                    <div className="h-full bg-slate-450 rounded-full" style={{ width: `${scores.technical}%` }} />
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                    Core Web Vitals are optimized. Speed scores are fully passing.
                  </p>
                </div>
              </div>

              {/* Core Gaps & Opportunities */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Problems Panel */}
                <div className="bg-white border border-slate-200/80 rounded-3xl p-6 space-y-4 shadow-sm">
                  <h3 className="font-extrabold text-slate-800 flex items-center gap-2 text-xs uppercase tracking-wider">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span>Top Gaps & Problems Found</span>
                  </h3>
                  <div className="space-y-3">
                    {gaps.map((gap, idx) => (
                      <div key={idx} className="bg-red-50 border border-red-100/60 p-4 rounded-2xl">
                        <h4 className="text-xs font-black text-red-900">{gap.title}</h4>
                        <p className="text-[11px] text-red-700 mt-1.5 font-bold leading-relaxed">{gap.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Opportunities Panel */}
                <div className="bg-white border border-slate-200/80 rounded-3xl p-6 space-y-4 shadow-sm">
                  <h3 className="font-extrabold text-slate-800 flex items-center gap-2 text-xs uppercase tracking-wider">
                    <span className="w-2 h-2 rounded-full bg-[#199874]" />
                    <span>Growth Opportunities Sized</span>
                  </h3>
                  <div className="space-y-3">
                    {opportunities.map((opp, idx) => (
                      <div key={idx} className="bg-emerald-50 border border-emerald-100/60 p-4 rounded-2xl">
                        <h4 className="text-xs font-black text-emerald-950">{opp.title}</h4>
                        <p className="text-[11px] text-emerald-800 mt-1.5 font-bold leading-relaxed">{opp.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Plan Checklist */}
              <div className="bg-white border border-slate-200/80 rounded-3xl p-6 space-y-6 shadow-sm">
                <div>
                  <h3 className="text-base font-black text-slate-900 font-sans">Your Customized 30-Day Growth Roadmap</h3>
                  <p className="text-xs text-slate-500 mt-1 font-semibold">Approve, edit, or ignore proposed actions. Approving triggers content agents to draft copy automatically.</p>
                </div>

                <div className="space-y-4">
                  {tasks.map(task => (
                    <div
                      key={task.id}
                      className={`p-5 rounded-2xl border transition-all ${
                        task.status === "approved"
                          ? "bg-[#199874]/5 border-[#199874]/20"
                          : task.status === "ignored"
                            ? "bg-slate-50 border-slate-200 opacity-45"
                            : "bg-white border-slate-200 hover:border-slate-350 shadow-sm"
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-3 mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-[#E79E24] uppercase tracking-wider bg-[#E79E24]/10 px-2 py-0.5 rounded-full">{task.week}</span>
                          <span className="text-[10px] font-bold text-[#199874] bg-[#199874]/10 px-2 py-0.5 rounded-full">{task.agent}</span>
                        </div>

                        {task.status === "pending" && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleTaskStatusChange(task.id, "ignored")}
                              className="text-[10px] text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl font-bold transition-all border border-slate-200 cursor-pointer"
                            >
                              Ignore
                            </button>
                            <button
                              onClick={() => handleTaskStatusChange(task.id, "approved")}
                              className="text-[10px] bg-[#199874] hover:bg-[#158263] text-white px-4 py-1.5 rounded-xl font-extrabold transition-all shadow cursor-pointer"
                            >
                              Approve
                            </button>
                          </div>
                        )}

                        {task.status === "approved" && (
                          <div className="text-[10px] text-[#199874] font-black bg-[#199874]/10 px-3 py-1.5 rounded-full border border-[#199874]/15 flex items-center gap-1.5 shadow-sm">
                            <span>✓ Approved — Content Drafted</span>
                          </div>
                        )}

                        {task.status === "ignored" && (
                          <span className="text-[10px] text-slate-400 font-bold bg-slate-100 px-3 py-1 rounded-full border border-slate-200">Ignored</span>
                        )}
                      </div>

                      <h4 className="font-extrabold text-slate-900 text-sm">{task.title}</h4>
                      <p className="text-xs text-slate-500 mt-1.5 leading-relaxed font-bold">{task.detail}</p>
                      
                      <div className="flex items-center gap-4 mt-3 text-[10px] text-slate-400 font-bold">
                        <span>{task.source}</span>
                        <span>•</span>
                        <span className="text-[#E79E24]">{task.metric}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SEO ANALYSIS */}
          {activeTab === "seo" && createState === "ready" && (
            <div className="space-y-6 max-w-4xl">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4 shadow-sm">
                <h3 className="text-base font-black text-slate-900 font-sans">Search Engine Indexation Audit</h3>
                <p className="text-xs text-slate-500 font-semibold">Analysis results from Google search queries and target keyword metrics compared with competitors.</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Domain Authority</span>
                    <strong className="text-lg font-black text-slate-800 block mt-1">24 / 100</strong>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Keywords Tracked</span>
                    <strong className="text-lg font-black text-[#199874] block mt-1">118 Organic</strong>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Keyword Gap Opportunities</span>
                    <strong className="text-lg font-black text-[#E79E24] block mt-1">12 Sized Gaps</strong>
                  </div>
                </div>
              </div>

              {/* SEO Keyword Table */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 overflow-hidden shadow-sm">
                <h4 className="text-sm font-black text-slate-900 mb-4">High Value Search Gaps</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase text-[10px] tracking-wider">
                        <th className="pb-3">Search Term</th>
                        <th className="pb-3">Monthly Vol</th>
                        <th className="pb-3">Difficulty</th>
                        <th className="pb-3 text-right">Competitor Rank</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-655">
                      {[
                        { term: "startup growth autopilot", vol: 2400, diff: "34% (Low)", comp: "Rank 3 (ScaleEngine)" },
                        { term: "autonomous seo scraper", vol: 1800, diff: "48% (Medium)", comp: "Rank 5 (SyncUp)" },
                        { term: "stripe failed invoice workflow", vol: 950, diff: "22% (Easy)", comp: "Rank 1 (RetentionFly)" },
                        { term: "ai content audit tools", vol: 3200, diff: "61% (Hard)", comp: "Rank 4 (ContentAudit)" }
                      ].map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3.5 font-bold text-slate-900">{item.term}</td>
                          <td className="py-3.5">{item.vol}</td>
                          <td className="py-3.5">{item.diff}</td>
                          <td className="py-3.5 text-right font-semibold text-[#E79E24]">{item.comp}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: COMPETITOR INSIGHTS */}
          {activeTab === "competitors" && createState === "ready" && (
            <div className="space-y-6 max-w-4xl">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4 shadow-sm">
                <h3 className="text-base font-black text-slate-900">Competitor Positioning Overlaps</h3>
                <p className="text-xs text-slate-500 font-semibold">Scraped data points from competitor homepages and target positioning vectors compared with your value proposition.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-black text-slate-900">Competitor: SyncUp</h4>
                    <span className="text-red-700 font-extrabold text-[10px] bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/10">82% Copy Overlap</span>
                  </div>
                  <p className="text-xs text-slate-505 leading-relaxed font-bold">
                    <strong className="text-slate-800">H1 Copy Scraped:</strong> "Automate customer acquisitions and track funnel conversions effortlessly."
                  </p>
                  <p className="text-xs text-slate-550 leading-relaxed font-bold">
                    <strong className="text-slate-800">Positioning Angle:</strong> Simplified marketing instrumentation.
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-black text-slate-900">Competitor: ScaleEngine</h4>
                    <span className="text-[#d97706] font-extrabold text-[10px] bg-[#E79E24]/10 px-2 py-0.5 rounded-full border border-[#E79E24]/15">65% Copy Overlap</span>
                  </div>
                  <p className="text-xs text-slate-505 leading-relaxed font-bold">
                    <strong className="text-slate-800">H1 Copy Scraped:</strong> "Scale SaaS conversions using data-driven automated playbooks."
                  </p>
                  <p className="text-xs text-slate-550 leading-relaxed font-bold">
                    <strong className="text-slate-800">Positioning Angle:</strong> Standard templates and billing metrics.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: BLOG DRAFTS */}
          {activeTab === "blogs" && createState === "ready" && (
            <div className="space-y-6 max-w-4xl">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                <h3 className="text-base font-black text-slate-900">Agent-Generated Blog Drafts</h3>
                <p className="text-xs text-slate-500 mt-1 font-semibold">Review and copy the draft copy generated by Content Agent. Approval loops sync these drafts to staging CMS.</p>
              </div>

              <div className="space-y-4">
                {tasks.filter(t => t.agent.includes("Content") && t.title.toLowerCase().includes("blog")).map(t => (
                  <div key={t.id} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <h4 className="text-sm font-black text-slate-900">Blog Draft: {t.title}</h4>
                        <span className="text-[10px] font-bold text-[#199874] bg-[#199874]/10 px-2.5 py-1 rounded-full mt-1.5 inline-block">Draft Ready (Opus 4.8 Model)</span>
                      </div>
                      <button
                        onClick={() => handleTaskStatusChange(t.id, "approved")}
                        className="bg-[#199874] hover:bg-[#158263] text-white font-extrabold px-4 py-2 rounded-xl text-xs shadow transition-all cursor-pointer"
                      >
                        View Draft Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 6: SOCIAL DRAFTS */}
          {activeTab === "socials" && createState === "ready" && (
            <div className="space-y-6 max-w-4xl">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                <h3 className="text-base font-black text-slate-900">Agent-Generated Social Drafts</h3>
                <p className="text-xs text-slate-500 mt-1 font-semibold">Review, refine, and publish copy built by the Social Draft Agent (LinkedIn / Facebook campaigns).</p>
              </div>

              <div className="space-y-4">
                {tasks.filter(t => t.agent.includes("Content") && !t.title.toLowerCase().includes("blog") && !t.title.toLowerCase().includes("hero")).map(t => (
                  <div key={t.id} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <h4 className="text-sm font-black text-slate-900">Social Campaign: {t.title}</h4>
                        <span className="text-[10px] font-bold text-[#199874] bg-[#199874]/10 px-2.5 py-1 rounded-full mt-1.5 inline-block">Draft Ready (Sonnet 5 Model)</span>
                      </div>
                      <button
                        onClick={() => handleTaskStatusChange(t.id, "approved")}
                        className="bg-[#199874] hover:bg-[#158263] text-white font-extrabold px-4 py-2 rounded-xl text-xs shadow transition-all cursor-pointer"
                      >
                        View Copy Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </main>

      {/* DRAFT REVIEW SLIDE DRAWER / MODAL - Styled in light theme */}
      {activeDraftTask && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4 font-sans animate-fade-in">
          <div className="bg-white border border-slate-200 w-full max-w-2xl rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl flex flex-col justify-between max-h-[85vh] overflow-hidden">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-[#199874] uppercase tracking-wider bg-[#199874]/10 px-2.5 py-1 rounded-full border border-[#199874]/15">
                  Content Drafted by Content Agent
                </span>
                <button
                  onClick={() => setActiveDraftTask(null)}
                  className="text-slate-400 hover:text-slate-800 font-extrabold text-lg cursor-pointer"
                >
                  ×
                </button>
              </div>
              <h3 className="text-lg font-black text-slate-900">{draftTitle}</h3>
              <p className="text-[10px] text-slate-400 font-bold">{activeDraftTask.source}</p>
            </div>

            {/* Editable Content Copy Area */}
            <div className="flex-1 overflow-y-auto">
              <textarea
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                className="w-full h-80 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs font-mono text-slate-700 focus:outline-none focus:border-[#199874] leading-relaxed resize-none shadow-inner"
              />
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setActiveDraftTask(null)}
                className="flex-1 bg-white hover:bg-slate-55 text-slate-500 border border-slate-200 font-bold py-3.5 rounded-xl text-xs transition-all cursor-pointer shadow-sm"
              >
                Close Without Saving
              </button>
              <button
                onClick={handleSaveDraft}
                className="flex-1 bg-[#199874] hover:bg-[#158263] text-white font-extrabold py-3.5 rounded-xl text-xs shadow-lg transition-all cursor-pointer"
              >
                Approve & Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
