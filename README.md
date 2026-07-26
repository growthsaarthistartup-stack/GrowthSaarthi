<div align="center">

  # 🚀 GrowthSaarthi
  ### *Autonomous AI Growth Copilot & Generative Engine Optimization (GEO) Platform for Startups*

  [![Next.js](https://img.shields.io/badge/Next.js-15.0-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
  [![PostgreSQL](https://img.shields.io/badge/Neon_Postgres-Serverless-00e599?style=for-the-badge&logo=postgresql)](https://neon.tech/)
  [![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.38-c5f74f?style=for-the-badge&logo=drizzle)](https://orm.drizzle.team/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

  <p align="center">
    <b>GrowthSaarthi</b> is an enterprise-grade, multi-agent AI system designed to continuously audit website performance, benchmark market competitors, calculate startup health, and execute high-impact SEO + GEO (Generative Engine Optimization) growth strategies.
  </p>

  <a href="#-key-features">Key Features</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-environment-variables">Environment Variables</a>

</div>

---

## 🌟 Key Features

### 🤖 1. Autonomous Multi-Agent Growth Engine
GrowthSaarthi operates on a decoupled multi-agent architecture designed with strict failure-isolation. If one agent encounters network blocks, the rest of the ingestion and recommendation pipeline proceeds unimpeded.
* **Website Scraper Agent**: Performs headless rendering (Playwright) with fallback to static parsing (Cheerio). Extracts technical metadata, image alt coverage, internal link structures, Core Web Vitals, JSON-LD schemas, and analytics footprints.
* **Competitor Intelligence Agent**: Automatically discovers true market competitors via multi-query search algorithms, scrapes candidate sites, computes semantic embeddings locally (`@xenova/transformers`), and identifies positioning gaps.
* **SEO Ingestion Agent**: Synthesizes Google Search Console (GSC) query telemetry with rank-checking engines and competitor keyword diffs to flag keyword gaps and track cold-start maturity.
* **SEO & GEO Analysis Agent**: Evaluates 15+ technical/content dimensions—including LLM readability, OpenGraph metadata, DMARC/SPF security records, and `llms.txt` readiness.

---

### 🌐 2. Generative Engine Optimization (GEO)
Modern search is shifting to AI search engines (Perplexity, ChatGPT, Claude, Google SGE, SearchGPT). GrowthSaarthi isolates traditional SEO from GEO:
* **`llms.txt` Generator**: Automatic drafting and verification of standardized AI crawler text files.
* **AI Readability Scoring**: Measures document clarity and token efficiency for LLM synthesis.
* **JSON-LD Schema Optimization**: Enforces structured data compliance to ensure rich snippet and AI knowledge graph inclusion.

---

### 🎯 3. Progressive Trust Ladder & Safety Choke Point
GrowthSaarthi incorporates a 4-tiered trust ladder to ensure AI autonomous actions never damage brand integrity or cause irreversible side-effects:
```
Level 1: Suggest Only (Read-only recommendations)
Level 2: Draft Don't Send (Drafts require explicit manual approval)
Level 3: Execute & Confirm (Safe technical fixes run; founder notified)
Level 4: Autonomous (Auto-executes safe metadata updates)
```
* **`ExecutionGate`**: Enforces strict choke-point logic. Irreversible actions (pricing changes, publishing blog posts, customer emails) can **never** auto-publish without human-in-the-loop approval.

---

### 📊 4. Multi-Axis Health Score & 30-Day Sequenced Roadmap
* **Dynamic Health Score**: A pure mathematical calculator (zero LLM latency/hallucination) combining Technical performance, Market Validation, and Growth trends weighted according to startup stage (*Idea*, *MVP*, or *Growth*).
* **Deterministic 30-Day Roadmap**: Formulates a prioritized 4-week growth strategy with dependency resolution (e.g., technical SEO fixes run in Week 1 before blog publishing in Week 2).
* **Domain-Agnostic PDF Audit Generator**: Self-contained HTML-to-PDF report generator with base64 logo embedding, responsive CSS-in-JS printing layouts, and zero hardcoded industry assumptions.

---

## 🏗️ Architecture

GrowthSaarthi enforces a strict schema-first knowledge graph powered by Neon Serverless Postgres and Drizzle ORM.

```mermaid
flowchart TD
    subgraph Ingestion Layer
        A[Website Scraper Agent] --> DB[(Neon Postgres DB)]
        B[Competitor Discovery Agent] --> DB
        C[SEO Ingestion Agent] --> DB
        D[GA4 Integration] --> DB
    end

    subgraph Scoring & Reasoning Layer
        DB --> E[SEO & GEO Analysis Agent]
        DB --> F[Pure Health Score Engine]
        E --> G[Recommendation Engine]
        G --> H[30-Day Plan Sequencer]
    end

    subgraph Execution & Output
        H --> I[Progressive Trust Ladder]
        I --> J[ExecutionGate Choke Point]
        J -->|Human Approval| K[Content & SEO Execution]
        H --> L[Domain-Agnostic PDF Audit Report]
    end
```

---

## 🛠️ Tech Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Framework** | [Next.js 15 (App Router)](https://nextjs.org/) | Server Actions, React Server Components, TypeScript |
| **Database** | [Neon Postgres](https://neon.tech/) | Serverless Postgres with Drizzle ORM |
| **Styling** | Vanilla CSS / CSS-in-JS | Ultra-custom, high-speed responsive UI |
| **AI & LLM** | [OpenRouter](https://openrouter.ai/) | Round-robin multi-key load balancing across LLM models |
| **Embeddings** | [@xenova/transformers](https://huggingface.co/docs/transformers.js) | Local vector embeddings (`all-MiniLM-L6-v2`) |
| **Web Scraping** | Playwright & Cheerio | Headless browser rendering with resilient static fallback |
| **Validation** | [Zod](https://zod.dev/) | End-to-end schema validation for all agent outputs |
| **Idempotency** | Custom ULID Engine | Guarantees zero duplicate database writes during retries |

---

## ⚡ Getting Started

### Prerequisites
* Node.js `^18.18.0` or `>=20.0.0`
* npm / pnpm / yarn / bun
* A Neon Postgres database instance

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/GrowthSaarthi.git
cd GrowthSaarthi
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup Environment Variables
Create a `.env.local` file in the root directory:
```env
# Neon Postgres Database Connection
DATABASE_URL="postgresql://user:password@ep-cool-domain.neon.tech/growthsaarthi?sslmode=require"

# OpenRouter API Keys (Round-robin load balanced)
OPENROUTER_API_KEY1="sk-or-v1-..."
OPENROUTER_API_KEY2="sk-or-v1-..."

# Third-Party Audit & Search Integrations
SEO_SCORE_API_KEY="your_seoscoreapi_key"
SERPAPI_KEY="your_serpapi_key"

# Cron Security Secret
CRON_SECRET="your_custom_cron_secret"

# Optional: Google OAuth for Search Console & GA4
GOOGLE_CLIENT_ID="your_google_client_id"
GOOGLE_CLIENT_SECRET="your_google_client_secret"
```

### 4. Run Database Migrations
```bash
npx drizzle-kit push
```

### 5. Start the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to launch GrowthSaarthi locally.

---

## 🧪 Testing & Verification

GrowthSaarthi includes a comprehensive type-checking and automated test suite:

```bash
# Run TypeScript compilation check
npx tsc --noEmit

# Run Unit & Integration Test Suite
npm test
```

---

## 📁 Project Structure

```
GrowthSaarthi/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── cron/daily/       # Daily ingestion & anomaly detection cron
│   │   │   ├── seo-report/       # Self-contained PDF/HTML audit report route
│   │   │   └── ...               # Additional API routes
│   │   └── dashboard/            # Growth dashboard UI
│   ├── lib/
│   │   ├── agents/               # Multi-agent implementations (SEO, Competitor, Scraper, etc.)
│   │   ├── db/                   # Drizzle ORM schemas, client & repositories
│   │   ├── integrations/         # SEOScoreAPI, GA4, GSC clients
│   │   ├── scoring/              # Pure math Health Score & Recommendation Engine
│   │   ├── agent-runner.ts       # Structured LLM caller with Zod validation & retries
│   │   ├── execution-gate.ts     # Autonomy choke point & trust ladder enforcement
│   │   └── trust-ladder.ts       # Progressive autonomy tracker
└── drizzle/                      # Database SQL migrations
```

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
