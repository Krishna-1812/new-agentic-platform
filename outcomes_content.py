"""The words of outcomes.digital, page by page, for its redesign at /outcomesdigital (outcomes_site.py).

The content is the live site's, kept as it is (read on 10 November 2026); only the look is new: the
Northaxis design system (static/css/press.css, site.css, press-play.js) with the Outcomes Digital name.
The pages are unlisted: nothing on the Northaxis site links here and search engines are told not to list
them. The images are the site's own, stored in static/outcomes/img.
"""

BRAND = "Outcomes Digital"
EMAIL = "info@outcomes.digital"
TAGLINE = "Marketing That Moves Businesses Forward"
# The strategy call, booked straight into the team's calendar (the industry pages' "Book a free strategy call").
CALENDLY = "https://calendly.com/ravik-outcomes/45mins"
SOCIAL = (("LinkedIn", "https://www.linkedin.com/company/outcomes-digital/"),
          ("Facebook", "https://www.facebook.com/outcomes.digital/"),
          ("Instagram", "https://www.instagram.com/outcomes.digital/"))

# One pair of actions on every page: the growth plan (the contact form) and the strategy call (the calendar).
CTA_PLAN = "Get a free growth plan"
CTA_CALL = "Book a free strategy call"

# The figures the pages share (the team confirmed 25+ and 74%+ on 10 November 2026).
PROOF_STATS = (("$5M+", "Revenue generated for clients"), ("25+", "Businesses scaled"), ("74%+", "Client retention"),
               ("3X", "More qualified leads"), ("40%", "Lower customer acquisition cost"))

# The address of each page, under /outcomesdigital.
SERVICES = (("seo-services", "SEO"), ("ppc-management", "PPC & Paid Media"), ("cro-services", "CRO"))
INDUSTRIES = (("ecommerce-marketing", "eCommerce"), ("education-marketing", "Edu Tech"),
              ("real-estate-marketing", "Real Estate"))

# Clients, as the home page shows them: (name, industry, card image).
CLIENTS = (
    ("Allure Avani", "Real Estate", "card-allure-avani"),
    ("Madge Beauty", "Beauty & Cosmetics", "card-madge-beauty"),
    ("TheMrGroup", "Home Services", "card-the-mr-group"),
    ("Krishnamurti Foundation India", "Education & Non-Profit", "card-kfi"),
    ("Artistic Yoga", "Health & Fitness", "card-artistic-yoga"),
    ("Materialhunt", "B2C E-commerce", "card-material-hunt"),
    ("The Enlightened Manager", "E-commerce", "card-enlightened-manager"),
    ("Greet Technologies", "Business Process Outsourcing", "card-greet-technologies"),
    ("Core Care Clinic", "Healthcare & Medical", "card-core-care-clinic"),
)

# ── Home ────────────────────────────────────────────────────────────────────────────────────────────────
HOME_LEAD = ("One connected team for Strategy, Creative, Paid Media, Growth Agents and CRO connected to drive "
             "revenue.")
HOME_STATS = (("3X", "more qualified leads"), ("40%", "lower customer acquisition cost"))
# How we drive outcomes: (tab, title, line, photo). The live site's five steps and photos, each line said plainly.
HOME_STEPS = (
    ("Understand", "Understand the business", "We start with your customer journeys, your product and your numbers, "
     "so we know how you make money before we change anything.", "step-1"),
    ("Strategy", "Build the growth strategy", "A growth roadmap, channel planning and priorities, so your budget goes "
     "where it pays.", "step-2"),
    ("Growth Engine", "Build the growth engine", "Tracking, connected tools, automation workflows and AI agents, set "
     "up so every result can be measured.", "step-3"),
    ("Execution", "Execute with precision", "Campaigns, creative, content and performance work, run by one team "
     "instead of five vendors.", "step-4"),
    ("Optimise & Scale", "Optimise and scale", "Dashboards and revenue trends drive every decision. What works gets "
     "more budget; what doesn't is cut.", "step-5"),
)
# The problem we were built to fix, in the founders' words (About).
HOME_PROBLEM = ("We watched agency after agency present polished decks full of “brand awareness” and "
                "“engagement,” while budgets climbed and revenue stayed flat.")
# One connected team: (name, line, link under /outcomesdigital or None, icon, colour).
PILLARS = (
    ("Strategy", "Growth roadmap, channel planning, and prioritisation.", None, "target", "orange"),
    ("Creative", "Strategy, copy and ad creative - built for your brand, not recycled templates.", None, "pen", "amber"),
    ("Paid Media", "Google Ads and Meta Ads managed around cost-per-acquisition and ROAS.", "ppc-management", "megaphone", "sky"),
    ("SEO / GEO / AEO", "Getting found on Google - and in AI tools like ChatGPT.", "seo-services", "search", "card"),
    ("CRO", "We find and fix the friction costing you conversions.", "cro-services", "chart", "red"),
    ("Growth Agents", "Connected tools, automation workflows, and AI agents.", None, "bolt", "ink"),
)
# The three industries, as the home page introduces them: (slug, name, headline, line, photo).
INDUSTRY_CARDS = (
    ("ecommerce-marketing", "eCommerce", "Impressions fade. Outcomes stay.",
     "Data, website, ads and creative - fixed and scaled together, so your marketing actually pays for itself.",
     "card-madge-beauty"),
    ("education-marketing", "Edu Tech", "More enquiries isn’t the goal. The goal is more admissions.",
     "We help schools and colleges fill seats with students who actually enrol.", "photo-campus"),
    ("real-estate-marketing", "Real Estate", "More leads isn’t the goal. The goal is more site visits.",
     "Marketing that produces buyers who show up — not just leads who don’t.", "photo-tower"),
)
# Logos: (name, file under static/outcomes/img).
CLIENT_LOGOS = (("Allure Avani", "logo-allure-avani.webp"), ("Madge Beauty", "logo-madge.webp"),
                ("Krishnamurti Foundation India", "logo-kfi.webp"), ("Artistic Yoga", "logo-artistic-yoga.webp"),
                ("Material Hunt", "logo-material-hunt.webp"), ("Core Care Clinic", "logo-core-care.webp"))
ECOM_PLATFORMS = (("Shopify", "tool-shopify.webp"), ("WooCommerce", "tool-woocommerce.webp"), ("Wix", "tool-wix.webp"),
                  ("Magento", "tool-magento.webp"), ("Amazon", "tool-amazon.webp"), ("Flipkart", "tool-flipkart.webp"),
                  ("Google Ads", "tool-google-ads.webp"), ("Meta", "tool-meta.webp"))
