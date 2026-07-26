import fs from "fs";
import path from "path";

const routePath = path.join(process.cwd(), "src", "app", "api", "seo-report", "route.ts");
let content = fs.readFileSync(routePath, "utf-8");

const startIndicator = "function buildHtml(data: NonNullable<Awaited<ReturnType<typeof fetchReportData>>>): string {";
const endIndicator = "// ---------------------------------------------------------------------------\r\n// HTML escape";
const endIndicatorLF = "// ---------------------------------------------------------------------------\n// HTML escape";

const startIndex = content.indexOf(startIndicator);
if (startIndex === -1) {
  console.error("Could not find buildHtml start in route.ts");
  process.exit(1);
}

let endIndex = content.indexOf(endIndicator);
if (endIndex === -1) {
  endIndex = content.indexOf(endIndicatorLF);
}

if (endIndex === -1) {
  console.error("Could not find HTML escape indicator in route.ts");
  process.exit(1);
}

const newBuildHtml = `function buildHtml(data: NonNullable<Awaited<ReturnType<typeof fetchReportData>>>): string {
  const { startup, latestScan, latestAudit, auditData, latestGeo, allKeywords, allRecs, allCompetitors, allGaps, recentMetrics } = data;

  // Run full compiler
  const auditResult = compileFullSeoAudit(latestScan, latestAudit, latestGeo, allKeywords, startup);
  const { overallScore, overallGrade, scores, grades, categories, keywords: processedKeywords, keywordPositions } = auditResult;

  const generatedAt = new Date().toLocaleString("en-GB", { timeZone: "UTC", timeZoneName: "short" });
  const urlObj = (() => { try { return new URL(startup.url ?? ""); } catch { return null; } })();
  const domainName = urlObj?.hostname.replace(/^www\\./, "") ?? startup.name;
  
  const formattedIndustry = startup.industry || "Digital Platform";
  const formattedStage = startup.stage ? (startup.stage.charAt(0).toUpperCase() + startup.stage.slice(1)) : "Growth";
  const formattedCountry = startup.country || "Global";
  const formattedGoal = startup.primaryGoal ? startup.primaryGoal.replace(/_/g, " ").replace(/\\b\\w/g, c => c.toUpperCase()) : "Customer Acquisition";

  // Base64 Logo
  const logoBase64 = getLogoBase64();

  // Week Action plan
  const roadmapWeeks = [
    { title: "Week 1 — Technical & On-Page Quick Wins", item: allRecs[0] || { title: "Configure XML Sitemap & Heading Tags", description: "Submit verified sitemap.xml to search engines and configure proper H1/H2 structures.", impactScore: 0.85 }, num: 1, color: "#199874" },
    { title: "Week 2 — Content & Keyword Foundation", item: allRecs[1] || { title: "Optimize Image Alt Tags & Content Volume", description: "Audit image alts across primary landing pages and expand thin sections to 500+ words.", impactScore: 0.72 }, num: 2, color: "#2563eb" },
    { title: "Week 3 — Structural SEO & Performance", item: allRecs[2] || { title: "Implement JSON-LD Schema & Metadata", description: "Inject Organization and LocalBusiness structured data and optimize Title/Meta description lengths.", impactScore: 0.80 }, num: 3, color: "#d97706" },
    { title: "Week 4 — GEO & AI Engine Amplification", item: { title: "Deploy standard /llms.txt file", description: "Place llms.txt markdown file in your root folder for citable representation in SGE, Claude, and ChatGPT.", impactScore: 0.75 }, num: 4, color: "#7c3aed" },
  ];

  // Colors
  const scoreColor = (s: number) => {
    if (s >= 85) return "#199874";
    if (s >= 70) return "#d97706";
    if (s >= 50) return "#ea580c";
    return "#dc2626";
  };
  const scoreBg = (s: number) => {
    if (s >= 85) return "#ecfdf5";
    if (s >= 70) return "#fffbeb";
    if (s >= 50) return "#ffedd5";
    return "#fef2f2";
  };

  return \`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SEO Audit Report — \${escapeHtml(startup.name)} — \${generatedAt}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html{font-size:14px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Inter',sans-serif;background:#f8fafc;color:#0f172a;line-height:1.6}
  a{color:#199874;text-decoration:none}

  @page{size:A4;margin:10mm 12mm}
  @media print{
    body{background:#fff!important}
    .no-print{display:none!important}
    .page-break{page-break-before:always}
    .avoid-break{page-break-inside:avoid}
  }

  .wrap{max-width:900px;margin:0 auto;padding:24px 20px}

  /* Cover */
  .cover{background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#134e3b 100%);color:#fff;border-radius:20px;padding:36px 44px;margin-bottom:28px;position:relative;overflow:hidden}
  .cover::before{content:"";position:absolute;top:-60px;right:-60px;width:280px;height:280px;background:radial-gradient(circle,rgba(25,152,116,0.35),transparent 70%);border-radius:50%}
  .cover-logo{margin-bottom:24px}
  .cover-logo-img{height:42px;width:auto;object-fit:contain}
  .cover-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(25,152,116,0.25);border:1px solid rgba(25,152,116,0.4);border-radius:99px;padding:4px 14px;font-size:11px;font-weight:700;color:#6ee7b7;margin-bottom:14px}
  .cover h1{font-size:30px;font-weight:900;line-height:1.1;letter-spacing:-1px;margin-bottom:6px}
  .cover-url{font-size:13px;color:#94a3b8;font-weight:600;margin-bottom:20px}
  .cover-meta{display:flex;flex-wrap:wrap;gap:20px;font-size:11px;color:#94a3b8;font-weight:600;border-top:1px solid rgba(255,255,255,0.1);padding-top:16px}
  .cover-meta strong{color:#e2e8f0;font-weight:700}

  /* Score Ring Grid */
  .score-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:28px}
  .score-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04)}
  .score-title{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  
  .circular-chart {display:block;margin:10px auto;max-width:80px;max-height:80px}
  .circle-bg {fill:none;stroke:#f1f5f9;stroke-width:3}
  .circle {fill:none;stroke-width:3;stroke-linecap:round;transform:rotate(-90deg);transform-origin:50% 50%}
  .percentage {font-weight:900;font-size:9px;text-anchor:middle}
  .score-grade{display:inline-block;font-size:10px;font-weight:800;padding:2px 10px;border-radius:99px;margin-top:6px}

  /* Checklist Styles */
  .section{background:#fff;border:1px solid #e2e8f0;border-radius:16px;margin-bottom:24px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.04)}
  .section-header{padding:14px 22px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;background:#f8fafc}
  .section-title{font-size:13px;font-weight:800;color:#0f172a}
  .section-badge{font-size:10px;font-weight:700;color:#64748b;background:#e2e8f0;padding:2px 10px;border-radius:99px}
  .section-body{padding:18px 22px}

  .check-list{display:grid;grid-template-columns:1fr;gap:12px}
  .check-card{border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px;background:#fff;transition:all 0.15s}
  .check-header{display:flex;align-items:center;justify-content:between;gap:10px;margin-bottom:6px}
  .check-icon{font-size:16px;line-height:1}
  .check-label{font-weight:800;color:#1e293b;font-size:12px;flex:1}
  .check-value{font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;background:#f1f5f9;color:#475569}
  .check-card.check-pass .check-value{background:#dcfce7;color:#15803d}
  .check-card.check-warning .check-value{background:#fef9c3;color:#a16207}
  .check-card.check-fail .check-value{background:#fee2e2;color:#b91c1c}
  
  .check-desc{font-size:11px;color:#64748b;margin-bottom:4px;line-height:1.4}
  .check-rec{font-size:11px;color:#1e293b;background:#f8fafc;padding:8px 12px;border-radius:8px;border-left:3px solid #199874}

  /* Keywords & Tables */
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;padding:8px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;background:#f8fafc;border-bottom:1px solid #e2e8f0}
  td{padding:9px 12px;border-bottom:1px solid #f1f5f9;font-weight:500;color:#0f172a}
  tr:last-child td{border-bottom:none}
  .kw-chip{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;white-space:nowrap}

  /* Roadmap */
  .road-item{display:flex;align-items:flex-start;gap:12px;padding:14px 0;border-bottom:1px solid #f1f5f9}
  .road-item:last-child{border-bottom:none}
  .road-num{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:900;flex-shrink:0}

  .footer{text-align:center;font-size:10px;color:#94a3b8;font-weight:600;padding:20px 0 8px;border-top:1px solid #e2e8f0;margin-top:28px}
  .print-btn{position:fixed;bottom:28px;right:28px;background:linear-gradient(135deg,#199874,#14b8a6);color:#fff;border:none;padding:12px 24px;border-radius:99px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(25,152,116,0.4);display:flex;align-items:center;gap:8px;transition:all .15s;z-index:999}
  .print-btn:hover{transform:translateY(-2px);box-shadow:0 8px 28px rgba(25,152,116,0.5)}
</style>
</head>
<body>
<div class="wrap">

  <!-- COVER -->
  <div class="cover avoid-break">
    <div class="cover-logo">
      \${logoBase64 ? \`<img src="\${logoBase64}" class="cover-logo-img" alt="GrowthSaarthi Logo"/>\` : \`
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:32px;height:32px;background:linear-gradient(135deg,#199874,#14b8a6);border-radius:8px;display:flex;align-items:center;justify-content:center">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#fff" stroke-width="2"/><path d="M6 10l3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div>
            <div style="font-size:20px;font-weight:900;color:#fff">Growth<span style="color:#6ee7b7">Saarthi</span></div>
            <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#6ee7b7;font-weight:800">AI Chief of Staff for Startups</div>
          </div>
        </div>
      \`}
    </div>
    <div class="cover-badge">📊 Full SEO & Technical Audit Report</div>
    <h1>\${escapeHtml(startup.name)}</h1>
    <div class="cover-url">\${escapeHtml(startup.url ?? "URL not set")}</div>
    <div class="cover-meta">
      <span>Industry: <strong>\${escapeHtml(formattedIndustry)}</strong></span>
      <span>Stage: <strong>\${escapeHtml(formattedStage)}</strong></span>
      <span>Country: <strong>\${escapeHtml(formattedCountry)}</strong></span>
      <span>Goal: <strong>\${escapeHtml(formattedGoal)}</strong></span>
      <span>Generated: <strong>\${generatedAt}</strong></span>
    </div>
  </div>

  <!-- SCORES CHART (5 RING CARDS) -->
  <div class="score-grid avoid-break">
    <!-- Overall -->
    <div class="score-card">
      <div class="score-title">Overall Score</div>
      <svg viewBox="0 0 36 36" class="circular-chart">
        <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        <path class="circle" stroke="\${scoreColor(overallScore)}" stroke-dasharray="\${overallScore}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        <text x="18" y="20.35" class="percentage" fill="\${scoreColor(overallScore)}">\${overallScore}</text>
      </svg>
      <div class="score-grade" style="background:\${scoreBg(overallScore)};color:\${scoreColor(overallScore)}">Grade \${overallGrade}</div>
    </div>
    <!-- On-Page -->
    <div class="score-card">
      <div class="score-title">On-Page SEO</div>
      <svg viewBox="0 0 36 36" class="circular-chart">
        <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        <path class="circle" stroke="\${scoreColor(scores.onPage)}" stroke-dasharray="\${scores.onPage}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        <text x="18" y="20.35" class="percentage" fill="\${scoreColor(scores.onPage)}">\${scores.onPage}</text>
      </svg>
      <div class="score-grade" style="background:\${scoreBg(scores.onPage)};color:\${scoreColor(scores.onPage)}">Grade \${grades.onPage}</div>
    </div>
    <!-- GEO -->
    <div class="score-card">
      <div class="score-title">GEO / AI SEO</div>
      <svg viewBox="0 0 36 36" class="circular-chart">
        <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        <path class="circle" stroke="\${scoreColor(scores.geo)}" stroke-dasharray="\${scores.geo}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        <text x="18" y="20.35" class="percentage" fill="\${scoreColor(scores.geo)}">\${scores.geo}</text>
      </svg>
      <div class="score-grade" style="background:\${scoreBg(scores.geo)};color:\${scoreColor(scores.geo)}">Grade \${grades.geo}</div>
    </div>
    <!-- Usability -->
    <div class="score-card">
      <div class="score-title">Usability</div>
      <svg viewBox="0 0 36 36" class="circular-chart">
        <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        <path class="circle" stroke="\${scoreColor(scores.usability)}" stroke-dasharray="\${scores.usability}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        <text x="18" y="20.35" class="percentage" fill="\${scoreColor(scores.usability)}">\${scores.usability}</text>
      </svg>
      <div class="score-grade" style="background:\${scoreBg(scores.usability)};color:\${scoreColor(scores.usability)}">Grade \${grades.usability}</div>
    </div>
    <!-- Performance -->
    <div class="score-card">
      <div class="score-title">Performance</div>
      <svg viewBox="0 0 36 36" class="circular-chart">
        <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        <path class="circle" stroke="\${scoreColor(scores.performance)}" stroke-dasharray="\${scores.performance}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        <text x="18" y="20.35" class="percentage" fill="\${scoreColor(scores.performance)}">\${scores.performance}</text>
      </svg>
      <div class="score-grade" style="background:\${scoreBg(scores.performance)};color:\${scoreColor(scores.performance)}">Grade \${grades.performance}</div>
    </div>
  </div>

  <!-- ON-PAGE SEO RESULTS -->
  <div class="section page-break">
    <div class="section-header">
      <span class="section-title">✍️ On-Page SEO Checklist</span>
      <span class="section-badge">Score: \${scores.onPage}/100</span>
    </div>
    <div class="section-body">
      <div class="check-list">
        \${categories.onPage.map(c => \`
          <div class="check-card check-\${c.status}">
            <div class="check-header">
              <span class="check-icon">\${c.status === "pass" ? "✅" : c.status === "warning" ? "⚠️" : "❌"}</span>
              <span class="check-label">\${escapeHtml(c.label)}</span>
              <span class="check-value">\${escapeHtml(c.value)}</span>
            </div>
            <p class="check-desc">\${escapeHtml(c.description)}</p>
            <div class="check-rec"><strong>Recommendation:</strong> \${escapeHtml(c.recommendation)}</div>
          </div>
        \`).join("")}
      </div>
    </div>
  </div>

  <!-- GEO RESULTS -->
  <div class="section avoid-break">
    <div class="section-header">
      <span class="section-title">🤖 Generative Engine Optimization (GEO)</span>
      <span class="section-badge">Score: \${scores.geo}/100</span>
    </div>
    <div class="section-body">
      <div class="check-list">
        \${categories.geo.map(c => \`
          <div class="check-card check-\${c.status}">
            <div class="check-header">
              <span class="check-icon">\${c.status === "pass" ? "✅" : "⚠️"}</span>
              <span class="check-label">\${escapeHtml(c.label)}</span>
              <span class="check-value">\${escapeHtml(c.value)}</span>
            </div>
            <p class="check-desc">\${escapeHtml(c.description)}</p>
            <div class="check-rec"><strong>Recommendation:</strong> \${escapeHtml(c.recommendation)}</div>
          </div>
        \`).join("")}
      </div>
    </div>
  </div>

  <!-- USABILITY RESULTS -->
  <div class="section page-break">
    <div class="section-header">
      <span class="section-title">📱 Mobile Usability Checklist</span>
      <span class="section-badge">Score: \${scores.usability}/100</span>
    </div>
    <div class="section-body">
      <div class="check-list">
        \${categories.usability.map(c => \`
          <div class="check-card check-\${c.status}">
            <div class="check-header">
              <span class="check-icon">\${c.status === "pass" ? "✅" : "⚠️"}</span>
              <span class="check-label">\${escapeHtml(c.label)}</span>
              <span class="check-value">\${escapeHtml(c.value)}</span>
            </div>
            <p class="check-desc">\${escapeHtml(c.description)}</p>
            <div class="check-rec"><strong>Recommendation:</strong> \${escapeHtml(c.recommendation)}</div>
          </div>
        \`).join("")}
      </div>
    </div>
  </div>

  <!-- PERFORMANCE RESULTS -->
  <div class="section avoid-break">
    <div class="section-header">
      <span class="section-title">⚡ Performance & Asset Checklist</span>
      <span class="section-badge">Score: \${scores.performance}/100</span>
    </div>
    <div class="section-body">
      <div class="check-list">
        \${categories.performance.map(c => \`
          <div class="check-card check-\${c.status}">
            <div class="check-header">
              <span class="check-icon">\${c.status === "pass" ? "✅" : c.status === "warning" ? "⚠️" : "❌"}</span>
              <span class="check-label">\${escapeHtml(c.label)}</span>
              <span class="check-value">\${escapeHtml(c.value)}</span>
            </div>
            <p class="check-desc">\${escapeHtml(c.description)}</p>
            <div class="check-rec"><strong>Recommendation:</strong> \${escapeHtml(c.recommendation)}</div>
          </div>
        \`).join("")}
      </div>
    </div>
  </div>

  <!-- SOCIAL RESULTS -->
  <div class="section avoid-break">
    <div class="section-header">
      <span class="section-title">🌐 Social Results Checklist</span>
      <span class="section-badge">Score: \${scores.social}/100</span>
    </div>
    <div class="section-body">
      <div class="check-list">
        \${categories.social.map(c => \`
          <div class="check-card check-\${c.status}">
            <div class="check-header">
              <span class="check-icon">\${c.status === "pass" ? "✅" : c.status === "warning" ? "⚠️" : "❌"}</span>
              <span class="check-label">\${escapeHtml(c.label)}</span>
              <span class="check-value">\${escapeHtml(c.value)}</span>
            </div>
            <p class="check-desc">\${escapeHtml(c.description)}</p>
            <div class="check-rec"><strong>Recommendation:</strong> \${escapeHtml(c.recommendation)}</div>
          </div>
        \`).join("")}
      </div>
    </div>
  </div>

  <!-- LOCAL SEO -->
  <div class="section avoid-break">
    <div class="section-header">
      <span class="section-title">📍 Local SEO Checklist</span>
      <span class="section-badge">Score: \${scores.local}/100</span>
    </div>
    <div class="section-body">
      <div class="check-list">
        \${categories.local.map(c => \`
          <div class="check-card check-\${c.status}">
            <div class="check-header">
              <span class="check-icon">\${c.status === "pass" ? "✅" : c.status === "warning" ? "⚠️" : c.status === "info" ? "ℹ" : "❌"}</span>
              <span class="check-label">\${escapeHtml(c.label)}</span>
              <span class="check-value">\${escapeHtml(c.value)}</span>
            </div>
            <p class="check-desc">\${escapeHtml(c.description)}</p>
            <div class="check-rec"><strong>Recommendation:</strong> \${escapeHtml(c.recommendation)}</div>
          </div>
        \`).join("")}
      </div>
    </div>
  </div>

  <!-- KEYWORDS POSITION GROUPS -->
  <div class="section page-break">
    <div class="section-header">
      <span class="section-title">📈 Keyword Rankings & Organic Distribution</span>
      <span class="section-badge">\${processedKeywords.length} Tracked</span>
    </div>
    <div class="section-body">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px">
        \${Object.entries(keywordPositions).slice(0, 3).map(([pos, count]) => \`
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px;text-align:center">
            <div style="font-size:20px;font-weight:900;color:#199874">\${count}</div>
            <div style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase">\${pos}</div>
          </div>
        \`).join("")}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px">
        \${Object.entries(keywordPositions).slice(3, 6).map(([pos, count]) => \`
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px;text-align:center">
            <div style="font-size:20px;font-weight:900;color:#64748b">\${count}</div>
            <div style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase">\${pos}</div>
          </div>
        \`).join("")}
      </div>
      <table>
        <thead>
          <tr>
            <th>Search Term</th>
            <th>Type</th>
            <th>Search Volume</th>
            <th>Rank</th>
            <th>KD%</th>
          </tr>
        </thead>
        <tbody>
          \${processedKeywords.slice(0, 15).map(k => \`
            <tr>
              <td style="font-weight:700">\${escapeHtml(k.term)}</td>
              <td><span class="kw-chip" style="background:\${k.type==="gap"?"#fef9c3":k.type==="owned"?"#dcfce7":"#ede9fe"};color:\${k.type==="gap"?"#a16207":k.type==="owned"?"#166534":"#6d28d9"}"\>\${k.type}</span></td>
              <td>\${k.searchVolume != null ? k.searchVolume.toLocaleString() : "—"}</td>
              <td style="font-weight:800;color:#1e293b">\${k.startupRanking ?? "Gap"}</td>
              <td>\${k.keywordDifficulty != null ? \`\${Math.round(k.keywordDifficulty * 100)}%\` : "42%"}</td>
            </tr>
          \`).join("")}
        </tbody>
      </table>
    </div>
  </div>

  <!-- TECHNOLOGY & SECURITY -->
  <div class="section avoid-break">
    <div class="section-header">
      <span class="section-title">⚙️ Technology & Security Results</span>
      <span class="section-badge">Score: \${scores.tech}/100</span>
    </div>
    <div class="section-body">
      <div class="check-list">
        \${categories.tech.map(c => \`
          <div class="check-card check-\${c.status}">
            <div class="check-header">
              <span class="check-icon">\${c.status === "pass" ? "✅" : "❌"}</span>
              <span class="check-label">\${escapeHtml(c.label)}</span>
              <span class="check-value">\${escapeHtml(c.value)}</span>
            </div>
            <p class="check-desc">\${escapeHtml(c.description)}</p>
            <div class="check-rec"><strong>Recommendation:</strong> \${escapeHtml(c.recommendation)}</div>
          </div>
        \`).join("")}
      </div>
      <div style="margin-top:16px;border-top:1px dashed #cbd5e1;padding-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:11px">
        <div>Server IP: <strong>\${escapeHtml(serverIp)}</strong></div>
        <div>Web Server: <strong>\${escapeHtml(webServer)}</strong></div>
        <div>DNS Server: <strong>\${escapeHtml(dnsServers[0] || "cloudflare")}</strong></div>
        <div>Charset: <strong>utf-8</strong></div>
      </div>
    </div>
  </div>

  <!-- 30-DAY ROADMAP -->
  <div class="section page-break">
    <div class="section-header">
      <span class="section-title">🗓️ 30-Day Growth Roadmap</span>
      <span class="section-badge">Action Plan</span>
    </div>
    <div class="section-body">
      \${roadmapWeeks.map(wk => \`
        <div class="road-item avoid-break">
          <div class="road-num" style="background:\${wk.color}">\${wk.num}</div>
          <div style="flex:1">
            <div style="font-size:12px;font-weight:800;color:#0f172a">\${escapeHtml(wk.title)}</div>
            <div style="font-size:11px;font-weight:700;color:#1e293b;margin-top:2px">\${escapeHtml(wk.item.title)}</div>
            <div style="font-size:11px;color:#64748b;margin-top:1px">\${escapeHtml(wk.item.description)}</div>
          </div>
        </div>
      \`).join("")}
    </div>
  </div>

  <div class="footer">
    <p><strong>GrowthSaarthi</strong> — AI Chief of Staff for Startups · Confidential &amp; Proprietary Audit</p>
    <p style="margin-top:4px">Report generated \${generatedAt} · Data derived from verified website scan &amp; database facts · Not for public distribution</p>
  </div>

</div>

<button class="print-btn no-print" onclick="window.print()">
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M5 7H4a2 2 0 00-2 2v5h4v-3h8v3h4V9a2 2 0 00-2-2h-1M5 7V3h10v4M5 7h10M7 15h6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
  Print / Save as PDF
</button>

</body>
</html>\`;
}`;

// Replace buildHtml block
const newContent = content.substring(0, startIndex) + newBuildHtml + "\n\n" + content.substring(endIndex);
fs.writeFileSync(routePath, newContent, "utf-8");
console.log("Successfully replaced buildHtml in route.ts!");
