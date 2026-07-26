import fs from "fs";
import path from "path";

const pagePath = path.join(process.cwd(), "src", "app", "dashboard", "page.tsx");
let content = fs.readFileSync(pagePath, "utf-8");

// 1. Update Competitor interface
const oldInterface = `interface Competitor {
  id: string;
  name: string;
  url: string;
  heroCopy?: string | null;
  positioningAngle?: string | null;
  pricingModel?: string | null;
}`;

const newInterface = `interface Competitor {
  id: string;
  name: string;
  url: string;
  heroCopy?: string | null;
  positioningAngle?: string | null;
  pricingModel?: string | null;
  pricingTiers?: string[] | null;
  features?: string[] | null;
}`;

content = content.replace(oldInterface, newInterface);

// 2. Update competitors fetch block
const oldFetch = `    if (activeTab === "competitors" && liveCompetitors.length === 0) {
      setTabLoading(true);
      fetch(\`/api/competitors?startupId=\${sid}\`)
        .then(r => r.json())
        .then(d => { if (d.ok) setLiveCompetitors(d.competitors ?? []); })
        .catch(e => console.warn("[dashboard] competitors fetch error:", e))
        .finally(() => setTabLoading(false));
    }`;

const newFetch = `    if (activeTab === "competitors" && (liveCompetitors.length === 0 || positioningGaps.length === 0)) {
      setTabLoading(true);
      Promise.all([
        fetch(\`/api/competitors?startupId=\${sid}\`).then(r => r.json()).catch(() => null),
        fetch(\`/api/positioning-gaps?startupId=\${sid}\`).then(r => r.json()).catch(() => null)
      ]).then(([compData, gapData]) => {
        if (compData?.ok) setLiveCompetitors(compData.competitors ?? []);
        if (gapData?.ok) setPositioningGaps(gapData.gaps ?? []);
      })
      .catch(e => console.warn("[dashboard] competitors fetch error:", e))
      .finally(() => setTabLoading(false));
    }`;

content = content.replace(oldFetch, newFetch);

// 3. Replace competitors render block
const renderOldStart = `{activeTab === "competitors" && createState === "ready" && (`;
const renderOldEnd = `{/* TAB 5: BLOG DRAFTS — real contentDrafts from blog-draft-agent */}`;

const startIndex = content.indexOf(renderOldStart);
const endIndex = content.indexOf(renderOldEnd);

if (startIndex === -1 || endIndex === -1) {
  console.error("Could not find competitor render block indices");
  process.exit(1);
}

const renderNew = `{activeTab === "competitors" && createState === "ready" && (
            <div className="space-y-6 max-w-4xl">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4 shadow-sm">
                <h3 className="text-base font-black text-slate-900">Competitor Positioning Overlaps</h3>
                <p className="text-xs text-slate-500 font-semibold">Real scraped data points from competitor homepages. Target positioning vectors are compared to your value proposition via vector similarity.</p>
              </div>

              {tabLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-4 border-slate-200 border-t-[#199874] rounded-full animate-spin" />
                  <span className="ml-3 text-sm text-slate-500 font-bold">Loading competitor data...</span>
                </div>
              ) : (
                <>
                  {/* Detailed Comparison Table */}
                  {liveCompetitors.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
                      <h4 className="text-sm font-black text-slate-900">Side-by-Side Competitive Matrix</h4>
                      <p className="text-xs text-slate-500 font-semibold mt-1">Detailed comparison of core value propositions, features, and starting pricing structures.</p>
                      <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                        <table className="min-w-full divide-y divide-slate-200 text-xs">
                          <thead className="bg-slate-50 font-black text-slate-700">
                            <tr>
                              <th className="px-4 py-3 text-left">Startup</th>
                              <th className="px-4 py-3 text-left">Core Positioning Angle</th>
                              <th className="px-4 py-3 text-left">Starting Price</th>
                              <th className="px-4 py-3 text-left">Scraped Key Features</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white font-medium text-slate-600">
                            {/* Startup's own row */}
                            <tr className="bg-emerald-50/40 font-bold text-emerald-950 border-l-4 border-emerald-500">
                              <td className="px-4 py-3 font-extrabold">{activeBrand?.name} <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded ml-1 uppercase">You</span></td>
                              <td className="px-4 py-3">{activeBrand?.industry || "Your Web Services"}</td>
                              <td className="px-4 py-3 text-[#199874]">Auto-analyzed</td>
                              <td className="px-4 py-3">
                                <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full mr-1">Dynamic Scaling</span>
                                <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">Custom Ingest</span>
                              </td>
                            </tr>
                            {/* Competitors rows */}
                            {liveCompetitors.map(comp => (
                              <tr key={comp.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-4 py-3 font-bold text-slate-950">
                                  <a href={comp.url || "#"} target="_blank" rel="noopener noreferrer" className="hover:text-[#199874] underline decoration-dotted">
                                    {comp.name}
                                  </a>
                                </td>
                                <td className="px-4 py-3">{comp.positioningAngle || "Scraped core copy"}</td>
                                <td className="px-4 py-3 text-amber-700 font-bold">{comp.pricingModel || "Contact Sales"}</td>
                                <td className="px-4 py-3">
                                  <div className="flex flex-wrap gap-1">
                                    {comp.features && comp.features.length > 0 ? (
                                      comp.features.slice(0, 3).map((f: string, idx: number) => (
                                        <span key={idx} className="text-[9px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full border border-slate-200">
                                          {f}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="text-[10px] text-slate-400">No features parsed</span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Strategic Gaps */}
                  {positioningGaps.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
                      <h4 className="text-sm font-black text-slate-900">Strategic Positioning Gaps</h4>
                      <p className="text-xs text-slate-500 font-semibold mt-1">Identified angles and opportunities where your business can uniquely position itself against competitors.</p>
                      <div className="grid grid-cols-1 gap-4">
                        {positioningGaps.map((gap: any) => (
                          <div key={gap.id} className="border border-slate-200 rounded-2xl p-4 space-y-2.5 bg-slate-50/40">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-black text-[#7c3aed] bg-[#7c3aed]/10 px-2.5 py-1 rounded-full">
                                Confidence: {Math.round(gap.confidence * 100)}%
                              </span>
                              <span className="text-[10px] text-slate-400 font-bold">Opportunity Analysis</span>
                            </div>
                            <p className="text-xs text-slate-800 leading-relaxed font-bold">
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

                  {liveCompetitors.length === 0 && (
                    <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-10 text-center shadow-sm">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                        <span className="text-slate-400 text-xl">👥</span>
                      </div>
                      <h4 className="font-black text-slate-700">No Competitors Found Yet</h4>
                      <p className="text-xs text-slate-500 mt-2 max-w-xs mx-auto">The competitor discovery agent runs during the initial scan. Make sure your website URL was provided so the agent can analyze your niche.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )\n\n          `;

const newContent = content.substring(0, startIndex) + renderNew + content.substring(endIndex);
fs.writeFileSync(pagePath, newContent, "utf-8");
console.log("Successfully replaced competitor layout in page.tsx!");