EDU_LOGOS = (("Basil Woods International School", "logo-basil-woods.svg"), ("City College Jayanagar", "logo-city-college.webp"),
             ("Acharya Institute of Health Sciences", "logo-acharya.webp"), ("The Shri Ram Universal School", "logo-shri-ram.svg"),
             ("Krishnamurti Foundation India", "logo-kfi.webp"), ("LEAD School", "logo-lead-school.svg"))

# White logos, shown on a dark tile so they can be seen.
LOGOS_ON_DARK = frozenset({"logo-basil-woods.svg", "logo-city-college.webp", "logo-allure-avani.webp"})

# What our clients say: (quote, client, who they are).
HOME_QUOTES = (
    ("We’d relied on a single channel for so long that we didn’t really own our own customer relationships. "
     "Outcomes Digital helped us see that dependency clearly and built a plan to grow independently of it. It "
     "wasn’t a quick fix – it was a genuine shift in how we think about where our business should be getting "
     "its growth from.", "Krishnamurti Foundation India", "Education & Non-Profit"),
    ("We had a good product and a following, but we couldn’t figure out why sales weren’t moving. Outcomes "
     "Digital didn’t just run more ads – they looked at the whole picture, found what was actually broken, and "
     "fixed it properly. It’s the first time our marketing has felt like it’s built on a real strategy instead "
     "of guesswork.", "Madge Beauty", "Australian Clean Beauty Brand"),
    ("Most agencies we’d worked with before chased volume – more leads, more clicks. Outcomes Digital took a "
     "completely different approach. They cared more about whether the people coming through were actually "
     "serious buyers. That shift in thinking changed how our whole sales pipeline feels – steadier, and a lot "
     "less noisy.", "Allure Avani", "Premium Villa Project in Bangalore"),
)

# ── About ───────────────────────────────────────────────────────────────────────────────────────────────
ABOUT_LEAD = "Driven by data, obsessed with ROI, built to scale your business."
# The team: (role tag, name, title, bio, photo).
TEAM = (
    ("Founder", "Sudheer Dayanand", "Chief Executive Officer",
     "Digital growth hacker & MBA with 15+ years of paid media expertise. Scaled accounts from $100K to $2M+ "
     "spend, managed 500+ clients, and featured SEMPO speaker.", "team-sudheer"),
    ("Co-founder", "Asrith Makam", "Chief Marketing Officer",
     "Global marketing leader with 18+ years driving digital transformation, voice intelligence, brand strategy, "
     "and commercial performance across India, US, and Middle East.", "team-asrith"),
    ("", "Ravi K.", "Director of Growth",
     "Sales & Marketing Leader with 20+ years driving revenue, brand growth, and GTM strategies across B2B and "
     "B2C. Proven expert in scaling sales funnels, ABM, performance marketing, and leading teams to accelerate "
     "market expansion.", "team-ravi"),
    ("", "Santosh Reddy", "Lead Performance Marketing and SEO - E-commerce",
     "Performance Marketing Head at Outcomes Digital, driving ROI-focused campaigns through data-driven "
     "advertising, conversion optimization, and marketing automation to deliver measurable business growth.",
     "team-santosh"),
    ("", "Kuladeep P.", "Lead Performance Marketing - Ed Tech",
     "Performance Marketing Specialist with 12+ years scaling ROI-focused acquisition across B2B SaaS, fintech, "
     "and EdTech. Expert in full-funnel strategy, paid media, CRO, and analytics to drive growth.", "team-kuladeep"),
    ("", "Badri Krishna", "Lead Performance Marketing - Realestate",
     "Results-driven Performance Marketing Leader scaling multi-channel paid acquisition, CRO, and high-budget "
     "campaigns across global EdTech, SaaS, eCommerce, and app brands.", "team-badri"),
    ("", "Tharun K.", "Lead MarTech & GTM",
     "Digital Campaign Strategist with 10+ years driving ROI-focused growth across digital channels. Expert in "
     "campaign strategy, paid media, analytics, and performance optimization to maximize engagement and business "
     "growth.", "team-tharun"),
)
ABOUT_STORY = (
    "We watched agency after agency present polished decks full of “brand awareness” and “engagement,” "
    "while budgets climbed and revenue stayed flat.",
    "So, we built the partner we wished we had an agency that links every channel, campaign, and rupee directly to "
    "pipeline, revenue, and bottom-line growth.",
    "Today, outcomes.digital drives full-funnel performance across Google Ads, Meta Ads, ABM, SEO, AEO, GEO, and "
    "CRO. We don’t build fluff reports. We deliver growth you can defend in the boardroom.",
)
# Measured impact: (kicker, figure, label, line, tag).
ABOUT_IMPACT = (
    ("Verified", "$5M+", "Revenue Generated", "Helping clients generate measurable revenue through performance marketing.",
     "Tracked Live"),
    ("Portfolio", "25+", "Businesses Scaled", "Partnering with ambitious brands to accelerate sustainable growth.",
     "Global Reach"),
    ("Benchmark", "74%+", "Client Retention", "Proof that results build long-term partnerships.", "High Satisfaction"),
)
ABOUT_SCALE = ("We combine creative ad campaigns with statistical precision to ensure your ad spend converts into "
               "measurable enterprise valuation.")
ABOUT_DOMINATE = ("Unlike traditional agencies that focus on vanity metrics like clicks and impressions, our "
                  "performance stack targets bottom-line profitability and customer lifetime value (LTV).")
ABOUT_STACK = ("Full-Funnel Paid Media Management (Meta, Google, TikTok)",
               "Algorithmic Conversion Rate Optimization (CRO)",
               "First-Party Data & Server-Side Tracking Setup",
               "High-Velocity Creative Testing Workflows")
# The bars: (name, percent, line).
ABOUT_BARS = (
    ("ROAS Optimization Efficiency", 71, "Average ROAS improvement across active client accounts"),
    ("Paid Media Conversion Accuracy", 74, "Precise server-side event tracking and attribution modeling"),
    ("Landing Page Conversion Rate (CRO)", 67, "Statistical lift achieved through continuous A/B multivariate testing"),
    ("Retention & Email/SMS Revenue", 69, "Automated post-purchase lifecycle workflows driving repeat orders"),
)
ABOUT_VALUES = (
    ("Practice radical transparency.",
     "You see the same dashboards, reports, and performance data we do—every step of the way."),
    ("Focus on real revenue.", "We don’t chase vanity metrics. Every strategy is measured by its impact on business growth."),
    ("Move with speed.", "We’d rather launch, test, and improve this week than spend a month planning."),
    ("Take full accountability.",
     "We set clear targets, own the outcomes, and continuously optimize until we achieve them."),
)

