# SERP Content Researcher

A full-stack tool that searches Google for the top 10 ranking pages for any keyword, scrapes their content, and generates a structured content recommendation report using Claude AI.

## What It Does

1. **Search** — Queries Google Custom Search API for the top 10 US results for your keyword
2. **Scrape** — Extracts main body content from each URL using a headless browser (Puppeteer)
3. **Analyze** — Sends all scraped content to Claude AI, which generates:
   - H2 section structure with ready-to-publish content
   - Recommendations on what competitors cover in each section
   - Word count benchmark
   - Semantic keyword list
   - Content gap analysis
4. **Export** — Download as a formatted Word document or copy as plain text

---

## Setup

### 1. Prerequisites

- Node.js 18+ installed
- A Google API key with Custom Search API enabled
- An Anthropic API key

### 2. Clone and Install

```bash
git clone <repo-url>
cd serp-content-researcher
npm install          # installs root (concurrently)
npm install --prefix server
npm install --prefix client
```

Or in one command:
```bash
npm run install:all
```

### 3. Configure Environment Variables

Edit the `.env` file in the root directory:

```env
GOOGLE_API_KEY=your_google_api_key_here
GOOGLE_CX=your_custom_search_engine_id_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
PORT=5000
```

### 4. Run the App

```bash
npm run dev
```

This starts:
- **Backend** at `http://localhost:5000`
- **Frontend** at `http://localhost:3000`

Open `http://localhost:3000` in your browser.

---

## API Keys — How to Get Them

### Google API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Library**
4. Search for **"Custom Search API"** and enable it
5. Go to **APIs & Services → Credentials**
6. Click **"Create Credentials" → "API Key"**
7. Copy the key and paste it as `GOOGLE_API_KEY` in your `.env`

**Note:** The free tier of Google Custom Search API allows **100 queries per day**. After that, you'll see a quota error in the UI. To increase the limit, enable billing in Google Cloud Console (it's $5 per 1,000 additional queries).

### Google Custom Search Engine ID (CX)

1. Go to [Programmable Search Engine](https://programmablesearchengine.google.com/)
2. Click **"Add"** to create a new search engine
3. Under "Sites to search", select **"Search the entire web"**
4. Give it a name and click **"Create"**
5. Go to your new search engine's settings
6. Copy the **"Search engine ID"** (looks like `a55677e01975a4d71`)
7. Paste it as `GOOGLE_CX` in your `.env`

### Anthropic API Key

1. Sign up or log in at [console.anthropic.com](https://console.anthropic.com/)
2. Navigate to **API Keys**
3. Click **"Create Key"**
4. Copy the key and paste it as `ANTHROPIC_API_KEY` in your `.env`

---

## Project Structure

```
serp-content-researcher/
├── .env                          # API keys and config
├── package.json                  # Root — runs both client & server
├── README.md
│
├── server/
│   ├── package.json
│   ├── server.js                 # Express app entry point
│   ├── routes/
│   │   ├── search.js             # POST /api/search
│   │   ├── scrape.js             # POST /api/scrape
│   │   ├── analyze.js            # POST /api/analyze
│   │   └── export.js             # POST /api/export/docx
│   └── services/
│       ├── googleSearch.js       # Google Custom Search API wrapper
│       ├── scraper.js            # Puppeteer-based content scraper
│       └── claude.js             # Anthropic API wrapper
│
└── client/
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── index.html
    └── src/
        ├── App.jsx               # Main app component
        ├── main.jsx
        ├── index.css
        └── components/
            ├── KeywordInput.jsx  # Search input
            ├── ProgressSteps.jsx # Step-by-step progress indicator
            ├── SerpUrls.jsx      # SERP results list with scrape status
            ├── ResultsTable.jsx  # Main analysis table
            └── ExportButtons.jsx # Word doc & clipboard export
```

---

## Rate Limits

- **Backend rate limit:** 5 API requests per minute per IP
- **Google quota:** 100 searches/day (free tier) — shown in the top-right of the UI
- **Puppeteer:** Max 3 concurrent pages, 15-second timeout per page

## Notes

- Pages that block scrapers (e.g. Cloudflare-protected sites) will be skipped gracefully — the app continues with whatever pages were successfully scraped
- If fewer than 5 pages are scraped, a warning is shown but analysis continues
- The Word document export is generated server-side and downloaded directly from the browser
- All API keys are kept server-side and never exposed to the browser
