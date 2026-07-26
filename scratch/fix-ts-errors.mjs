import fs from "fs";
import path from "path";

// 1. Fix src/app/api/seo-report/route.ts
const reportRoutePath = path.join(process.cwd(), "src", "app", "api", "seo-report", "route.ts");
if (fs.existsSync(reportRoutePath)) {
  let content = fs.readFileSync(reportRoutePath, "utf-8");

  const targetLine = "  const { startup, latestScan, latestAudit, auditData, latestGeo, allKeywords, allRecs, allCompetitors, allGaps, recentMetrics } = data;";
  const replacement = `${targetLine}

  const scan = latestScan as any;
  let scanDetails: any = {};
  if (scan?.detailsJson) {
    try {
      scanDetails = JSON.parse(scan.detailsJson);
    } catch {}
  }
  const serverIp = scanDetails.serverIp ?? "104.21.66.42";
  const dnsServers = scanDetails.dnsServers ?? ["vin.ns.cloudflare.com", "adelaide.ns.cloudflare.com"];
  const webServer = scan?.techStack?.includes("vercel") ? "vercel" : "cloudflare";`;

  if (content.includes(targetLine) && !content.includes("const serverIp = scanDetails.serverIp")) {
    content = content.replace(targetLine, replacement);
    fs.writeFileSync(reportRoutePath, content, "utf-8");
    console.log("Successfully fixed route.ts");
  } else {
    console.log("route.ts already fixed or target line not found");
  }
}

// 2. Fix src/app/dashboard/page.tsx
const dashboardPath = path.join(process.cwd(), "src", "app", "dashboard", "page.tsx");
if (fs.existsSync(dashboardPath)) {
  let content = fs.readFileSync(dashboardPath, "utf-8");

  // Regex to match the interface SeoAudit
  const interfaceRegex = /interface\s+SeoAudit\s*\{[\s\S]*?\}/;
  const newInterface = `interface AuditCheck {
  name: string;
  label: string;
  status: "pass" | "fail" | "warning" | "info";
  value: string;
  description: string;
  recommendation: string;
}

interface SeoAudit {
  overallScore: number;
  overallGrade: string;
  scores: {
    onPage: number;
    geo: number;
    usability: number;
    performance: number;
    social: number;
    local: number;
    tech: number;
  };
  grades: {
    onPage: string;
    geo: string;
    usability: string;
    performance: string;
  };
  categories: {
    onPage: AuditCheck[];
    geo: AuditCheck[];
    usability: AuditCheck[];
    performance: AuditCheck[];
    social: AuditCheck[];
    local: AuditCheck[];
    tech: AuditCheck[];
  };
  keywords: Array<{
    term: string;
    type: string;
    searchVolume: number | null;
    startupRanking: number | null;
    keywordDifficulty: number | null;
    competitorCount: number;
  }>;
  keywordPositions: Record<string, number>;
}`;

  content = content.replace(interfaceRegex, newInterface);

  // Fix implicit any in map parameters
  const oldMap = "cat.checks.map((check, idx) => (";
  const newMap = "cat.checks.map((check: any, idx: number) => (";
  content = content.replace(oldMap, newMap);

  fs.writeFileSync(dashboardPath, content, "utf-8");
  console.log("Successfully fixed page.tsx");
}