# ── Contact and thank you ───────────────────────────────────────────────────────────────────────────────
CONTACT_QUOTE = HOME_QUOTES[1][0]
THANKS_TITLE = "You’re One Step Closer to Smarter Growth."
THANKS_TEXT = ("Thanks for reaching out. Your request has been successfully submitted, and one of our digital "
               "growth specialists will contact you shortly to discuss your goals and the best strategy for your "
               "business.")

# ── Case studies ────────────────────────────────────────────────────────────────────────────────────────
# Each: slug, name, listing category and date, tags, kind, subtitle, the three headline figures
# (figure, label, line), the challenge, the approach (title, text), the results and the four figures under them.
CASES = (
    {"slug": "allure-avani", "name": "Allure Avani", "category": "Professional Service · Websites",
     "date": "July 21, 2026", "tags": ("Meta Ads", "Google Ads", "Real Estate Lead Gen"),
     "kind": "Performance Case Study", "sub": "Luxury Real Estate Campaign • Lead Generation & Site Visits",
     "top": (("214", "Qualified Leads", "High-intent buyers generated"),
             ("55", "Site Visits Completed", "On-ground evaluations"),
             ("₹15,455", "Cost Per Site Visit", "Optimized conversion cost")),
     "challenge": ("The project was struggling to generate quality buyer enquiries despite ongoing advertising "
                   "efforts. Campaigns were producing limited high-intent prospects and inconsistent lead quality, "
                   "resulting in a high cost per qualified lead and inefficient budget allocation.",
                   "With limited brand awareness in the competitive luxury real estate market, daily qualified lead "
                   "generation lacked consistency. The client needed a scalable digital strategy focused on "
                   "improving both lead quality and conversion."),
     "approach": (("Full-funnel paid ads strategy", "Developed integrated Meta and Google Ads campaigns focused on "
                   "reaching premium home buyers with intent-based and lookalike targeting."),
                  ("Creative & budget optimization", "Continuously optimized campaigns to prioritize lead quality "
                   "over volume, reallocating budgets to top-performing creatives."),
                  ("Bid management & site visits", "Monitored performance daily to optimize bids, reduce Cost Per "
                   "Site Visit, and drive prospects likely to convert on the ground.")),
     "results": ("The campaign generated 600+ total leads across Meta and Google, delivering 214 qualified leads "
                 "ready for the sales team and 55 completed site visits. Reaching 1.28 million people and driving "
                 "16,000+ clicks, the strategy successfully established a consistent, predictable sales pipeline "
                 "while keeping the Cost Per Site Visit strictly optimized at ₹15,455."),
     "figures": (("600+", "Total Leads"), ("1.28M", "Impressions"), ("16K+", "Clicks"),
                 ("₹15,455", "Cost / Site Visit"))},
    {"slug": "artistic-yoga", "name": "Artistic Yoga", "category": "Professional Service · Websites",
     "date": "July 21, 2026", "tags": ("Blog SEO", "Content Strategy", "Local SEO"),
     "kind": "SEO Case Study", "sub": "Dubai’s Leading Yoga Studio • artisticyoga.com",
     "top": (("+131%", "Keyword Growth", "48 → 111+ keywords"),
             ("457K+", "Annual Organic Visits", "100% unpaid traffic"),
             ("50.6K", "Search Impressions", "Last 3 months (GSC)")),
     "challenge": ("Artistic Yoga — a premium Dubai yoga studio led by Dr. Bharat Thakur — had zero content "
                   "strategy. Despite multiple studio locations across Dubai, the website ranked for only 48 keywords "
                   "in June 2025, making it virtually invisible in organic search.",
                   "The brand was spending $0 on paid ads and relying entirely on word-of-mouth, while well-funded "
                   "competitors dominated Google search results."),
     "approach": (("Keyword-targeted blogging", "Every post mapped to a real search query — informational, "
                   "local-intent, and awareness keywords."),
                  ("On-page SEO optimisation", "Title tags, H1–H3 structure, meta descriptions, and internal "
                   "linking from blog to studio pages."),
                  ("Local content strategy", "Neighbourhood-specific posts for Motor City, Al-Qusais, and other "
                   "Dubai locations to drive footfall.")),
     "results": ("Over 12 months, the blog SEO strategy drove 457,877 organic visits with zero paid ad spend. "
                 "Organic keywords grew +131% from 48 to 111+, generating over $166,000 in organic traffic value "
                 "— equivalent to what competitors spend on paid ads. Peak daily traffic reached 1,620 visits/day "
                 "in November 2025, and Google Search Console shows 50,600 impressions in the last 3 months alone."),
     "figures": (("457K+", "Organic Visits"), ("$166K+", "Traffic Value"), ("2.4%", "CTR (GSC)"),
                 ("10.2", "Avg. Position"))},
    {"slug": "kfi", "name": "KFI", "title": "Krishnamurti Foundation India (KFI)",
     "category": "eCommerce · Websites", "date": "July 21, 2026",
     "tags": ("Paid Media", "Conversion Tracking", "Ecommerce Growth"),
     "kind": "Performance Case Study", "sub": "Owned Ecommerce Growth • Paid Ads & Margin Protection",
     "top": (("1.5×", "Website Orders", "Direct site growth"), ("2×", "Website Revenue", "Doubled online sales"),
             ("10×+", "Amazon Ads ROAS", "30% commission saved")),
     "challenge": ("KFI was heavily dependent on Amazon for traffic, driving ad clicks without proper purchase "
                   "tracking. This setup reduced overall profit margins through hefty commission fees and severely "
                   "limited customer data ownership for retargeting and future marketing campaigns.",
                   "Without clear attribution or an owned conversion ecosystem, scaling ad spend predictably while "
                   "maintaining profitability was a major bottleneck."),
     "approach": (("Shift to owned traffic", "Redirected paid traffic to KFI’s primary website to protect margins "
                   "and build a first-party customer database."),
                  ("Tracking infrastructure", "Implemented robust GTM, GA4, Google Ads, and Meta tracking with "
                   "dedicated conversion confirmation pages for precise attribution."),
                  ("Multi-channel scaling", "Scaled Google PMax, Merchant Center feeds, and Meta ads, while "
                   "optimizing Amazon listings to maximize efficiency.")),
     "results": ("By shifting to owned traffic and fixing end-to-end conversion tracking, KFI increased website "
                 "orders 1.5× and doubled website revenue. Advertised products surged from 3–4 weekly sales to "
                 "20–30 sales each. The campaigns consistently generated 50 monthly conversions on Google Ads and "
                 "achieved a 10×+ ROAS on Amazon, saving 30% in commission fees while establishing predictable "
                 "paid media growth."),
     "figures": (("20–30", "Weekly Sales / Product"), ("50/mo", "Google Ads Conversions"),
                 ("30%", "Commission Saved"), ("10×+", "Amazon ROAS"))},
    {"slug": "madge-beauty", "name": "Madge Beauty", "category": "eCommerce · Websites", "date": "July 21, 2026",
     "tags": ("Meta Ads", "Google Ads", "D2C Launch"),
     "kind": "Performance Case Study", "sub": "Full-Funnel Ad Strategy • New D2C Beauty Brand Launch",
     "top": (("3×", "Sales Growth", "Daily sales increased 3×"),
             ("$2,160", "Total Revenue", "First campaign cycle (AUD)"),
             ("1.92×", "Blended ROAS", "Positive ROI from day one")),
     "challenge": ("Despite having an active product range and social media presence, Madge Beauty was stuck at "
                   "0–1 sales per day. A slow website was causing high drop-off rates, with paid traffic bouncing "
                   "before making a purchase, and Shopify was logging all incoming sales as “Direct” traffic due "
                   "to a complete lack of tracking infrastructure.",
                   "With zero conversion signals for Meta and Google to optimize against, unedited raw creatives, "
                   "and no structured campaign architecture, the brand was unable to establish a consistent daily "
                   "sales flow."),
     "approach": (("Custom landing page & tracking", "Built a fast-loading custom landing page with direct checkout "
                   "and deployed a full tracking stack (Meta CAPI, GA4, GTM, UTM passthrough)."),
                  ("Creative & talent strategy", "Edited raw UGC into high-converting video ads featuring celebrity "
                   "MUA Max May and Rachel de Oliveira, with hooks, captions, and CTAs."),
                  ("Structured full-funnel ads", "Deployed a 70/30 Meta and Google strategy combining consolidated "
                   "Meta ad sets with Google PMax and Search for full-funnel coverage.")),
     "results": ("Within 3 weeks of launch, the new strategy achieved consistent daily sales, growing orders from "
                 "0–1/day up to 5–6 on weekdays and 7–10 on weekends. The campaign delivered 32 orders "
                 "generating $2,160 AUD in revenue at a 1.92× Blended ROAS on $1,124 ad spend. The new landing "
                 "page drove 70% of all orders, while Google Ads generated a 1.83× ROAS in its first 7 days alone."),
     "figures": (("70%", "Orders via New LP"), ("7–10", "Weekend Orders / Day"), ("1.83×", "Google 7-Day ROAS"),
                 ("3 Wks", "To Consistent Sales"))},
    {"slug": "the-mr-group", "name": "The Mr Group", "category": "Professional Service · Websites",
     "date": "July 6, 2026", "tags": ("Blog SEO", "GBP Management", "Local SEO"),
     "kind": "SEO Case Study", "sub": "Australia’s Home Services Franchise • 3 Brands Across Australia",
     "top": (("66+", "SEO Blogs Published", "Across 3 brands in 6 months"),
             ("88K+", "Mr Antenna Active Users", "Jan - Jun 2026 YTD"),
             ("208", "GBP Posts Published", "Across 104 local profiles")),
     "challenge": ("The Mr Group’s three home services brands — Mr Antenna, Mr Gutter Cleaning, and Mr Pest "
                   "Controller — had limited organic visibility against well-funded national competitors like "
                   "Jim’s Antennas and Jim’s Pest Control.",
                   "Blog publishing was inconsistent, with no structured topic research, seasonal timing, or local "
                   "search strategy connecting content to service bookings across their combined Australian "
                   "footprint."),
     "approach": (("Search-driven blog program", "2 SEO-optimised blogs per brand per week, with topics scored "
                   "against real search demand from Search Console and SEMrush."),
                  ("Seasonal & event timing", "Content published 4-6 weeks ahead of seasonal peaks — rainfall, "
                   "rodent season, World Cup — for peak search intent."),
                  ("Local GBP amplification", "104 Google Business Profiles managed with 2 posts per cycle, "
                   "reinforcing blog content at suburb level.")),
     "results": ("Over six months, the program delivered 66+ SEO-optimised blogs across all three brands, producing "
                 "multiple Position 1 rankings attributable to blog content. Mr Antenna reached 88,000 active users "
                 "with a FIFA World Cup traffic spike, while Mr Gutter Cleaning’s site health improved to 85% (+5), "
                 "and Mr Pest Controller’s authority score grew +1 — the strongest momentum signal across the "
                 "group."),
     "figures": (("66+", "Blogs Published"), ("88K+", "Mr Antenna Users"), ("700/day", "Peak Daily Traffic"),
                 ("104", "GBP Profiles"))},
)
CASES_BY_SLUG = {c["slug"]: c for c in CASES}

