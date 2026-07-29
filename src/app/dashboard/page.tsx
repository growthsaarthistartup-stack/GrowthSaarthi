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
  startupId: string;
  name: string;
  url: string;
  stage: string;
  goal: string;
  markets: string[];
  scores: ScoreMatrix;
  gaps: { title: string; description: string }[];
  opportunities: { title: string; description: string }[];
  tasks: Task[];
  logoUrl?: string | null;
}

interface Competitor {
  id: string;
  name: string;
  url: string;
  heroCopy?: string | null;
  positioningAngle?: string | null;
  pricingModel?: string | null;
  pricingTiers?: string[] | null;
  features?: string[] | null;
}

interface SeoRecommendation {
  id: string;
  category: string;
  title: string;
  description: string;
  impactScore: number;
  status: string;
}

interface ContentDraft {
  id: string;
  type: string;
  content: string;
  status: string;
  createdAt: string;
  recommendationId: string;
}

interface SeoAudit {
  score: number;
  grade: string;
  priorities?: Array<{ title?: string; description?: string; impact?: string; category?: string }>;
  audit?: {
    meta?: { score?: number };
    technical?: { score?: number };
  };
  categories?: {
    onPage?: any[];
    geo?: any[];
    usability?: any[];
    performance?: any[];
    social?: any[];
    local?: any[];
    tech?: any[];
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  
  // Navigation Sidebar active tab
  const [activeTab, setActiveTab] = useState<"brand_create" | "overview" | "plan" | "seo" | "competitors" | "blogs" | "socials" | "social_connect" | "alerts" | "integrations">("brand_create");
  
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
  const [logoErrors, setLogoErrors] = useState<Record<string, boolean>>({});

  // Derived discovery results state
  const activeBrand = activeBrandIndex >= 0 ? brands[activeBrandIndex] : null;
  const scores = activeBrand?.scores ?? { overall: 0, validation: 0, growth: 0, technical: 0 };
  const gaps = activeBrand?.gaps ?? [];
  const opportunities = activeBrand?.opportunities ?? [];
  const tasks = activeBrand?.tasks ?? [];

  // Selected task for draft review (modal)
  const [activeDraftTask, setActiveDraftTask] = useState<Task | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [draftTitle, setDraftTitle] = useState("");

  // Live data from backend agents
  const [liveCompetitors, setLiveCompetitors] = useState<Competitor[]>([]);
  const [liveSeRecs, setLiveSeoRecs] = useState<SeoRecommendation[]>([]);
  const [liveBlogDrafts, setLiveBlogDrafts] = useState<ContentDraft[]>([]);
  const [liveSocialDrafts, setLiveSocialDrafts] = useState<ContentDraft[]>([]);
  const [seoAudit, setSeoAudit] = useState<SeoAudit | null>(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [approveLoading, setApproveLoading] = useState<number | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  // Alerts tab state
  interface AlertRow {
    id: string; metricType: string; zScore: number; severity: string;
    message: string; acknowledged: boolean; source: string;
    createdAt: string; acknowledgedAt?: string | null;
  }
  const [liveAlerts, setLiveAlerts] = useState<AlertRow[]>([]);
  const [alertAckLoading, setAlertAckLoading] = useState<string | null>(null);

  // Positioning gaps (for competitors tab)
  interface PositioningGapRow {
    id: string; gapDescription: string; opportunity?: string | null; confidence?: number | null;
  }
  const [positioningGaps, setPositioningGaps] = useState<PositioningGapRow[]>([]);

  // Integration sync loading
  const [syncLoading, setSyncLoading] = useState<string | null>(null);

  // Social integrations state
  const [socialConnections, setSocialConnections] = useState<Record<string, { connected: boolean; handle?: string }>>({
    linkedin:  { connected: false },
    youtube:   { connected: false },
    facebook:  { connected: false },
    instagram: { connected: false },
    twitter:   { connected: false },
  });
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [connectPlatform, setConnectPlatform] = useState<string>("");
  const [connectPlatformLabel, setConnectPlatformLabel] = useState<string>("");
  const [connectHandle, setConnectHandle] = useState("");
  const [connectToken, setConnectToken] = useState("");

  // Blog Wizard state
  const [blogWizardOpen, setBlogWizardOpen] = useState(false);
  const [blogWizardStep, setBlogWizardStep] = useState<"suggest" | "writing" | "review">("suggest");
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [blogSuggestions, setBlogSuggestions] = useState<Array<{ title: string; keywords: string[]; reason: string }>>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedKeywords, setEditedKeywords] = useState("");
  const [generatedBlog, setGeneratedBlog] = useState<{ id: string; title: string; content: string } | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [publishingLoading, setPublishingLoading] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [blogLogs, setBlogLogs] = useState<string[]>([]);

  // Integrations action handlers
  const handleConnectSocialClick = (platId: string, label: string) => {
    setConnectPlatform(platId);
    setConnectPlatformLabel(label);
    setConnectHandle("");
    setConnectToken("");
    setConnectModalOpen(true);
  };

  const handleSaveSocialConnection = () => {
    if (!activeBrand || !connectPlatform) return;
    if (!connectHandle.trim()) {
      alert("Please enter a handle/name!");
      return;
    }

    fetch("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: connectPlatform,
        connected: true,
        accessToken: connectToken || "simulated_token",
        scopesJson: JSON.stringify({ handle: connectHandle })
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.ok) {
        setSocialConnections(prev => ({
          ...prev,
          [connectPlatform]: { connected: true, handle: connectHandle }
        }));
        setConnectModalOpen(false);
      }
    })
    .catch(err => console.error("[dashboard] failed to save integration:", err));
  };

  const handleDisconnectSocial = (platId: string) => {
    if (!activeBrand) return;
    if (!window.confirm(`Are you sure you want to disconnect ${platId}?`)) return;

    fetch("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: platId,
        connected: false,
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.ok) {
        setSocialConnections(prev => ({
          ...prev,
          [platId]: { connected: false }
        }));
      }
    })
    .catch(err => console.error("[dashboard] failed to disconnect integration:", err));
  };

  // Blog Wizard action handlers
  const handleGenerateSuggestions = () => {
    if (!activeBrand) return;
    setSuggestLoading(true);
    fetch("/api/content-drafts/suggest-topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
    .then(res => res.json())
    .then(data => {
      if (data.ok && data.suggestions) {
        setBlogSuggestions(data.suggestions);
      }
    })
    .catch(err => console.error("[dashboard] suggest topics error:", err))
    .finally(() => setSuggestLoading(false));
  };

  const handleGenerateBlog = () => {
    if (!activeBrand || !editedTitle.trim()) return;
    setBlogWizardStep("writing");
    setBlogLogs(["[blog-draft-agent] Analyzing brand voice...", "[blog-draft-agent] Researching audience search behavior..."]);

    const timer1 = setTimeout(() => {
      setBlogLogs(prev => [...prev, `[blog-draft-agent] Target keywords: ${editedKeywords || "None"}`]);
    }, 1500);

    const timer2 = setTimeout(() => {
      setBlogLogs(prev => [...prev, `[blog-draft-agent] Drafting outline...`]);
    }, 3000);

    const timer3 = setTimeout(() => {
      setBlogLogs(prev => [...prev, `[blog-draft-agent] Writing article: "${editedTitle.substring(0, 40)}..."`]);
    }, 4500);

    fetch("/api/content-drafts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: `Title: ${editedTitle}\nKeywords: ${editedKeywords}`,
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.ok && data.draft) {
        let title = editedTitle;
        let content = data.draft.content;
        try {
          const parsed = JSON.parse(data.draft.content);
          title = parsed.title || title;
          content = parsed.content || content;
        } catch {}
        setGeneratedBlog({ id: data.draft.id, title, content });
        setBlogWizardStep("review");
        
        // Pre-select all connected platforms by default
        const connectedPlats = Object.entries(socialConnections)
          .filter(([, v]) => v.connected)
          .map(([k]) => k);
        setSelectedPlatforms(connectedPlats);
      } else {
        alert("Blog generation failed. Please try again.");
        setBlogWizardStep("suggest");
      }
    })
    .catch(err => {
      console.error("[dashboard] blog generation error:", err);
      alert("Network error while generating blog.");
      setBlogWizardStep("suggest");
    })
    .finally(() => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    });
  };

  const handlePublishBlog = () => {
    if (!activeBrand || !generatedBlog) return;
    setPublishingLoading(true);
    fetch("/api/content-drafts/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draftId: generatedBlog.id,
        platforms: selectedPlatforms,
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.ok) {
        setPublishSuccess(true);
        // Refresh blog drafts list
        fetch("/api/content-drafts?type=blog")
          .then(r => r.json())
          .then(d => { if (d.ok) setLiveBlogDrafts(d.drafts ?? []); });
        // Refresh all social platform drafts
        Promise.all([
          fetch("/api/content-drafts?type=linkedin").then(r => r.json()).catch(() => null),
          fetch("/api/content-drafts?type=twitter").then(r => r.json()).catch(() => null),
          fetch("/api/content-drafts?type=instagram").then(r => r.json()).catch(() => null),
          fetch("/api/content-drafts?type=facebook").then(r => r.json()).catch(() => null),
          fetch("/api/content-drafts?type=youtube").then(r => r.json()).catch(() => null),
        ]).then(results => {
          const allDrafts = results.filter(d => d?.ok).flatMap(d => d?.drafts ?? []);
          setLiveSocialDrafts(allDrafts);
        });
      }
    })
    .catch(err => console.error("[dashboard] publish blog error:", err))
    .finally(() => setPublishingLoading(false));
  };

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

  // Handle Delete Brand
  const handleDeleteBrand = (idxToDelete: number) => {
    if (!window.confirm("Are you sure you want to delete this brand?")) return;

    setBrands(prev => {
      const updated = prev.filter((_, idx) => idx !== idxToDelete);
      
      if (updated.length === 0) {
        setActiveBrandIndex(-1);
        setCreateState("input");
        setActiveTab("brand_create");
      } else if (idxToDelete === activeBrandIndex) {
        setActiveBrandIndex(0);
      } else if (idxToDelete < activeBrandIndex) {
        setActiveBrandIndex(activeBrandIndex - 1);
      }
      
      return updated;
    });
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
              startupId: data.startupId ?? "mock_startup_id",
              name: startupName,
              url: websiteUrl || "devsking.com",
              stage: describeAnswer || "E-commerce",
              goal: fixAnswer || "Growth",
              markets: selectedMarkets,
              scores: data.scores,
              gaps: data.gaps,
              opportunities: data.opportunities,
              tasks: data.plan,
              logoUrl: data.logoUrl || null
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
          // Fallback Brand (network / DB unavailable)
           const fallbackBrand: Brand = {
            startupId: "mock_startup_id",
            name: startupName,
            url: websiteUrl || "devsking.com",
            stage: describeAnswer || "E-commerce",
            goal: fixAnswer || "Growth",
            markets: selectedMarkets,
            scores: { overall: 76, validation: 65, growth: 58, technical: 72 },
            logoUrl: (() => {
              try {
                return websiteUrl ? `https://www.google.com/s2/favicons?sz=128&domain=${new URL(websiteUrl).hostname}` : null;
              } catch {
                return null;
              }
            })(),
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

  // Handle Task Action — calls real API which invokes LLM agents (blog/social draft)
  const handleTaskStatusChange = async (id: number, nextStatus: "approved" | "ignored") => {
    if (activeBrandIndex < 0) return;

    // Optimistic UI update immediately
    setBrands(prev =>
      prev.map((brand, idx) => {
        if (idx !== activeBrandIndex) return brand;
        return {
          ...brand,
          tasks: brand.tasks.map(t => t.id === id ? { ...t, status: nextStatus } : t),
        };
      })
    );
    setApproveError(null);

    const activeBrandData = brands[activeBrandIndex];
    if (!activeBrandData) return;

    const task = activeBrandData.tasks.find(t => t.id === id);
    if (!task) return;

    const recId = task.recId;

    if (nextStatus === "ignored") {
      // Call ignore endpoint if we have a real recId (not a demo placeholder)
      if (recId && !recId.startsWith("rec_") && !recId.startsWith("demo_")) {
        fetch(`/api/recommendations/${recId}/ignore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }).catch(e => console.warn("[dashboard] ignore API error:", e));
      }
      return;
    }

    // Approved — call real approve endpoint which triggers LLM draft agents
    if (recId && !recId.startsWith("rec_") && !recId.startsWith("demo_")) {
      setApproveLoading(id);
      try {
        const res = await fetch(`/api/recommendations/${recId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = await res.json();

        if (data.ok && data.draftId) {
          // Fetch the real LLM-generated draft content
          const draftRes = await fetch("/api/content-drafts");
          const draftData = await draftRes.json();
          const draft = draftData.drafts?.find((d: ContentDraft) => d.id === data.draftId);

          if (draft) {
            let parsedContent = draft.content;
            let parsedTitle = task.title;
            try {
              const parsed = JSON.parse(draft.content);
              parsedContent = parsed.content ?? draft.content;
              parsedTitle   = parsed.title ?? task.title;
            } catch { /* content is plain text */ }

            setDraftTitle(parsedTitle);
            setDraftContent(parsedContent);
            setActiveDraftTask({ ...task, status: nextStatus });
          } else {
            // Draft exists but not returned yet — show loading message
            setDraftTitle(task.title);
            setDraftContent("The AI agent is generating your draft. It will appear here shortly — check back in a few seconds.");
            setActiveDraftTask({ ...task, status: nextStatus });
          }
        } else if (data.dispatched === "blocked") {
          setApproveError(`Blocked: ${data.reason}`);
        } else {
          // Fallback: agent call succeeded but no draftId (e.g. non-content category)
          setDraftTitle(task.title);
          setDraftContent(`Action approved. The agent is executing: "${task.title}".\n\nStatus: ${data.dispatched ?? "queued"}\nTrust Level: ${data.trustLevel ?? "N/A"}`);
          setActiveDraftTask({ ...task, status: nextStatus });
        }
      } catch (e) {
        console.error("[dashboard] approve API error:", e);
        setApproveError("Network error — please try again.");
      } finally {
        setApproveLoading(null);
      }
    } else {
      // Demo mode (no DB) — show a rich preview of what would happen
      setDraftTitle(`[Demo Preview] ${task.title}`);
      setDraftContent(
        `🎯 DEMO MODE — Real Pipeline Preview\n\n` +
        `If this were a live workspace, approving "${task.title}" would:\n\n` +
        `• Trigger the ${task.agent} with your actual site data\n` +
        `• Route through the ExecutionGate trust ladder (risk: ${task.agent.includes("Revenue") ? "HIGH" : "LOW"})\n` +
        `• Return a fully AI-drafted document for your review\n` +
        `• Record the approval in your startup's activity log\n\n` +
        `📊 Target Metric: ${task.metric}\n` +
        `🔍 Evidence Source: ${task.source}\n\n` +
        `Connect a database and website URL to unlock the full agent pipeline.`
      );
      setActiveDraftTask({ ...task, status: nextStatus });
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

  // Fetch live tab data when switching to competitor / SEO / blog / social tabs
  useEffect(() => {
    const brand = activeBrandIndex >= 0 ? brands[activeBrandIndex] : null;
    if (!brand || brand.startupId === "mock_startup_id") return;
    const sid = brand.startupId;

    if (activeTab === "competitors") {
      setTabLoading(true);
      setLiveCompetitors([]);
      setPositioningGaps([]);
      // Note: routes now use session auth — no ?startupId= needed
      Promise.all([
        fetch("/api/competitors").then(r => r.json()).catch(() => null),
        fetch("/api/positioning-gaps").then(r => r.json()).catch(() => null),
      ])
        .then(([compData, gapData]) => {
          if (compData?.ok) setLiveCompetitors(compData.competitors ?? []);
          if (gapData?.ok) setPositioningGaps(gapData.gaps ?? []);
        })
        .catch(e => console.warn("[dashboard] competitors fetch error:", e))
        .finally(() => setTabLoading(false));
    }

    if (activeTab === "seo") {
      setTabLoading(true);
      Promise.all([
        fetch("/api/recommendations").then(r => r.json()),
        fetch("/api/seo-audit").then(r => r.json()).catch(() => null),
      ])
        .then(([recsData, auditData]) => {
          if (recsData?.ok) setLiveSeoRecs(recsData.recommendations ?? []);
          if (auditData?.ok) setSeoAudit(auditData.audit ?? null);
        })
        .catch(e => console.warn("[dashboard] seo fetch error:", e))
        .finally(() => setTabLoading(false));
    }

    if (activeTab === "blogs") {
      setTabLoading(true);
      fetch("/api/content-drafts?type=blog")
        .then(r => r.json())
        .then(d => { if (d.ok) setLiveBlogDrafts(d.drafts ?? []); })
        .catch(e => console.warn("[dashboard] blog drafts fetch error:", e))
        .finally(() => setTabLoading(false));
    }

    if (activeTab === "socials") {
      setTabLoading(true);
      // Fetch social drafts for ALL platforms (linkedin, twitter, instagram, facebook, youtube)
      Promise.all([
        fetch("/api/content-drafts?type=linkedin").then(r => r.json()).catch(() => null),
        fetch("/api/content-drafts?type=twitter").then(r => r.json()).catch(() => null),
        fetch("/api/content-drafts?type=instagram").then(r => r.json()).catch(() => null),
        fetch("/api/content-drafts?type=facebook").then(r => r.json()).catch(() => null),
        fetch("/api/content-drafts?type=youtube").then(r => r.json()).catch(() => null),
      ])
        .then((results) => {
          const allDrafts = results
            .filter(d => d?.ok)
            .flatMap(d => d?.drafts ?? []);
          setLiveSocialDrafts(allDrafts);
        })
        .catch(e => console.warn("[dashboard] social drafts fetch error:", e))
        .finally(() => setTabLoading(false));
    }

    if (activeTab === "social_connect" || activeTab === "integrations" || activeTab === "blogs") {
      fetch("/api/integrations")
        .then(r => r.json())
        .then(d => {
          if (d.ok && d.integrations) {
            const newConns: Record<string, { connected: boolean; handle?: string }> = {
              linkedin:  { connected: false },
              youtube:   { connected: false },
              facebook:  { connected: false },
              instagram: { connected: false },
              twitter:   { connected: false },
            };
            d.integrations.forEach((item: any) => {
              if (item.type in newConns) {
                let handle = "";
                try {
                  const parsed = JSON.parse(item.scopesJson || "{}");
                  handle = parsed.handle || "";
                } catch {}
                newConns[item.type as keyof typeof newConns] = {
                  connected: item.connected,
                  handle,
                };
              }
            });
            setSocialConnections(newConns);
          }
        })
        .catch(e => console.warn("[dashboard] integrations fetch error:", e));
    }

    // Fetch alerts when on alerts tab
    if (activeTab === "alerts") {
      fetch("/api/alerts")
        .then(r => r.json())
        .then(d => { if (d.ok) setLiveAlerts(d.alerts ?? []); })
        .catch(e => console.warn("[dashboard] alerts fetch error:", e));
    }

    // competitors + positioning-gaps are fetched together above when activeTab === "competitors"
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeBrandIndex]);

  // Toggle markets selection
  const handleMarketSelect = (market: string) => {
    setSelectedMarkets(prev => 
      prev.includes(market) ? prev.filter(m => m !== market) : [...prev, market]
    );
  };

  // Sidebar navigation elements
  const navItems = [
    { id: "brand_create", label: "Brand Create",       icon: "🌐", disabled: false },
    { id: "overview",     label: "Dashboard",          icon: "📊", disabled: activeBrandIndex < 0 },
    { id: "plan",         label: "30-Day Plan",         icon: "🗓️", disabled: activeBrandIndex < 0 },
    { id: "seo",          label: "SEO Analysis",        icon: "📈", disabled: activeBrandIndex < 0 },
    { id: "competitors",  label: "Competitor Insights", icon: "👥", disabled: activeBrandIndex < 0 },
    { id: "blogs",        label: "Blog Drafts",         icon: "✍️", disabled: activeBrandIndex < 0 },
    { id: "socials",      label: "Social Drafts",       icon: "📢", disabled: activeBrandIndex < 0 },
    { id: "integrations", label: "Integrations",        icon: "🔗", disabled: activeBrandIndex < 0 },
    { id: "alerts",       label: "Alerts",              icon: "🔔", disabled: activeBrandIndex < 0 },
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
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#199874] to-[#E79E24] flex items-center justify-center font-bold text-white text-sm shrink-0 shadow-sm overflow-hidden relative">
                    {activeBrand?.logoUrl && !logoErrors[activeBrand.url] ? (
                      <img
                        src={activeBrand.logoUrl}
                        alt={`${activeBrand.name} Logo`}
                        className="w-full h-full object-cover p-1 bg-white"
                        onError={() => setLogoErrors(prev => ({ ...prev, [activeBrand.url]: true }))}
                      />
                    ) : (
                      activeBrand?.url ? activeBrand.url.replace(/https?:\/\//, "").substring(0, 2).toUpperCase() : "GS"
                    )}
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
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#199874] to-[#E79E24] flex items-center justify-center font-extrabold text-white text-xs shrink-0 shadow-sm overflow-hidden relative">
                          {brand.logoUrl && !logoErrors[brand.url] ? (
                            <img
                              src={brand.logoUrl}
                              alt={`${brand.name} Logo`}
                              className="w-full h-full object-cover p-0.5 bg-white"
                              onError={() => setLogoErrors(prev => ({ ...prev, [brand.url]: true }))}
                            />
                          ) : (
                            brand.url.replace(/https?:\/\//, "").substring(0, 2).toUpperCase()
                          )}
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
                        onBlur={() => {
                          const val = websiteUrl.trim();
                          if (val && !/^https?:\/\//i.test(val)) {
                            setWebsiteUrl(`https://${val}`);
                          }
                        }}
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
                        const val = websiteUrl.trim();
                        if (!val) {
                          alert("Please enter a website link first!");
                          return;
                        }
                        const normalized = /^https?:\/\//i.test(val) ? val : `https://${val}`;
                        setWebsiteUrl(normalized);
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
                          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#199874] to-[#E79E24] flex items-center justify-center font-black text-white text-base shadow overflow-hidden relative">
                            {brand.logoUrl && !logoErrors[brand.url] ? (
                              <img
                                src={brand.logoUrl}
                                alt={`${brand.name} Logo`}
                                className="w-full h-full object-cover p-1 bg-white"
                                onError={() => setLogoErrors(prev => ({ ...prev, [brand.url]: true }))}
                              />
                            ) : (
                              brand.url.replace(/https?:\/\//, "").substring(0, 2).toUpperCase()
                            )}
                          </div>
                          <div>
                            <h4 className="font-extrabold text-slate-900 text-sm">{brand.name}</h4>
                            <p className="text-xs text-slate-500 font-bold mt-0.5">{brand.url}</p>
                            <span className="text-[9px] font-bold text-[#199874] bg-[#199874]/10 px-2 py-0.5 rounded-full mt-1.5 inline-block">
                              {brand.stage}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {idx === activeBrandIndex && (
                            <span className="text-xs text-[#199874] font-black uppercase tracking-wider bg-[#199874]/10 px-3 py-1.5 border border-[#199874]/20 rounded-full shadow-sm">
                              Active Brand
                            </span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteBrand(idx);
                            }}
                            className="p-2 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors duration-200 cursor-pointer"
                            title="Delete Brand"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
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
                              disabled={approveLoading === task.id}
                              className="text-[10px] text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl font-bold transition-all border border-slate-200 cursor-pointer disabled:opacity-50"
                            >
                              Ignore
                            </button>
                            <button
                              onClick={() => handleTaskStatusChange(task.id, "approved")}
                              disabled={approveLoading === task.id}
                              className="text-[10px] bg-[#199874] hover:bg-[#158263] text-white px-4 py-1.5 rounded-xl font-extrabold transition-all shadow cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
                            >
                              {approveLoading === task.id ? (
                                <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />Generating...</>
                              ) : "Approve"}
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

          {/* TAB 3: SEO ANALYSIS — real data from recommendations + SEOScoreAPI */}
          {activeTab === "seo" && createState === "ready" && (
            <div className="space-y-6 max-w-4xl">
              {tabLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-4 border-slate-200 border-t-[#199874] rounded-full animate-spin" />
                  <span className="ml-3 text-sm text-slate-500 font-bold">Loading SEO data...</span>
                </div>
              ) : (
                <>
                  {/* SEO Score Audit Header */}
                  <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-black text-slate-900 font-sans">Search Engine Indexation Audit</h3>
                        <p className="text-xs text-slate-500 font-semibold mt-1">Live analysis from SEOScoreAPI + AI recommendation engine. Results are based on the website URL you provided.</p>
                      </div>
                      {/* Download Report Button */}
                      <button
                        id="download-seo-report-btn"
                        onClick={async () => {
                          if (!activeBrand) return;
                          const btn = document.getElementById("download-seo-report-btn") as HTMLButtonElement;
                          const original = btn.innerHTML;
                          btn.disabled = true;
                          btn.innerHTML = `<svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg><span>Generating…</span>`;
                          try {
                            const res = await fetch(`/api/seo-report?startupId=${activeBrand.startupId}`);
                            if (!res.ok) throw new Error("Report generation failed");
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `seo-audit-${activeBrand.name.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0,10)}.html`;
                            a.click();
                            URL.revokeObjectURL(url);
                          } catch (err) {
                            console.error("[dashboard] SEO report download error:", err);
                            alert("Could not generate report. Please try again.");
                          } finally {
                            btn.disabled = false;
                            btn.innerHTML = original;
                          }
                        }}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black text-white shrink-0 cursor-pointer transition-all hover:opacity-90 active:scale-95 disabled:opacity-60"
                        style={{background: "linear-gradient(135deg, #199874 0%, #0ea5e9 100%)", boxShadow: "0 4px 16px rgba(25,152,116,0.35)"}}
                      >
                        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13 7l-3 3-3-3M10 10V3" />
                          <path d="M3 14v2a2 2 0 002 2h10a2 2 0 002-2v-2" />
                        </svg>
                        Download Full Report
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">SEO Score</span>
                        <strong className="text-lg font-black text-slate-800 block mt-1">
                          {seoAudit ? `${seoAudit.score} / 100` : `${scores.technical || "N/A"} / 100`}
                        </strong>
                        {seoAudit?.grade && <span className="text-xs text-[#199874] font-bold">Grade: {seoAudit.grade}</span>}
                      </div>
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Recommendations Found</span>
                        <strong className="text-lg font-black text-[#199874] block mt-1">
                          {liveSeRecs.length > 0 ? `${liveSeRecs.length} Actions` : "Scanning..."}
                        </strong>
                      </div>
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Meta Score</span>
                        <strong className="text-lg font-black text-[#E79E24] block mt-1">
                          {seoAudit?.audit?.meta?.score != null ? `${seoAudit.audit.meta.score}%` : `${scores.validation || "N/A"}%`}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* SEO Priorities from SEOScoreAPI */}
                  {seoAudit?.priorities && seoAudit.priorities.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                      <h4 className="text-sm font-black text-slate-900 mb-4">Top Priorities from SEO Audit</h4>
                      <div className="space-y-3">
                        {seoAudit.priorities.slice(0, 5).map((p, i) => (
                          <div key={i} className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                p.impact === "high" ? "bg-red-100 text-red-700" :
                                p.impact === "medium" ? "bg-amber-100 text-amber-700" :
                                "bg-slate-100 text-slate-600"
                              }`}>{p.impact?.toUpperCase() ?? "INFO"}</span>
                              {p.category && <span className="text-[10px] font-bold text-slate-500">{p.category}</span>}
                            </div>
                            <h5 className="text-xs font-black text-slate-900">{p.title}</h5>
                            {p.description && <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">{p.description}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI Recommendations from DB */}
                  {liveSeRecs.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-3xl p-6 overflow-hidden shadow-sm">
                      <h4 className="text-sm font-black text-slate-900 mb-4">AI Growth Recommendations</h4>
                      <div className="space-y-3">
                        {liveSeRecs.map(rec => (
                          <div key={rec.id} className={`p-4 rounded-2xl border ${
                            rec.status === "approved" ? "bg-[#199874]/5 border-[#199874]/20" :
                            "bg-slate-50 border-slate-200"
                          }`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[10px] font-black text-[#199874] bg-[#199874]/10 px-2 py-0.5 rounded-full">{rec.category}</span>
                                  <span className="text-[10px] text-slate-400 font-bold">Impact: {(rec.impactScore * 100).toFixed(0)}%</span>
                                </div>
                                <h5 className="text-xs font-black text-slate-900">{rec.title}</h5>
                                <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">{rec.description}</p>
                              </div>
                              {rec.status === "approved" && (
                                <span className="text-[10px] text-[#199874] font-black bg-[#199874]/10 px-2 py-1 rounded-full shrink-0">Done</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {!tabLoading && liveSeRecs.length === 0 && !seoAudit && (
                    <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-10 text-center shadow-sm">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                        <span className="text-slate-400 text-xl">📊</span>
                      </div>
                      <h4 className="font-black text-slate-700">No SEO Data Yet</h4>
                      <p className="text-xs text-slate-500 mt-2 max-w-xs mx-auto">The SEO agent will populate this panel after the scan completes. Make sure your website URL is valid and publicly accessible.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* TAB 4: COMPETITOR INSIGHTS — real data from competitor-agent */}
          {activeTab === "competitors" && createState === "ready" && (
            <div className="space-y-6 max-w-4xl">
              {/* Header */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-3 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black text-slate-900">Competitor Analysis</h3>
                    <p className="text-xs text-slate-500 font-semibold mt-1">Real scraped positioning data compared to your brand via vector similarity. Gaps &amp; opportunities are AI-generated from live data.</p>
                  </div>
                  <button
                    onClick={() => {
                      const brand = activeBrandIndex >= 0 ? brands[activeBrandIndex] : null;
                      if (!brand) return;
                      setTabLoading(true);
                      setLiveCompetitors([]);
                      setPositioningGaps([]);
                      fetch(`/api/analyze?startupId=${brand.startupId}`, { method: "POST" })
                        .finally(() => Promise.all([
                          fetch(`/api/competitors?startupId=${brand.startupId}`).then(r => r.json()).catch(() => null),
                          fetch(`/api/positioning-gaps?startupId=${brand.startupId}`).then(r => r.json()).catch(() => null),
                        ])
                          .then(([compData, gapData]) => {
                            if (compData?.ok) setLiveCompetitors(compData.competitors ?? []);
                            if (gapData?.ok) setPositioningGaps(gapData.gaps ?? []);
                          })
                          .finally(() => setTabLoading(false)));
                    }}
                    className="bg-[#199874] hover:bg-[#158263] text-white font-extrabold px-5 py-2.5 rounded-xl text-xs shadow-md transition-all cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    ↻ Refresh Analysis
                  </button>
                </div>
                {liveCompetitors.length > 0 && (
                  <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-100">
                    <div className="flex items-center gap-1.5 text-xs text-slate-600 font-bold">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                      {liveCompetitors.length} competitor{liveCompetitors.length !== 1 ? "s" : ""} found
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-600 font-bold">
                      <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
                      {positioningGaps.length} positioning gap{positioningGaps.length !== 1 ? "s" : ""} identified
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-slate-300 inline-block" />
                      Industry: {(activeBrand as any)?.industry || "Startup"}
                    </div>
                  </div>
                )}
              </div>

              {tabLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-4 border-slate-200 border-t-[#199874] rounded-full animate-spin" />
                  <span className="ml-3 text-sm text-slate-500 font-bold">Discovering and analyzing competitors…</span>
                </div>
              ) : liveCompetitors.length > 0 ? (
                <>
                  {/* Side-by-side matrix */}
                  <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
                    <h4 className="text-sm font-black text-slate-900">Side-by-Side Competitive Matrix</h4>
                    <p className="text-xs text-slate-500 font-semibold">Comparison of value propositions, pricing, and features. Your row is highlighted in green.</p>
                    <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                      <table className="min-w-full divide-y divide-slate-200 text-xs">
                        <thead className="bg-slate-50 font-black text-slate-700">
                          <tr>
                            <th className="px-4 py-3 text-left">Company</th>
                            <th className="px-4 py-3 text-left">Positioning / Value Prop</th>
                            <th className="px-4 py-3 text-left">Starting Price</th>
                            <th className="px-4 py-3 text-left">Key Features</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white font-medium text-slate-600">
                          {/* Your startup row */}
                          <tr className="bg-emerald-50/40 font-bold text-emerald-950 border-l-4 border-emerald-500">
                            <td className="px-4 py-3">
                              <div className="font-extrabold">{activeBrand?.name} <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded ml-1 uppercase">You</span></div>
                              {activeBrand?.url && <a href={activeBrand.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-slate-400 hover:text-emerald-600 underline decoration-dotted block mt-0.5">{activeBrand.url}</a>}
                            </td>
                            <td className="px-4 py-3">{(activeBrand as any)?.industry || "Your Services"}</td>
                            <td className="px-4 py-3 text-[#199874]">Contact for Pricing</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {seoAudit?.categories?.tech && seoAudit.categories.tech.length > 0
                                  ? seoAudit.categories.tech.slice(0, 3).map((c: any, i: number) => (
                                    <span key={i} className="text-[9px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200">{c.label?.replace(/\s+\(.*\)/g, "") || c.name}</span>
                                  ))
                                  : <span className="text-[9px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200">Custom Stack</span>
                                }
                              </div>
                            </td>
                          </tr>
                          {/* Competitor rows */}
                          {liveCompetitors.map(comp => (
                            <tr key={comp.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-4 py-3">
                                <div className="font-bold text-slate-950">
                                  <a href={comp.url || "#"} target="_blank" rel="noopener noreferrer" className="hover:text-[#199874] underline decoration-dotted">{comp.name}</a>
                                </div>
                                {comp.url && <div className="text-[10px] text-slate-400 break-all">{comp.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</div>}
                              </td>
                              <td className="px-4 py-3 min-w-[200px]">
                                <p className="text-slate-700 leading-relaxed whitespace-pre-line">{comp.positioningAngle || comp.heroCopy || "—"}</p>
                              </td>
                              <td className="px-4 py-3">
                                <span className="font-bold text-amber-700">{comp.pricingModel || "—"}</span>
                                {comp.pricingTiers && comp.pricingTiers.length > 0 && (
                                  <div className="mt-1 flex flex-col gap-0.5">
                                    {comp.pricingTiers.map((tier: string, i: number) => (
                                      <span key={i} className="text-[9px] text-slate-500 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">{tier}</span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-1">
                                  {comp.features && comp.features.length > 0
                                    ? comp.features.map((f: string, idx: number) => (
                                      <span key={idx} className="text-[9px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full border border-slate-200">{f}</span>
                                    ))
                                    : <span className="text-[10px] text-slate-400">Parsing…</span>
                                  }
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Deep-dive cards */}
                  <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
                    <h4 className="text-sm font-black text-slate-900">Competitor Deep-Dives</h4>
                    <p className="text-xs text-slate-500 font-semibold">Scraped homepage copy and extracted insights for each identified competitor.</p>
                    <div className="grid grid-cols-1 gap-4">
                      {liveCompetitors.map(comp => (
                        <div key={comp.id + "_deep"} className="border border-slate-200 rounded-2xl p-4 space-y-3 bg-slate-50/40">
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <a href={comp.url || "#"} target="_blank" rel="noopener noreferrer" className="text-sm font-extrabold text-slate-900 hover:text-[#199874] underline decoration-dotted">{comp.name}</a>
                              <div className="text-[10px] text-slate-400 mt-0.5">{comp.url}</div>
                            </div>
                            {comp.pricingModel && (
                              <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full shrink-0">{comp.pricingModel}</span>
                            )}
                          </div>
                          {comp.positioningAngle && (
                            <div className="text-xs text-slate-700 leading-relaxed bg-white border border-slate-100 rounded-xl p-3">
                              <strong className="text-[10px] font-black text-slate-500 uppercase tracking-wide block mb-1">Positioning Angle</strong>
                              {comp.positioningAngle}
                            </div>
                          )}
                          {comp.heroCopy && (
                            <div className="text-xs text-slate-500 leading-relaxed italic border-l-4 border-slate-200 pl-3">
                              <strong className="text-[10px] font-black text-slate-400 not-italic uppercase tracking-wide block mb-1">Scraped Homepage Copy</strong>
                              &ldquo;{comp.heroCopy}&rdquo;
                            </div>
                          )}

                          {comp.features && comp.features.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {comp.features.map((f: string, i: number) => (
                                <span key={i} className="text-[9px] bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{f}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Strategic Positioning Gaps */}
                  {positioningGaps.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
                      <h4 className="text-sm font-black text-slate-900">Strategic Positioning Gaps &amp; Opportunities</h4>
                      <p className="text-xs text-slate-500 font-semibold">AI-identified angles where your business can uniquely position itself. Based on live competitor data.</p>
                      <div className="grid grid-cols-1 gap-4">
                        {positioningGaps.map((gap: any) => (
                          <div key={gap.id} className="border border-slate-200 rounded-2xl p-4 space-y-2.5 bg-slate-50/40">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-black text-[#7c3aed] bg-[#7c3aed]/10 px-2.5 py-1 rounded-full">
                                Confidence: {Math.round((gap.confidence ?? 0.7) * 100)}%
                              </span>
                              <span className="text-[10px] text-slate-400 font-bold">Opportunity Analysis</span>
                            </div>
                            <p className="text-xs text-slate-800 leading-relaxed">
                              <strong className="text-slate-500 font-bold block mb-1 text-[10px] uppercase tracking-wide">Observed Positioning Gap</strong>
                              {gap.gapDescription}
                            </p>
                            {gap.opportunity && (
                              <div className="bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-700 leading-relaxed border-l-4 border-l-[#199874]">
                                <strong className="text-slate-900 font-black block mb-0.5 text-[10px] uppercase tracking-wide">Actionable Opportunity</strong>
                                {gap.opportunity}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-10 text-center shadow-sm">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                    <span className="text-slate-400 text-xl">👥</span>
                  </div>
                  <h4 className="font-black text-slate-700">No Competitors Found Yet</h4>
                  <p className="text-xs text-slate-500 mt-2 max-w-xs mx-auto">The competitor discovery agent runs when you analyze a brand. Click <strong>↻ Refresh Analysis</strong> above to trigger a fresh discovery sweep.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: BLOG DRAFTS — real contentDrafts from blog-draft-agent */}
          {activeTab === "blogs" && createState === "ready" && (
            <div className="space-y-6 max-w-4xl">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div>
                  <h3 className="text-base font-black text-slate-900">Agent-Generated Blog Drafts</h3>
                  <p className="text-xs text-slate-500 mt-1 font-semibold">AI-written blog posts produced by the Blog Draft Agent using your Brand Voice. Review and approve before publishing.</p>
                </div>
                <button
                  onClick={() => {
                    setBlogWizardStep("suggest");
                    setBlogSuggestions([]);
                    setSelectedSuggestionIndex(-1);
                    setEditedTitle("");
                    setEditedKeywords("");
                    setGeneratedBlog(null);
                    setPublishSuccess(false);
                    setBlogWizardOpen(true);
                  }}
                  className="bg-[#199874] hover:bg-[#158263] text-white font-extrabold px-5 py-3 rounded-xl text-xs shadow-md transition-all cursor-pointer shrink-0"
                >
                  + Write a Blog
                </button>
              </div>

              {tabLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-4 border-slate-200 border-t-[#199874] rounded-full animate-spin" />
                  <span className="ml-3 text-sm text-slate-500 font-bold">Loading blog drafts...</span>
                </div>
              ) : liveBlogDrafts.length > 0 ? (
                <div className="space-y-4">
                  {liveBlogDrafts.map(draft => {
                    let parsedTitle = "Blog Draft";
                    let parsedPreview = draft.content.slice(0, 200);
                    try {
                      const p = JSON.parse(draft.content);
                      parsedTitle   = p.title ?? parsedTitle;
                      parsedPreview = p.content?.slice(0, 200) ?? parsedPreview;
                    } catch { /* plain text */ }
                    return (
                      <div key={draft.id} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex-1">
                            <h4 className="text-sm font-black text-slate-900">{parsedTitle}</h4>
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[10px] font-bold text-[#199874] bg-[#199874]/10 px-2.5 py-1 rounded-full">Blog • AI-Generated</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                draft.status === "approved" ? "bg-[#199874]/10 text-[#199874]" : "bg-slate-100 text-slate-500"
                              }`}>{draft.status.replace("_", " ")}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">{parsedPreview}...</p>
                          </div>
                          <button
                            onClick={() => {
                              let title = "Blog Draft";
                              let content = draft.content;
                              try { const p = JSON.parse(draft.content); title = p.title ?? title; content = p.content ?? content; } catch { /* plain */ }
                              setDraftTitle(title);
                              setDraftContent(content);
                              // Use first matching task or create a minimal synthetic one
                              const matchingTask = tasks.find(t => t.recId === draft.recommendationId);
                              setActiveDraftTask(matchingTask ?? { id: 0, recId: draft.id, week: "", title, detail: content, status: "approved", source: "Blog Draft Agent", metric: "", agent: "Content Agent" });
                            }}
                            className="bg-[#199874] hover:bg-[#158263] text-white font-extrabold px-4 py-2 rounded-xl text-xs shadow transition-all cursor-pointer shrink-0"
                          >
                            View Full Draft
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-10 text-center shadow-sm">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                    <span className="text-slate-400 text-xl">✍️</span>
                  </div>
                  <h4 className="font-black text-slate-700">No Blog Drafts Generated Yet</h4>
                  <p className="text-xs text-slate-500 mt-2 max-w-xs mx-auto">Approve a content or SEO task in the Dashboard tab to trigger the Blog Draft Agent. It will generate a full AI-written article based on your brand voice.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 6: SOCIAL DRAFTS — real contentDrafts from social-draft-agent */}
          {activeTab === "socials" && createState === "ready" && (
            <div className="space-y-6 max-w-4xl">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                <h3 className="text-base font-black text-slate-900">Agent-Generated Social Drafts</h3>
                <p className="text-xs text-slate-500 mt-1 font-semibold">Platform-native LinkedIn & social copy produced by the Social Draft Agent. Review, refine, and publish.</p>
              </div>

              {tabLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-4 border-slate-200 border-t-[#199874] rounded-full animate-spin" />
                  <span className="ml-3 text-sm text-slate-500 font-bold">Loading social drafts...</span>
                </div>
              ) : liveSocialDrafts.length > 0 ? (
                <div className="space-y-4">
                  {liveSocialDrafts.map(draft => {
                    let parsedPlatform = draft.type;
                    let parsedCopy = draft.content;
                    let parsedHook = "";
                    let parsedHashtags: string[] = [];
                    try {
                      const p = JSON.parse(draft.content);
                      parsedPlatform  = p.platform ?? parsedPlatform;
                      parsedCopy      = p.copy ?? parsedCopy;
                      parsedHook      = p.hook ?? "";
                      parsedHashtags  = p.hashtags ?? [];
                    } catch { /* plain text */ }
                    return (
                      <div key={draft.id} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[10px] font-bold text-[#199874] bg-[#199874]/10 px-2.5 py-1 rounded-full capitalize">{parsedPlatform} Post</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                draft.status === "approved" ? "bg-[#199874]/10 text-[#199874]" : "bg-slate-100 text-slate-500"
                              }`}>{draft.status.replace("_", " ")}</span>
                            </div>
                            {parsedHook && <p className="text-xs font-black text-slate-900 mb-1">{parsedHook}</p>}
                            <p className="text-[11px] text-slate-500 leading-relaxed">{parsedCopy.slice(0, 200)}...</p>
                            {parsedHashtags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {parsedHashtags.slice(0, 5).map(tag => (
                                  <span key={tag} className="text-[10px] text-[#199874] font-bold">#{tag.replace(/^#/, "")}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              setDraftTitle(`${parsedPlatform} Social Post`);
                              setDraftContent(parsedCopy);
                              const matchingTask = tasks.find(t => t.recId === draft.recommendationId);
                              setActiveDraftTask(matchingTask ?? { id: 0, recId: draft.id, week: "", title: `${parsedPlatform} Social Post`, detail: parsedCopy, status: "approved", source: "Social Draft Agent", metric: "", agent: "Content Agent" });
                            }}
                            className="bg-[#199874] hover:bg-[#158263] text-white font-extrabold px-4 py-2 rounded-xl text-xs shadow transition-all cursor-pointer shrink-0"
                          >
                            View Full Copy
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-10 text-center shadow-sm">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                    <span className="text-slate-400 text-xl">📢</span>
                  </div>
                  <h4 className="font-black text-slate-700">No Social Drafts Generated Yet</h4>
                  <p className="text-xs text-slate-500 mt-2 max-w-xs mx-auto">Approve a social or content task in the Dashboard tab to trigger the Social Draft Agent. It will generate platform-native LinkedIn and Facebook copy.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 7: SOCIAL CONNECTIONS */}
          {activeTab === "social_connect" && createState === "ready" && (
            <div className="space-y-6 max-w-4xl">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                <h3 className="text-base font-black text-slate-900">Connect Social Channels</h3>
                <p className="text-xs text-slate-500 mt-1 font-semibold">Integrate your startup's social media platforms to automatically publish content generated by GrowthSaarthi agents.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    id: "linkedin",
                    label: "LinkedIn",
                    color: "bg-[#0077B5]",
                    icon: (
                      <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/>
                      </svg>
                    )
                  },
                  {
                    id: "twitter",
                    label: "X (Twitter)",
                    color: "bg-[#000000]",
                    icon: (
                      <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                    )
                  },
                  {
                    id: "facebook",
                    label: "Facebook",
                    color: "bg-[#1877F2]",
                    icon: (
                      <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c4.56-.93 8-4.96 8-9.75z"/>
                      </svg>
                    )
                  },
                  {
                    id: "instagram",
                    label: "Instagram",
                    color: "bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]",
                    icon: (
                      <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                      </svg>
                    )
                  },
                  {
                    id: "youtube",
                    label: "YouTube",
                    color: "bg-[#FF0000]",
                    icon: (
                      <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.108C19.52 3.5 12 3.5 12 3.5s-7.52 0-9.388.555A3.002 3.002 0 0 0 .502 6.163C0 8.03 0 12 0 12s0 3.97.502 5.837a3.003 3.003 0 0 0 2.11 2.108C4.48 20.5 12 20.5 12 20.5s7.52 0 9.388-.555a3.003 3.003 0 0 0 2.11-2.108C24 15.97 24 12 24 12s0-3.97-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                      </svg>
                    )
                  }
                ].map(plat => {
                  const conn = socialConnections[plat.id] || { connected: false };
                  return (
                    <div key={plat.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between h-44 font-sans">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl ${plat.color} flex items-center justify-center text-white text-lg shadow-sm shrink-0`}>
                            {plat.icon}
                          </div>
                          <div>
                            <h4 className="font-extrabold text-slate-900 text-sm">{plat.label}</h4>
                            <p className="text-[10px] text-slate-400 font-bold capitalize mt-0.5">{plat.id}</p>
                          </div>
                        </div>
                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                          conn.connected ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"
                        }`}>
                          {conn.connected ? "Connected" : "Disconnected"}
                        </span>
                      </div>

                      <div className="mt-4">
                        {conn.connected ? (
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-600 truncate max-w-[120px]">{conn.handle || "Active Channel"}</span>
                            <button
                              onClick={() => handleDisconnectSocial(plat.id)}
                              className="text-red-500 hover:text-red-600 font-bold cursor-pointer"
                            >
                              Disconnect
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleConnectSocialClick(plat.id, plat.label)}
                            className="w-full py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                          >
                            Connect Channel
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SOCIAL CONNECT MODAL */}
          {connectModalOpen && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4 font-sans animate-fade-in animate-duration-200">
              <div className="bg-white border border-slate-200 w-full max-w-md rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xl flex flex-col">
                <div className="flex justify-between items-center">
                  <h3 className="text-base font-black text-slate-900">Connect {connectPlatformLabel}</h3>
                  <button
                    onClick={() => setConnectModalOpen(false)}
                    className="text-slate-400 hover:text-slate-800 font-extrabold text-lg cursor-pointer"
                  >
                    ×
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider">Account Handle / Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., @mybrandname"
                      value={connectHandle}
                      onChange={(e) => setConnectHandle(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 text-xs focus:outline-none focus:border-[#199874] transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider">OAuth Access Token / API Key</label>
                    <input
                      type="password"
                      placeholder="Simulated OAuth Token"
                      value={connectToken}
                      onChange={(e) => setConnectToken(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 text-xs focus:outline-none focus:border-[#199874] transition-colors"
                    />
                    <p className="text-[10px] text-slate-400 font-medium leading-relaxed">Leave blank to use default simulated sandbox connection.</p>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setConnectModalOpen(false)}
                    className="flex-1 bg-white hover:bg-slate-50 text-slate-500 border border-slate-200 font-bold py-3 rounded-xl text-xs transition-all cursor-pointer shadow-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveSocialConnection}
                    className="flex-1 bg-[#199874] hover:bg-[#158263] text-white font-extrabold py-3 rounded-xl text-xs shadow-md transition-all cursor-pointer"
                  >
                    Save Connection
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* BLOG CREATION WIZARD MODAL */}
          {blogWizardOpen && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4 font-sans animate-fade-in animate-duration-200">
              <div className="bg-white border border-slate-200 w-full max-w-2xl rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
                
                <div className="flex justify-between items-center shrink-0">
                  <div>
                    <span className="text-[9px] font-black text-[#199874] uppercase tracking-wider bg-[#199874]/10 px-2.5 py-1 rounded-full border border-[#199874]/15">
                      Blog Creator Wizard
                    </span>
                    <h3 className="text-lg font-black text-slate-900 mt-2">
                      {blogWizardStep === "suggest" ? "Step 1: Ideation & Keywords" : blogWizardStep === "writing" ? "Step 2: AI Agent Writing" : "Step 3: Review & Publish"}
                    </h3>
                  </div>
                  <button
                    onClick={() => setBlogWizardOpen(false)}
                    className="text-slate-400 hover:text-slate-800 font-extrabold text-lg cursor-pointer"
                  >
                    ×
                  </button>
                </div>

                {/* Step Content */}
                <div className="flex-1 overflow-y-auto min-h-[300px] py-1">
                  
                  {/* Step 1: Ideation & Keywords */}
                  {blogWizardStep === "suggest" && (
                    <div className="space-y-6">
                      <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                        Generate blog topic suggestions and targeted SEO keyword lists based on your landing page scan. Choose a topic below or write your own.
                      </p>

                      {blogSuggestions.length === 0 ? (
                        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-8 text-center space-y-4">
                          <span className="text-2xl block">💡</span>
                          <h4 className="font-extrabold text-slate-700 text-sm">Need Title and Keyword Ideas?</h4>
                          <button
                            onClick={handleGenerateSuggestions}
                            disabled={suggestLoading}
                            className="bg-[#199874] hover:bg-[#158263] text-white font-extrabold px-6 py-3 rounded-xl text-xs shadow transition-all cursor-pointer disabled:opacity-50"
                          >
                            {suggestLoading ? "Generating Suggestions..." : "Generate AI Suggestions"}
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider">AI Suggestions</label>
                          <div className="grid grid-cols-1 gap-3">
                            {blogSuggestions.map((sug, idx) => (
                              <div
                                key={idx}
                                onClick={() => {
                                  setSelectedSuggestionIndex(idx);
                                  setEditedTitle(sug.title);
                                  setEditedKeywords(sug.keywords.join(", "));
                                }}
                                className={`p-4 rounded-xl border text-left cursor-pointer transition-all space-y-2 ${
                                  selectedSuggestionIndex === idx
                                    ? "bg-[#199874]/5 border-[#199874] text-slate-900"
                                    : "bg-white border-slate-200 hover:bg-slate-55"
                                }`}
                              >
                                <h5 className="font-extrabold text-xs text-slate-900">{sug.title}</h5>
                                <p className="text-[10px] text-slate-400 font-bold leading-normal">{sug.reason}</p>
                                <div className="flex flex-wrap gap-1">
                                  {sug.keywords.map(kw => (
                                    <span key={kw} className="text-[9px] font-extrabold text-[#199874] bg-[#199874]/5 px-2 py-0.5 rounded-full border border-[#199874]/10">
                                      {kw}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="space-y-4 pt-2">
                        <div className="space-y-2">
                          <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider">Blog Title *</label>
                          <input
                            type="text"
                            value={editedTitle}
                            onChange={(e) => setEditedTitle(e.target.value)}
                            placeholder="e.g., How to Scale E-commerce Operations"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 text-xs focus:outline-none focus:border-[#199874] transition-colors"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider">Target Keywords (comma-separated)</label>
                          <input
                            type="text"
                            value={editedKeywords}
                            onChange={(e) => setEditedKeywords(e.target.value)}
                            placeholder="e.g., e-commerce scale, scaling logistics, shopify tips"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 text-xs focus:outline-none focus:border-[#199874] transition-colors"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step 2: Writing Article Progress */}
                  {blogWizardStep === "writing" && (
                    <div className="space-y-8 flex flex-col justify-between py-8">
                      <div className="text-center space-y-3">
                        <div className="w-12 h-12 border-4 border-slate-200 border-t-[#199874] rounded-full animate-spin mx-auto mb-2" />
                        <h4 className="font-black text-slate-900 text-base">Blog Draft Agent is writing...</h4>
                        <p className="text-xs text-slate-500 font-semibold">Using your brand voice config & scraped landing page keywords.</p>
                      </div>

                      <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 font-mono text-[10px] text-slate-500 overflow-y-auto max-h-[180px] space-y-2 text-left">
                        {blogLogs.map((log, idx) => (
                          <div key={idx} className="flex items-start gap-2">
                            <span className="text-[#199874]">✓</span>
                            <span className="text-slate-700 font-bold">{log}</span>
                          </div>
                        ))}
                        <div className="flex items-center gap-2 text-[#E79E24] animate-pulse">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#E79E24]" />
                          <span>Generating title, meta descriptions, and full blog post structure...</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step 3: Review & Publish */}
                  {blogWizardStep === "review" && generatedBlog && (
                    <div className="space-y-6 text-left">
                      {publishSuccess ? (
                        <div className="py-8 text-center space-y-4 animate-fade-in animate-duration-200">
                          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto text-emerald-600 text-3xl">
                            ✓
                          </div>
                          <h4 className="font-black text-slate-950 text-lg">Successfully Published!</h4>
                          <p className="text-xs text-slate-500 max-w-sm mx-auto font-semibold leading-relaxed">
                            Your blog post has been generated and saved. {selectedPlatforms.length > 0 ? `Simulated shares were pushed successfully to ${selectedPlatforms.map(p => p === "twitter" ? "X (Twitter)" : p.toUpperCase()).join(", ")}!` : "No social sharing was selected."}
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="space-y-2">
                            <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider">Generated Article Title</label>
                            <input
                              type="text"
                              value={generatedBlog.title}
                              onChange={(e) => setGeneratedBlog(prev => prev ? { ...prev, title: e.target.value } : null)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 text-xs focus:outline-none focus:border-[#199874] font-black transition-colors"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider">Article Content</label>
                            <textarea
                              value={generatedBlog.content}
                              onChange={(e) => setGeneratedBlog(prev => prev ? { ...prev, content: e.target.value } : null)}
                              className="w-full h-64 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs font-mono text-slate-700 focus:outline-none focus:border-[#199874] leading-relaxed resize-none shadow-inner"
                            />
                          </div>

                          <div className="space-y-3 pt-2">
                            <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider">Where would you like to post?</label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {[
                                { id: "linkedin", label: "LinkedIn" },
                                { id: "twitter", label: "X (Twitter)" },
                                { id: "facebook", label: "Facebook" },
                                { id: "instagram", label: "Instagram" },
                                { id: "youtube", label: "YouTube" }
                              ].map(plat => {
                                const isConnected = socialConnections[plat.id]?.connected;
                                const isChecked = selectedPlatforms.includes(plat.id);
                                return (
                                  <label
                                    key={plat.id}
                                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-xs font-bold transition-all ${
                                      !isConnected 
                                        ? "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                                        : isChecked
                                          ? "bg-[#199874]/5 border-[#199874] text-slate-900 cursor-pointer"
                                          : "bg-white border-slate-200 hover:bg-slate-55 cursor-pointer"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      disabled={!isConnected}
                                      checked={isChecked}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedPlatforms(prev => [...prev, plat.id]);
                                        } else {
                                          setSelectedPlatforms(prev => prev.filter(p => p !== plat.id));
                                        }
                                      }}
                                      className="accent-[#199874] w-4 h-4 cursor-pointer"
                                    />
                                    <div>
                                      <span>{plat.label}</span>
                                      {!isConnected && <span className="block text-[8px] text-slate-400 font-normal">Not connected</span>}
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                </div>

                {/* Footer Buttons */}
                <div className="flex gap-3 pt-4 border-t border-slate-100 shrink-0">
                  {blogWizardStep === "suggest" && (
                    <>
                      <button
                        onClick={() => setBlogWizardOpen(false)}
                        className="flex-1 bg-white hover:bg-slate-50 text-slate-500 border border-slate-200 font-bold py-3.5 rounded-xl text-xs transition-all cursor-pointer shadow-sm"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleGenerateBlog}
                        disabled={!editedTitle.trim()}
                        className="flex-1 bg-[#199874] hover:bg-[#158263] text-white font-extrabold py-3.5 rounded-xl text-xs shadow-lg transition-all cursor-pointer disabled:opacity-50"
                      >
                        Write Article
                      </button>
                    </>
                  )}

                  {blogWizardStep === "review" && (
                    <>
                      {publishSuccess ? (
                        <button
                          onClick={() => setBlogWizardOpen(false)}
                          className="w-full bg-[#199874] hover:bg-[#158263] text-white font-extrabold py-3.5 rounded-xl text-xs shadow-md transition-all cursor-pointer"
                        >
                          Finish & Close
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => setBlogWizardStep("suggest")}
                            className="flex-1 bg-white hover:bg-slate-50 text-slate-500 border border-slate-200 font-bold py-3.5 rounded-xl text-xs transition-all cursor-pointer shadow-sm"
                          >
                            Back to Title
                          </button>
                          <button
                            onClick={handlePublishBlog}
                            disabled={publishingLoading}
                            className="flex-1 bg-gradient-to-r from-[#199874] to-[#E79E24] hover:from-[#1da881] hover:to-[#f0ab35] text-white font-extrabold py-3.5 rounded-xl text-xs shadow-lg transition-all cursor-pointer"
                          >
                            {publishingLoading ? "Publishing..." : "Publish Blog & Share"}
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>

              </div>
            </div>
          )}


          {/* TAB: PLAN (30-Day Plan with dependency sequencing) */}
          {activeTab === "plan" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-slate-900">30-Day Growth Plan</h2>
                <span className="text-xs text-slate-500">Sequenced by the Plan Agent · Tasks unlock based on dependencies</span>
              </div>
              {["Week 1", "Week 2", "Week 3", "Week 4"].map(week => {
                const weekTasks = tasks.filter(t => t.week === week);
                return (
                  <div key={week} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="bg-slate-50 px-6 py-3 border-b border-slate-100 flex items-center gap-2">
                      <span className="text-sm font-black text-slate-800">{week}</span>
                      <span className="text-xs text-slate-400">{weekTasks.length} task{weekTasks.length !== 1 ? "s" : ""}</span>
                    </div>
                    {weekTasks.length === 0 ? (
                      <div className="px-6 py-4 text-xs text-slate-400 italic">No tasks scheduled — complete earlier weeks to unlock.</div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {weekTasks.map(task => (
                          <div key={task.id} className="px-6 py-4 flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`inline-block w-2 h-2 rounded-full ${
                                  task.status === "approved" ? "bg-[#199874]" :
                                  task.status === "ignored" ? "bg-slate-300" :
                                  task.status === "edited" ? "bg-amber-400" : "bg-blue-400"
                                }`} />
                                <p className="text-sm font-bold text-slate-900 truncate">{task.title}</p>
                                {/* Trust badge */}
                                <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#199874]/10 text-[#199874] border border-[#199874]/20">L1</span>
                              </div>
                              <p className="text-xs text-slate-500 mb-2">{task.detail}</p>
                              <div className="flex flex-wrap gap-2 text-[10px]">
                                <span className="text-slate-400">{task.source}</span>
                                <span className="font-bold text-[#199874]">{task.metric}</span>
                                <span className="text-slate-400">via {task.agent}</span>
                              </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              {task.status === "pending" && (
                                <>
                                  <button
                                    disabled={approveLoading === task.id}
                                    onClick={() => handleTaskStatusChange(task.id, "approved")}
                                    className="px-3 py-1.5 bg-[#199874] hover:bg-[#158263] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => handleTaskStatusChange(task.id, "ignored")}
                                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                                  >
                                    Ignore
                                  </button>
                                </>
                              )}
                              {task.status === "approved" && (
                                <span className="px-3 py-1.5 bg-[#199874]/10 text-[#199874] text-xs font-bold rounded-lg">✓ Approved</span>
                              )}
                              {task.status === "ignored" && (
                                <span className="px-3 py-1.5 bg-slate-100 text-slate-400 text-xs font-bold rounded-lg">Ignored</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB: ALERTS / MONITORING */}
          {activeTab === "alerts" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-slate-900">Alerts &amp; Monitoring</h2>
                <span className="text-xs text-slate-500">
                  {liveAlerts.filter(a => !a.acknowledged).length} unacknowledged
                </span>
              </div>

              {liveAlerts.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                  <div className="text-4xl mb-3">✅</div>
                  <p className="text-slate-600 font-bold">No alerts — everything looks healthy.</p>
                  <p className="text-xs text-slate-400 mt-1">Anomaly detection runs daily. Stripe events surface in real time.</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="text-left px-4 py-3 font-black text-slate-500 uppercase tracking-wider">Metric</th>
                        <th className="text-left px-4 py-3 font-black text-slate-500 uppercase tracking-wider">Severity</th>
                        <th className="text-left px-4 py-3 font-black text-slate-500 uppercase tracking-wider">Source</th>
                        <th className="text-left px-4 py-3 font-black text-slate-500 uppercase tracking-wider">z-Score</th>
                        <th className="text-left px-4 py-3 font-black text-slate-500 uppercase tracking-wider">Message</th>
                        <th className="text-left px-4 py-3 font-black text-slate-500 uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {liveAlerts.map(alert => (
                        <tr key={alert.id} className={alert.acknowledged ? "opacity-40" : ""}>
                          <td className="px-4 py-3 font-bold text-slate-800">{alert.metricType}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full font-black uppercase tracking-wider ${
                              alert.severity === "critical" ? "bg-red-100 text-red-700" :
                              alert.severity === "warning"  ? "bg-amber-100 text-amber-700" :
                              "bg-slate-100 text-slate-600"
                            }`}>{alert.severity}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full font-bold ${
                              alert.source === "stripe_realtime" ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-600"
                            }`}>{alert.source === "stripe_realtime" ? "⚡ Stripe" : "📊 Batch"}</span>
                          </td>
                          <td className="px-4 py-3 font-mono text-red-600">{alert.zScore.toFixed(2)}</td>
                          <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{alert.message}</td>
                          <td className="px-4 py-3">
                            {alert.acknowledged
                              ? <span className="text-slate-400">✓ Ack&apos;d</span>
                              : <span className="text-amber-600 font-bold">Unacknowledged</span>
                            }
                          </td>
                          <td className="px-4 py-3">
                            {!alert.acknowledged && (
                              <button
                                disabled={alertAckLoading === alert.id}
                                onClick={() => {
                                  setAlertAckLoading(alert.id);
                                  fetch(`/api/alerts/${alert.id}/acknowledge`, { method: "PATCH" })
                                    .then(r => r.json())
                                    .then(d => {
                                      if (d.ok) setLiveAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, acknowledged: true } : a));
                                    })
                                    .catch(console.error)
                                    .finally(() => setAlertAckLoading(null));
                                }}
                                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                              >
                                {alertAckLoading === alert.id ? "..." : "Acknowledge"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB: INTEGRATIONS (expanded with GA4 + Stripe) */}
          {activeTab === "integrations" && (
            <div className="space-y-6">
              <h2 className="text-lg font-black text-slate-900">Integrations</h2>

              {/* Analytics + Revenue */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-slate-50 px-6 py-3 border-b border-slate-100">
                  <span className="text-sm font-black text-slate-800">Analytics &amp; Revenue</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {[
                    { id: "ga4",    label: "Google Analytics 4", icon: "📊", description: "Traffic + conversions ingested daily" },
                    { id: "stripe", label: "Stripe",             icon: "💳", description: "MRR, churn events, failed payments via webhook" },
                  ].map(intg => {
                    const conn = socialConnections[intg.id as keyof typeof socialConnections];
                    return (
                      <div key={intg.id} className="px-6 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{intg.icon}</span>
                          <div>
                            <p className="font-bold text-sm text-slate-900">{intg.label}</p>
                            <p className="text-xs text-slate-400">{intg.description}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            conn?.connected ? "bg-[#199874]/10 text-[#199874]" : "bg-slate-100 text-slate-400"
                          }`}>{conn?.connected ? "✓ Connected" : "Not connected"}</span>
                          <button
                            disabled={syncLoading === intg.id}
                            onClick={() => {
                              if (!activeBrand) return;
                              setSyncLoading(intg.id);
                              fetch(`/api/cron/daily`, { headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET ?? ""}` } })
                                .finally(() => setSyncLoading(null));
                            }}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
                          >
                            {syncLoading === intg.id ? "Syncing..." : "Sync now"}
                          </button>
                          {!conn?.connected && (
                            <button
                              onClick={() => handleConnectSocialClick(intg.id, intg.label)}
                              className="px-3 py-1.5 bg-[#199874] hover:bg-[#158263] text-white text-xs font-bold rounded-lg cursor-pointer"
                            >
                              Connect
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Social */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-slate-50 px-6 py-3 border-b border-slate-100">
                  <span className="text-sm font-black text-slate-800">Social Platforms</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {[
                    { id: "linkedin",  label: "LinkedIn",  icon: "💼" },
                    { id: "youtube",   label: "YouTube",   icon: "▶️" },
                    { id: "facebook",  label: "Facebook",  icon: "📘" },
                    { id: "instagram", label: "Instagram", icon: "📷" },
                    { id: "twitter",   label: "X/Twitter", icon: "🐦" },
                  ].map(plat => {
                    const conn = socialConnections[plat.id as keyof typeof socialConnections];
                    return (
                      <div key={plat.id} className="px-6 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{plat.icon}</span>
                          <div>
                            <p className="font-bold text-sm text-slate-900">{plat.label}</p>
                            {conn?.handle && <p className="text-xs text-slate-400">@{conn.handle}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            conn?.connected ? "bg-[#199874]/10 text-[#199874]" : "bg-slate-100 text-slate-400"
                          }`}>{conn?.connected ? "✓ Connected" : "Not connected"}</span>
                          <button
                            onClick={() => handleConnectSocialClick(plat.id, plat.label)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
                          >
                            {conn?.connected ? "Manage" : "Connect"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
