import fs from "fs";
import path from "path";

const pagePath = path.join(process.cwd(), "src", "app", "dashboard", "page.tsx");
let content = fs.readFileSync(pagePath, "utf-8");

// 1. Replace SeoAudit interface definition
const interfaceOld = `interface SeoAudit {
  score: number;
  grade: string;
  priorities?: Array<{ title?: string; description?: string; impact?: string; category?: string }>;
  audit?: {
    meta?: { score?: number };
    technical?: { score?: number };
  };
}`;

const interfaceNew = `interface AuditCheck {
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

content = content.replace(interfaceOld, interfaceNew);

// 2. Add expandedCategory state right after activeTab state definition
const activeTabLine = `const [activeTab, setActiveTab] = useState<"brand_create" | "overview" | "plan" | "seo" | "competitors" | "blogs" | "socials" | "social_connect" | "alerts" | "integrations">("brand_create");`;
const activeTabLineNew = `${activeTabLine}\n  const [expandedCategory, setExpandedCategory] = useState<string | null>("onPage");`;

content = content.replace(activeTabLine, activeTabLineNew);

// 3. Update fetch URL to pass startupId and fetch dynamically regardless of URL value
const fetchOld = `        brand.url && brand.url !== "devsking.com"
          ? fetch(\`/api/seo-audit?url=\${encodeURIComponent(brand.url)}\`).then(r => r.json()).catch(() => null)
          : Promise.resolve(null),`;

const fetchNew = `        brand.url
          ? fetch(\`/api/seo-audit?url=\${encodeURIComponent(brand.url)}&startupId=\${sid}\`).then(r => r.json()).catch(() => null)
          : Promise.resolve(null),`;

content = content.replace(fetchOld, fetchNew);

// 4. Replace SEO Tab Render Block
const seoTabOldStart = `{/* TAB 3: SEO ANALYSIS — real data from recommendations + SEOScoreAPI */}`;
const seoTabOldEnd = `{/* TAB 4: COMPETITOR INSIGHTS — real data from competitor-agent */}`;

const startIndex = content.indexOf(seoTabOldStart);
const endIndex = content.indexOf(seoTabOldEnd);

if (startIndex === -1 || endIndex === -1) {
  console.error("Could not find SEO Tab render block bounds in page.tsx");
  process.exit(1);
}

const seoTabNew = `${seoTabOldStart}
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
                        <p className="text-xs text-slate-500 font-semibold mt-1">Live analysis from SEOScoreAPI + AI recommendation engine. Results are based on the website URL and DNS records.</p>
                      </div>
                      {/* Download Report Button */}
                      <button
                        id="download-seo-report-btn"
                        onClick={async () => {
                          if (!activeBrand) return;
                          const btn = document.getElementById("download-seo-report-btn") as HTMLButtonElement;
                          const original = btn.innerHTML;
                          btn.disabled = true;
                          btn.innerHTML = \`<svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg><span>Generating…</span>\`;
                          try {
                            const res = await fetch(\`/api/seo-report?startupId=\${activeBrand.startupId}\`);
                            if (!res.ok) throw new Error("Report generation failed");
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = \`seo-audit-\${activeBrand.name.replace(/\\\\s+/g, "-").toLowerCase()}-\${new Date().toISOString().slice(0,10)}.html\`;
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

                    {/* Circular Score Rings (Lighthouse Style) */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-2">Overall Score</span>
                        <div className="relative w-16 h-16 flex items-center justify-center">
                          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                            <circle className="text-slate-200" strokeWidth="3" stroke="currentColor" fill="none" r="16" cx="18" cy="18"/>
                            <circle className="text-[#199874] transition-all" strokeWidth="3" strokeDasharray="\${seoAudit ? seoAudit.overallScore : 0}, 100" strokeLinecap="round" stroke="currentColor" fill="none" r="16" cx="18" cy="18"/>
                          </svg>
                          <span className="absolute text-sm font-black text-slate-800">{seoAudit ? seoAudit.overallScore : scores.technical || "—"}</span>
                        </div>
                        {seoAudit?.overallGrade && <span className="text-[10px] text-[#199874] font-bold mt-2">Grade: {seoAudit.overallGrade}</span>}
                      </div>

                      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-2">On-Page SEO</span>
                        <div className="relative w-16 h-16 flex items-center justify-center">
                          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                            <circle className="text-slate-200" strokeWidth="3" stroke="currentColor" fill="none" r="16" cx="18" cy="18"/>
                            <circle className="text-[#2563eb] transition-all" strokeWidth="3" strokeDasharray="\${seoAudit ? seoAudit.scores.onPage : 0}, 100" strokeLinecap="round" stroke="currentColor" fill="none" r="16" cx="18" cy="18"/>
                          </svg>
                          <span className="absolute text-sm font-black text-slate-800">{seoAudit ? seoAudit.scores.onPage : "—"}</span>
                        </div>
                        {seoAudit?.grades.onPage && <span className="text-[10px] text-[#2563eb] font-bold mt-2">Grade: {seoAudit.grades.onPage}</span>}
                      </div>

                      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-2">GEO / AI SEO</span>
                        <div className="relative w-16 h-16 flex items-center justify-center">
                          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                            <circle className="text-slate-200" strokeWidth="3" stroke="currentColor" fill="none" r="16" cx="18" cy="18"/>
                            <circle className="text-[#7c3aed] transition-all" strokeWidth="3" strokeDasharray="\${seoAudit ? seoAudit.scores.geo : 0}, 100" strokeLinecap="round" stroke="currentColor" fill="none" r="16" cx="18" cy="18"/>
                          </svg>
                          <span className="absolute text-sm font-black text-slate-800">{seoAudit ? seoAudit.scores.geo : "—"}</span>
                        </div>
                        {seoAudit?.grades.geo && <span className="text-[10px] text-[#7c3aed] font-bold mt-2">Grade: {seoAudit.grades.geo}</span>}
                      </div>

                      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-2">Performance</span>
                        <div className="relative w-16 h-16 flex items-center justify-center">
                          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                            <circle className="text-slate-200" strokeWidth="3" stroke="currentColor" fill="none" r="16" cx="18" cy="18"/>
                            <circle className="text-[#ea580c] transition-all" strokeWidth="3" strokeDasharray="\${seoAudit ? seoAudit.scores.performance : 0}, 100" strokeLinecap="round" stroke="currentColor" fill="none" r="16" cx="18" cy="18"/>
                          </svg>
                          <span className="absolute text-sm font-black text-slate-800">{seoAudit ? seoAudit.scores.performance : "—"}</span>
                        </div>
                        {seoAudit?.grades.performance && <span className="text-[10px] text-[#ea580c] font-bold mt-2">Grade: {seoAudit.grades.performance}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Collapsible Audits List (On-Page, GEO, Usability, Performance, Social, Local, Tech) */}
                  {seoAudit && (
                    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
                      <h4 className="text-sm font-black text-slate-900 mb-2">Detailed Audit Checklists</h4>
                      
                      {[
                        { id: "onPage", label: "On-Page SEO Checks", count: seoAudit.categories.onPage.length, checks: seoAudit.categories.onPage },
                        { id: "geo", label: "GEO / AI Search Readiness", count: seoAudit.categories.geo.length, checks: seoAudit.categories.geo },
                        { id: "usability", label: "Mobile Usability", count: seoAudit.categories.usability.length, checks: seoAudit.categories.usability },
                        { id: "performance", label: "Performance & Asset Optimization", count: seoAudit.categories.performance.length, checks: seoAudit.categories.performance },
                        { id: "social", label: "Social Results & Metatags", count: seoAudit.categories.social.length, checks: seoAudit.categories.social },
                        { id: "local", label: "Local SEO Parameters", count: seoAudit.categories.local.length, checks: seoAudit.categories.local },
                        { id: "tech", label: "Technology & Security DNS", count: seoAudit.categories.tech.length, checks: seoAudit.categories.tech },
                      ].map(cat => {
                        const isOpen = expandedCategory === cat.id;
                        return (
                          <div key={cat.id} className="border border-slate-200 rounded-2xl overflow-hidden">
                            <button
                              onClick={() => setExpandedCategory(isOpen ? null : cat.id)}
                              className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100/80 transition-colors text-left cursor-pointer"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-black text-slate-800">{cat.label}</span>
                                <span className="text-[10px] font-bold text-slate-400 bg-slate-200 px-2 py-0.5 rounded-full">{cat.count} items</span>
                              </div>
                              <span className="text-xs font-bold text-slate-400">{isOpen ? "Collapse ▲" : "Expand ▼"}</span>
                            </button>

                            {isOpen && (
                              <div className="p-4 space-y-3 bg-white divide-y divide-slate-100">
                                {cat.checks.map((check, idx) => (
                                  <div key={idx} className="\${idx > 0 ? 'pt-3' : ''} space-y-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm">{check.status === "pass" ? "✅" : check.status === "warning" ? "⚠️" : check.status === "fail" ? "❌" : "ℹ️"}</span>
                                        <h5 className="text-xs font-black text-slate-900">{check.label}</h5>
                                      </div>
                                      <span className={\`text-[10px] font-black px-2 py-0.5 rounded-md \${
                                        check.status === "pass" ? "bg-green-100 text-green-700" :
                                        check.status === "warning" ? "bg-amber-100 text-amber-700" :
                                        check.status === "fail" ? "bg-red-100 text-red-700" :
                                        "bg-slate-100 text-slate-600"
                                      }\`}>{check.value}</span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 leading-relaxed">{check.description}</p>
                                    <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-[10px] text-slate-700 mt-1">
                                      <strong>Recommendation:</strong> {check.recommendation}
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

                  {/* AI Recommendations from DB */}
                  {liveSeRecs.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-3xl p-6 overflow-hidden shadow-sm">
                      <h4 className="text-sm font-black text-slate-900 mb-4">AI Growth Recommendations</h4>
                      <div className="space-y-3">
                        {liveSeRecs.map(rec => (
                          <div key={rec.id} className={\`p-4 rounded-2xl border \${
                            rec.status === "approved" ? "bg-[#199874]/5 border-[#199874]/20" :
                            "bg-slate-50 border-slate-200"
                          }\`}>
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
          `;

const newContent = content.substring(0, startIndex) + seoTabNew + content.substring(endIndex);
fs.writeFileSync(pagePath, newContent, "utf-8");
console.log("Successfully replaced SEO tab render block in page.tsx!");