# ── The three service pages ─────────────────────────────────────────────────────────────────────────────
# An FAQ answer is a string, or (intro, [points], closing); a point may be "Label: text".
SERVICE_PAGES = {
    "seo-services": {
        "photo": "step-3", "proof": ("artistic-yoga", "+131%", "Keyword growth for Artistic Yoga"),
        "label": "SEO", "page_title": "SEO Services That Drive Revenue, Not Just Rankings",
        "title": "SEO built around revenue, not just rankings",
        "lead": "Rankings without revenue are a vanity metric. We build SEO strategy around the keywords, pages, and "
                "technical fixes that actually move your business forward.",
        "cta": "Get a free SEO audit", "problems_title": "Why your current SEO isn’t working",
        "problems": (("Vanity metrics don’t pay the bills", "Impressions are up. Rankings are up. Revenue isn’t. "
                      "Most SEO reporting stops at traffic – we start there."),
                     ("Technical debt is costing you rankings", "Broken links, slow load times, and crawl errors "
                      "quietly cap your growth long before content becomes the bottleneck.")),
        "why": (("We audit before we strategize", "Full technical and content audit before any recommendation gets made."),
                ("Content tied to buyer intent", "Content mapped to where your buyer actually is in their decision, "
                 "not just search volume."),
                ("Reporting on revenue, not just rankings", "Every report ties organic performance back to leads and "
                 "revenue.")),
        "framework_title": "Our four-step SEO growth framework",
        "framework_lead": "From initial technical audit to continuous optimization, here is how we turn search "
                          "visibility into measurable revenue for your business.",
        "framework": ("Technical & content audit", "Keyword & competitor mapping", "On-page & content execution",
                      "Ongoing optimization & reporting"),
        "included_title": "Everything included in your SEO campaign",
        "included_lead": "Breakdown of the technical, content, and reporting deliverables driving your organic growth:",
        "included": ("Full technical SEO audit", "Keyword universe & competitor gap analysis",
                     "On-page optimization (titles, meta, internal linking)", "Content strategy & briefs",
                     "Monthly performance reporting tied to leads/revenue"),
        "faqs": (
            ("How long does SEO take to show results?",
             "Initial technical improvements and crawling updates usually start reflecting within 3 to 6 months, but "
             "SEO is a compound, long-term growth engine. Unlike agency models that focus purely on fast “vanity "
             "metrics” like impression spikes, Outcomes Digital prioritizes driving high-intent organic traffic "
             "that converts into actual leads and revenue. Significant revenue-impacting results generally "
             "materialize within 6 to 12 months as authority builds and optimized content matures."),
            ("Do you work with businesses outside e-commerce?",
             "Yes. We work with a wide range of ambitious growth-stage and enterprise teams—including D2C brands, "
             "B2B services, SaaS, and professional industries. Whether you run a high-volume online storefront or a "
             "complex B2B lead-generation pipeline, our 4-step framework adapts directly to your specific buyer "
             "intent and revenue goals."),
            ("What's included in an SEO audit?",
             ("Our comprehensive audit evaluates both technical foundation and content opportunity before any "
              "strategy is created:",
              ("Full Technical Audit: Identifying crawl errors, site speed bottlenecks, mobile usability issues, and "
               "site architecture roadblocks holding back rankings.",
               "Keyword Universe & Competitor Gap Analysis: Uncovering high-intent buyer keywords your competitors are "
               "targeting and where opportunities lie.",
               "On-Page & Content Audit: Evaluating titles, meta tags, internal linking, and current content quality "
               "against actual user decision stages.",
               "Actionable Growth Roadmap: Clear, prioritized deliverables designed to unlock measurable business "
               "impact."), "")),
            ("Is SEO or PPC better for my business?",
             ("Neither is strictly “better”—they serve different business needs, and the best strategy often "
              "combines both:",
              ("PPC (Pay-Per-Click): Delivers immediate visibility and instant leads, but traffic stops the moment you "
               "turn off the ad spend.",
               "SEO (Search Engine Optimization): Takes longer to build momentum, but creates a sustainable, high-ROI "
               "acquisition channel that yields compounding leads and revenue long after implementation."),
              "If you need immediate traction, PPC fills the gap while SEO builds your long-term organic foundation.")),
        ),
    },
    "ppc-management": {
        "photo": "step-5", "proof": ("allure-avani", "214", "Qualified leads for Allure Avani"),
        "label": "PPC & Paid Media", "page_title": "PPC & Paid Media Management - Google Ads & Meta Ads",
        "title": "Paid campaigns built to convert, not just click",
        "lead": "More clicks mean nothing without more revenue. We manage Google Ads and Meta Ads around "
                "cost-per-acquisition and ROAS – not vanity click or reach numbers.",
        "cta": "Get a free PPC audit", "problems_title": "Why your current PPC isn’t working",
        "problems": (("Wasted spend hides in plain sight", "Broken conversion tracking, bloated keyword lists, and poor "
                      "account structure quietly burn budget every day – on Google or Meta."),
                     ("More clicks isn’t the goal", "A campaign optimized for clicks or reach alone can look busy "
                      "and still lose money. We optimize for what actually pays.")),
        "why": (("Accountable to CPA and ROAS", "Every campaign, on every platform, measured against "
                 "cost-per-acquisition and return, not just CTR or reach."),
                ("Conversion tracking done right", "We audit and fix tracking (Google Ads + Meta Pixel/CAPI) before "
                 "touching a single bid or budget."),
                ("Budget allocated across platforms", "Not Locked to One, We shift spend between Google and Meta based "
                 "on where it’s actually converting, not habit.")),
        "framework_title": "Our four-step PPC growth framework",
        "framework_lead": "From eliminating wasted ad spend to aggressive scaling, here is how we maximize your "
                          "cost-per-acquisition and bottom-line revenue.",
        "framework": ("Account & conversion tracking audit (Google Ads + Meta)",
                      "Campaign structure & budget rebuild across platforms",
                      "Launch & bid/budget strategy optimization", "Ongoing testing & cross-platform reporting"),
        "included_title": "Everything included in your PPC campaign",
        "included_lead": "Breakdown of the tracking, campaign, and reporting deliverables driving your paid media growth:",
        "included": ("Full Google Ads & Meta Ads account audit",
                     "Conversion tracking setup/repair (Google Ads + Meta Pixel/Conversions API)",
                     "Campaign & ad group/ad set restructuring across platforms",
                     "Ad copy & creative testing (search, display, and social formats)",
                     "Cross-platform budget allocation based on performance, not fixed splits",
                     "Weekly/monthly performance reporting tied to CPA and ROAS"),
        "faqs": (
            ("How much does PPC management cost?",
             "Our management fees depend on your total campaign scope, ad spend volume, and growth targets. Rather "
             "than hidden markups, we keep billing straightforward and transparent. Management fees are always "
             "separate from your direct ad spend paid to Google or Meta, ensuring every dollar going toward your "
             "advertising budget is tracked directly against your acquisition targets."),
            ("Do you manage both Google Ads and Meta Ads, or just one?",
             "We manage both. In fact, managing both under a single unified strategy yields the strongest results. "
             "Google Ads captures active search intent from buyers looking for your solution right now, while Meta "
             "Ads (Facebook & Instagram) builds audience awareness, generates demand, and retargets mid-funnel "
             "prospects."),
            ("How do you decide how much budget goes to Google vs. Meta?",
             "We don’t lock your budget into rigid, static splits. Initial allocation is determined by your "
             "industry and buyer journey—for example, high-intent B2B or local services often lean heavily into "
             "Google Search, while visual D2C brands lean into Meta. Once launched, we dynamically shift budget toward "
             "whichever platform is delivering the lowest Cost-Per-Acquisition (CPA) and highest Return on Ad Spend "
             "(ROAS)."),
            ("How is Outcomes Digital's approach different from a typical PPC agency?",
             ("", ("Focus on Revenue, Not Vanity Metrics: Typical agencies report on impressions, clicks, or CTRs. We "
                   "optimize for high-intent conversions, CPA, and actual bottom-line revenue.",
                   "Tracking & Attribution First: Before spending ad dollars, we audit and repair tracking setups "
                   "(Google Ads + Meta Pixel/Conversions API) to ensure data is 100% reliable.",
                   "Agile Cross-Platform Optimization: We move spend fluidly between Google and Meta based on live "
                   "conversion performance rather than set platform silos."), "")),
            ("How soon will I see results from paid campaigns?",
             "Paid campaigns can generate traffic and immediate leads within days of launch. However, optimal "
             "performance—where CPA drops and ROAS reaches its peak—typically takes 3 to 4 weeks. This initial "
             "window allows algorithms to complete learning phases, gather performance data, and enable us to execute "
             "actionable bid, audience, and ad creative tests."),
        ),
    },
    "cro-services": {
        "photo": "step-1", "proof": ("madge-beauty", "70%", "of Madge Beauty’s orders via the new landing page"),
        "label": "CRO", "page_title": "Conversion Rate Optimization (CRO) Services",
        "title": "Turn more visitors into customers - without spending more on traffic",
        "lead": "More traffic is expensive. A better-converting page is free after it’s built. We find and fix the "
                "friction costing you conversions.",
        "cta": "Get a free CRO audit", "problems_title": "Why your current CRO model isn’t working",
        "problems": (("You’re paying to lose customers twice", "Every visitor who doesn’t convert is spend you "
                      "already paid for, walking away."),
                     ("Guesswork isn’t a CRO strategy", "Redesigning a page based on opinion instead of behavior "
                      "data is a coin flip, not a strategy.")),
        "why": (("Behavior data before design changes", "Heatmaps, session recordings, and funnel data drive every "
                 "recommendation."),
                ("Tested, not assumed", "Every major change is A/B tested against real traffic, not shipped on instinct."),
                ("Built to compound with your ads & SEO", "CRO work makes every dollar already spent on traffic go "
                 "further.")),
        "framework_title": "Our four-step CRO growth framework",
        "framework_lead": "From identifying page friction to continuous A/B testing, here is how we convert more of "
                          "your site visitors into paying customers.",
        "framework": ("Behavior & funnel audit", "Hypothesis & test roadmap", "A/B testing & iteration",
                      "Rollout & ongoing optimization"),
        "included_title": "Everything included in your CRO campaign",
        "included_lead": "Breakdown of the research, testing, and UX deliverables driving your conversion growth:",
        "included": ("Full conversion funnel audit", "Heatmap & session recording analysis",
                     "A/B test roadmap & execution", "Landing page & checkout optimization",
                     "Monthly reporting tied to conversion rate & revenue per visitor"),
        "faqs": (
            ("What's a good conversion rate for my industry?",
             ("“Good” varies significantly by business model and industry. Across digital channels:",
              ("E-commerce: Average conversion rates typically sit between 2% and 3%.",
               "B2B & Lead Generation: Average landing page conversion rates usually range from 3% to 7%+ (depending "
               "on form complexity and offer value)."),
              "Rather than chasing generic industry averages, Outcomes Digital focuses on moving your specific baseline "
              "upward—optimizing your site to maximize total revenue or qualified leads per visitor.")),
            ("How is CRO different from a website redesign?",
             "A traditional website redesign is often based on opinion and visual trends—essentially a high-risk "
             "gamble that can disrupt your existing conversion flow. CRO is data-backed and scientific. Whether you "
             "run an e-commerce checkout or a complex B2B sales funnel, we analyze user behavior (via heatmaps, "
             "recordings, and analytics) to fix exact friction points. We then hypothesis-test, optimize, and "
             "validate changes through live A/B tests to guarantee growth before making permanent site changes."),
            ("How long does A/B testing take to show results?",
             "Most individual A/B tests run for 2 to 4 weeks. This timeframe ensures tests reach statistical "
             "significance (typically 95%+ confidence) while accounting for day-of-week traffic patterns, seasonality, "
             "and varying customer buying cycles across both B2B and consumer sectors."),
            ("Do I need a lot of traffic for CRO to work?",
             "While high traffic enables rapid statistical A/B testing, you don’t need millions of visitors to "
             "benefit from CRO. For lower-traffic or high-ticket B2B sites, we prioritize high-impact qualitative and "
             "structural optimizations—streamlining lead forms, clarifying value propositions, and fixing user "
             "experience bottlenecks. If you are investing in paid ads or organic search, CRO ensures you get maximum "
             "ROI and leads out of your existing visitors."),
        ),
    },
}

# ── eCommerce ───────────────────────────────────────────────────────────────────────────────────────────
ECOM_LEAD = ("We're the growth desk for founders who care about unit economics, not vanity metrics. Data, website, "
             "ads and creative - fixed and scaled together, so your marketing actually pays for itself.")
# The revenue leak estimator, as the live page models it: the share of spend wasted, the multiple of a year's
# waste that is recoverable, and the default spend, by stage; and where the leak hides.
ECOM_LEAK = {"min": 50000, "max": 5000000, "step": 25000,
             "stages": {"running": {"label": "Already running ads", "tag": "Scaling", "rate": 0.22, "years": 2.4,
                                    "spend": 1000000},
                        "new": {"label": "Just starting out", "tag": "Starting out", "rate": 0.14, "years": 1.6,
                                "spend": 200000}},
             "split": (("Tracking gaps", 0.36), ("Landing-page drop-off", 0.41), ("Creative fatigue", 0.23))}
ECOM_MATTERS = (
    ("Knowing what's actually working", "You need accurate data on which ads and pages are making you money. If "
     "you're new, we set this up correctly from day one. If you're already running ads, we check it - most setups "
     "have gaps nobody noticed."),
    ("A website that turns visitors into buyers", "Getting people to your site is only half the job. If the page is "
     "slow, confusing, or hard to buy from, you lose sales no matter how good the ad was."),
    ("Ads and content people actually respond to", "The same ad stops working after a while, even a good one. You "
     "need fresh ideas regularly, not just more budget behind the same three ads."),
)
ECOM_STEPS = (
    ("Understand where you stand", "New brand: we learn your product, customers and market. Existing brand: we "
     "check your data and find what's not working."),
    ("Build a website that converts", "A page that's easy to buy from, whether it's your first one or a rebuild of "
     "what you have."),
    ("Create ads people respond to", "Strategy, copy and ad creative - built for your brand, not recycled templates."),
    ("Run your marketing", "Google, Meta, Amazon/Flipkart and more - spending your budget where it actually pays off."),
    ("Get found without paying for every click", "SEO and visibility in AI tools like ChatGPT and Google's AI "
     "answers, so you're not only reachable through ads."),
)
ECOM_SERVICES = (
    ("Performance marketing", "Running your ads on the platforms that actually sell.",
     ("Google Ads", "Meta (Facebook & Instagram) Ads", "Amazon / Flipkart", "Programmatic display")),
    ("SEO / GEO / AEO", "Getting found on Google - and in AI tools like ChatGPT.",
     ("Ecommerce SEO", "Google Shopping feed setup", "Technical website health", "Showing up in AI search answers")),
    ("Creative strategy & build", "The ads and images people actually stop scrolling for.",
     ("Creative strategy", "Copywriting", "Ad creative production", "Graphic design")),
    ("Landing page strategy & build", "A website that turns visitors into paying customers.",
     ("Landing page design & build", "Fixing cart & checkout drop-off", "Page speed improvements",
      "Tracking & data check-up")),
)
# What we typically find: (area, what we find, why it matters).
ECOM_FINDS = (
    ("Landing page", "Checkout friction, slow load times, and pages that have never been properly audited.",
     "You're paying for traffic that never had a real chance to convert."),
    ("Tracking accuracy", "Website numbers and ad platform numbers don't match.",
     "You end up scaling the wrong campaigns because the data is lying to you."),
    ("Data passback", "Conversion data isn't being fed back to the ad platform properly.",
     "The algorithm can't optimize for outcomes it never actually sees."),
    ("Creatives", "The same 2-3 ad angles have been running for months.",
     "Performance quietly decays while budget keeps flowing to what's gone stale."),
    ("Campaign structure", "Overlapping audiences and mismatched objectives across platforms.",
     "Your own campaigns end up competing against each other for the same customer."),
    ("Budget distribution", "Spend allocated by gut feeling instead of what's actually converting.",
     "Money keeps flowing to what feels safe, not what's working."),
)
# Real results: (brand, where, what changed, [(measure, before, after)]).
ECOM_RESULTS = (
    ("Madge Beauty", "Beauty · AU", "Fixed duplicate pixel/CAPI events and rebuilt the landing page - then scaled "
     "spend on a funnel that finally converted.",
     (("ROAS · 4 months", "1x", "3x"), ("CPA", "$79", "$21"), ("Bounce rate", "80%", "40%"))),
    ("Krishnamurti Foundation India", "Education · IN", "Unified strategy across the owned website and Amazon "
     "marketplace instead of running each in isolation.",
     (("Website ROAS · 6mo", "1.5x", "5x"), ("Amazon ROAS · 12mo", "1.8x", "6.25x"),
      ("Website orders", "baseline", "20x+"))),
    ("Artistic Yoga", "Health & Fitness · UAE", "Rebuilt fatigued creative angles and tightened the funnel for a "
     "UAE-based health and fitness brand.",
     (("Monthly sales", "baseline", "2x"), ("ROAS · 6mo", "1.5x", "3.5x"), ("CPA (AED)", "822", "312"))),
    ("Material Hunt", "Home & Paints · IN", "Full-funnel rebuild - tracking, landing pages and creative - before "
     "scaling spend with confidence.",
     (("ROAS · 6 months", "baseline", "17x"), ("CPA (₹)", "higher", "400-500"),
      ("Monthly revenue", "prior", "₹16-17L"))),
)
# The same figures as About (ABOUT_IMPACT): 25+ brands, 74%+ retention, confirmed by the team on 10 November 2026.
ECOM_STATS = (("$5M+", "Revenue generated for clients"), ("25+", "Ecommerce & growth-stage brands scaled"),
              ("74%+", "Client retention"))
ECOM_QUOTES = (
    ("We came to Outcomes Digital for performance marketing and left with a complete growth strategy - creative, "
     "funnel and reporting all improved together, and revenue grew alongside profitability.", "Dheeraj Jain",
     "Co-Founder, Material Hunt", "DJ"),
    ("The team rebuilt our creative and funnel from the ground up. Within months our ROAS doubled and our team "
     "finally had a system, not guesswork.", "Gurpreet Singh", "CEO, Artistic Yoga", "GS"),
    ("They connected the dots between our website, Amazon presence and paid media. Reporting became simple and every "
     "rupee spent could be traced to an outcome.", "Saurabh", "Krishnamurti Foundation India", "S"),
)
ECOM_FIT = ("You run an ecommerce store - or you're about to launch one",
            "You want to grow sales without wasting money learning by trial and error",
            "You want a simple, clear plan - not just \"spend more on ads\"",
            "You'd rather work with people who explain things simply, not jargon",
            "You believe getting the basics right matters as much as running ads")
ECOM_PLAN = ("Where to start (or what to fix) with your data", "Whether your website is set up to convert",
             "Which ads and channels make sense for your budget", "A simple plan you can act on this month")
ECOM_BUDGETS = ("Under ₹1,00,000", "₹1,00,000 - ₹5,00,000", "₹5,00,000 - ₹15,00,000",
                "₹15,00,000 - ₹50,00,000", "₹50,00,000+", "Not sure yet")

# ── Education ───────────────────────────────────────────────────────────────────────────────────────────
EDU_LEAD = ("We help schools and colleges fill seats with students who actually enrol. Our campaigns are built "
            "around admissions, not clicks, and we’re measured on the same results you are.")
EDU_JOURNEY = ("Enquiry", "Campus visit", "Application", "Fee payment")
# Who it's for: (name, who decides, text, what we fill).
EDU_WHO = (
    ("K-12 Schools", "Parents decide", "Parents shortlist schools months before admissions open. We keep your school "
     "visible through that journey and bring in families who are genuinely looking, not just browsing.",
     "Qualified enquiries, campus visits and admissions"),
    ("Degree Colleges & Universities", "Students and parents decide together", "Whether it's B.E/B.Tech, BBA, BCA, "
     "B.Com, MBBS or BDS, students and parents compare options together. We reach them early and keep your "
     "institution in the running till admission day.", "Qualified enquiries, campus visits and admissions"),
    ("PG Colleges & Universities", "The professional decides, mostly alone", "For MBA, MS, M.Tech, MD and other PG "
     "programs, admission windows are short and decisions move fast. We keep your program visible and connect you "
     "with people seriously comparing their options.", "Qualified enquiries, campus visits and admissions"),
)
EDU_PROBLEMS = (
    ("Plenty of enquiries, few serious students", "Broad targeting fills your list with people who are unlikely to "
     "apply, visit or enrol."),
    ("Every institution looks the same", "The same campus shots and course lists give parents and students no clear "
     "reason to choose you."),
    ("No idea what drives enrolments", "Clicks and enquiries are reported, but nobody can show which campaigns led to "
     "visits, applications or fee payments."),
    ("Follow-up is too slow", "The institution that responds first, with something useful, usually gets the campus "
     "visit or application."),
    ("Warm enquiries go cold", "Old enquiries, incomplete applications and missed campus visits are rarely brought "
     "back into the conversation."),
    ("The other decision-maker gets missed", "Students research, but parents often decide and pay. Speaking to only "
     "one of them stalls the decision."),
)
EDU_SYSTEM = (
    ("Stay visible", "Be everywhere they look", "Parents and students compare for weeks. We keep your institution "
     "visible across Search, Instagram, YouTube and Gmail."),
    ("Follow up fast", "Warm them up before you call", "Helpful WhatsApp and email follow-up starts when they show "
     "interest, so your counsellor never calls a stranger."),
    ("One shared view", "One shared screen", "Marketing and admissions data sit in one place, from first enquiry to "
     "campus visit, application and fee payment."),
    ("Only serious enquiries", "Serious enquiries reach your team", "We check course interest, location, timing and "
     "intent before an enquiry reaches your admissions team."),
    ("Learn & improve", "We track what happened", "We track who visited, applied, enrolled or went cold — and use "
     "that answer to improve every campaign."),
)
EDU_TRUSTED = ("CBSE K-12 school, Hyderabad", "PG admissions — MBA & MCA, Bangalore",
               "Nursing & allied health sciences college, Bangalore", "CBSE K-12 school, North Bangalore",
               "Educational trust & schools, Chennai", "School transformation network, pan-India")
# The Edu Tech strategy call is 30 minutes (confirmed by the team on 10 November 2026).
EDU_CALL_MIN = 30
# The enrolment leak calculator: a benchmark rate for fast, connected follow-up, and the sliders' ranges.
EDU_CALC = {"enquiries": 300, "rate": 6, "benchmark": 15, "min": 50, "max": 2000, "step": 10,
            "rate_min": 1, "rate_max": 15, "rate_step": 0.5}
EDU_START = (
    ("Decades of reputation", "Your name already carries weight with families. We build the digital layer underneath "
     "it without diluting that trust."),
    ("Doing some digital already", "We connect your campaigns, portal listings and social activity into one clear "
     "system instead of adding another channel."),
    ("Running a full program", "We find where qualified students drop between enquiry, visit, application and fee "
     "payment — without starting over."),
)
EDU_FIT = ("You have seats, programs or courses to fill", "You want qualified enquiries, not just more names to call",
           "Your marketing and admissions teams can share the same data",
           "You want to measure visits, applications and enrolments")
EDU_CALL = ("30 minutes, focused on your admissions journey", "A clear read on the biggest leak points",
            "No pitch deck and no obligation")

# ── Real estate ─────────────────────────────────────────────────────────────────────────────────────────
RE_LEAD = ("We work with real estate businesses at every stage. The only thing that matters is whether your "
           "marketing is producing buyers who show up — not just leads who don't.")
RE_PROBLEMS = (
    ("Wrong traffic, not real buyers", "Broad targeting fills the funnel with lookers. Your team pays for it in wasted "
     "calls."),
    ("Creative nobody remembers", "Same unit shots, same amenities list as every competitor — and it rarely speaks "
     "to the spouse or family actually deciding alongside them."),
    ("No idea what's actually working", "Partner leads and online leads look the same on paper."),
    ("Too slow to matter", "A lead called in minutes behaves nothing like one called hours later. Most follow-up isn't "
     "close."),
    ("Nobody asks why leads go cold", "Hundreds of calls happen every month. Almost none of them get reviewed for what "
     "actually went wrong."),
    ("NRI buyers slip away", "A process built for walk-ins can't handle overseas buyers."),
)
RE_SYSTEM = (
    ("Demand", "Be everywhere they look", "Nobody buys a home on the first visit. We stay in front of them across "
     "Search, Instagram, YouTube and Gmail until your name feels familiar."),
    ("Nurture", "Warm them up before you call", "WhatsApp and email start the moment they show interest — helpful "
     "info, not a pitch. So your name isn't a stranger's when you ring."),
    ("CRM", "One shared screen", "Marketing data and CRM data in one place. No more two spreadsheets that disagree."),
    ("Qualify", "Junk leads filtered out first", "Our AI layer checks intent and budget before a lead reaches your "
     "team — so they only call people worth calling."),
    ("Outcomes", "We track what happened", "Our call analytics show who converted, who went cold and why. That answer "
     "goes straight back into the campaign."),
)
# Proof: (project, what it is, [(measure, change)]).
RE_PROOF = (
    ("Allure Avani", "Luxury villas · Bangalore",
     (("Qualified leads", "2x"), ("Site visits", "4x"), ("Cost per site visit", "−40%"))),
    ("Govind Realty DXB", "Dubai real estate consultancy · NRI investment",
     (("Qualified leads", "1.5x"), ("Site visits", "3.25x"), ("Cost per site visit", "−32%"))),
)
RE_START = (
    ("Been at it for decades", "Your name already sells. We build the digital layer under it — nothing you already "
     "do breaks."),
    ("Doing some digital already", "We tie what you're running into one clear system instead of adding another "
     "channel."),
    ("Running a full program", "We find where good buyers are leaking out and plug it — no starting over."),
)
RE_FIT = ("You're actively selling units or plots",
          "You want to know what's converting, not just how many leads came in",
          "You're fine with sales and marketing seeing the same data",
          "You're tired of chasing leads your partners already have")
RE_CALL = ("45 minutes, straight to your funnel", "A written read on the leak points", "No deck, no retainer talk")
RE_STAGES = ("Traditional / referral only", "Some digital marketing", "Full digital program already running")
