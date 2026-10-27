"""The content of the public site that repeats across its pages (the October 2026 rebuild).

The site sells two things: GTM engineering, where we promise a number of booked meetings each month
for a fixed fee, and performance marketing run with our agents and paid on results. Lists that more
than one page shows live here, so a play or a question is written once. Page copy that appears on one
page only lives in that page's template under templates/site/.

Everything here is sample or plain fact about how we work. Sample leads describe a role and a kind of
company, never a real person or a real company.
"""

GTM_FEE = "$1,000"

# The pages in the header, in order: (address, label).
NAV = (
    ("/gtm-engineering", "GTM Engineering"),
    ("/performance-marketing", "Performance Marketing"),
    ("/plays", "Plays"),
    ("/industries", "Industries"),
    ("/how-it-works", "How it works"),
    ("/pricing", "Pricing"),
)

# The buying signs we watch for, each a play our agents run today. Hiring signals are off on purpose.
# Each play has its own page (/plays/<slug>): what it finds, where we look, a sample lead and a
# sample first message. "group" sorts them on /plays; "fits" names the industries (INDUSTRIES below)
# the play suits best.
PLAY_GROUPS = (
    ("say", "What people say in public"),
    ("do", "What companies and people do"),
    ("match", "Who looks like your best customers"),
)

PLAYS = (
    {"slug": "posting-about-the-problem", "group": "say", "name": "Posting about the problem",
     "sign": "A LinkedIn post that names the problem you solve.", "agent": "Lead Finder",
     "finds": "People who write in public about the exact problem you solve: rising costs, a process "
              "that keeps breaking, a tool they have outgrown. Someone describing the pain this week is "
              "far likelier to take a meeting than someone who merely fits your profile.",
     "where": ("LinkedIn posts from the last few weeks", "The words your buyers use, agreed on the call",
               "Your customer profile, to keep only the people who fit"),
     "lead": {"who": "Head of Operations", "where": "Accounting firm, 120 people",
              "why": "Posted that month-end close still takes them nine days, and asked how others do it.",
              "src": "LinkedIn post · 3 days ago", "score": 92},
     "message": "Saw your post about the nine-day close. Shortening it for firms your size is what we do. "
                "Worth 20 minutes to compare notes?",
     "fits": ("technology-saas", "professional-services", "agencies", "financial-services")},
    {"slug": "asking-for-recommendations", "group": "say", "name": "Asking for recommendations",
     "sign": "“Can anyone recommend…” posts and Reddit threads.", "agent": "Lead Finder",
     "finds": "People asking their network or a community to recommend a supplier like you. It is the "
              "clearest buying sign there is: they have a need, a budget in mind, and they are choosing now.",
     "where": ("LinkedIn posts asking for recommendations", "Reddit and community threads in your field",
               "Your customer profile, to keep only the people who fit"),
     "lead": {"who": "Founder", "where": "D2C skincare brand, 15 people",
              "why": "Asked their network to recommend a performance marketing agency before a launch.",
              "src": "LinkedIn post · yesterday", "score": 95},
     "message": "Saw you're looking for help before the launch. Happy to share what we'd check first in "
                "your ad accounts, no strings. Would Thursday suit?",
     "fits": ("agencies", "ecommerce", "professional-services", "technology-saas")},
    {"slug": "rivals-audience", "group": "say", "name": "A rival's audience",
     "sign": "People commenting on a competitor's posts.", "agent": "Lead Finder",
     "finds": "People who comment on your competitors' posts: their customers, people comparing options, "
              "and people unhappy with what they have. You name the competitors on the call; we watch them.",
     "where": ("Comments on the competitors you name", "Their company pages and their leaders' posts",
               "Your customer profile, to keep only the people who fit"),
     "lead": {"who": "VP Sales", "where": "Logistics software company, 200 people",
              "why": "Commented on a competitor's launch post asking whether it works with their CRM.",
              "src": "LinkedIn comment · today", "score": 87},
     "message": "Noticed your question about CRM support on the launch post. It's the first thing our "
                "customers ask too. Want to see how we handle it?",
     "fits": ("technology-saas", "it-services", "financial-services")},
    {"slug": "experts-audience", "group": "say", "name": "An expert's audience",
     "sign": "People commenting on an industry expert's posts.", "agent": "Lead Finder",
     "finds": "People who engage with the experts your buyers follow. A comment on a post about your "
              "subject says the topic is on their mind, and the comment itself gives you the opening line.",
     "where": ("Comments on the experts you and we choose", "Posts on the subjects you sell into",
               "Your customer profile, to keep only the people who fit"),
     "lead": {"who": "Head of People", "where": "Hospital group, 2,000 staff",
              "why": "Commented on an HR expert's post about nurse retention: “this is our number one issue”.",
              "src": "LinkedIn comment · 2 days ago", "score": 84},
     "message": "Your comment on retention stuck with me. Early turnover often starts in the first weeks of "
                "onboarding. Would a short call be useful?",
     "fits": ("healthcare", "education", "professional-services")},
    {"slug": "tenders-and-rfps", "group": "do", "name": "Tenders and RFPs",
     "sign": "A published request for proposals in your field.", "agent": "Lead Finder",
     "finds": "Organisations that have published a tender or a request for proposals for what you sell. "
              "We find them while there is still time to respond, with the deadline and the named contact.",
     "where": ("Public procurement portals and tender notices", "Requests for proposals posted on the open web",
               "The services and regions agreed on the call"),
     "lead": {"who": "Operations Director", "where": "Logistics firm, 300 people",
              "why": "Published a tender for a customer-portal rebuild, closing in 3 weeks.",
              "src": "Tender notice · yesterday", "score": 88},
     "message": "Saw the portal tender. Before you write the brief, would a 20-minute look at what similar "
                "firms asked for help?",
     "fits": ("it-services", "professional-services", "education", "healthcare")},
    {"slug": "news-that-opens-a-door", "group": "do", "name": "News that opens a door",
     "sign": "Funding, a launch, an expansion or a new office.", "agent": "Market Radar",
     "finds": "Companies in the news for something that creates a need: a funding round, a product launch, "
              "a new market, a new office. The news is your reason to write, and it dates the need.",
     "where": ("Company news and press releases", "Funding and launch announcements",
               "Moves by the companies in your market"),
     "lead": {"who": "COO", "where": "Fintech, 60 people",
              "why": "Announced a Series A and an office in London this week.",
              "src": "Press release · 2 days ago", "score": 85},
     "message": "Congratulations on the round and the London office. Hiring and set-up in a new city is "
                "where we usually help first. Open to a quick call?",
     "fits": ("technology-saas", "financial-services", "real-estate")},
    {"slug": "new-in-the-job", "group": "do", "name": "New in the job",
     "sign": "A buyer who has just started a role.", "agent": "Job Change Alert",
     "finds": "Buyers who have just started a new role, at your customers' companies or at companies that "
              "fit. New leaders review suppliers in their first months, and a former customer brings you "
              "with them.",
     "where": ("Job changes of the roles you sell to", "Your past customers' and champions' moves",
               "Your customer profile, to keep only the companies that fit"),
     "lead": {"who": "New Head of Marketing", "where": "Property developer, 400 people",
              "why": "Started the role 3 weeks ago; was a customer at their last company.",
              "src": "Job change · 3 weeks ago", "score": 90},
     "message": "Congratulations on the new role. You worked with us at your last company; happy to share "
                "what we'd look at first here.",
     "fits": ("real-estate", "technology-saas", "agencies", "ecommerce")},
    {"slug": "visitors-on-your-site", "group": "do", "name": "Visitors on your site",
     "sign": "Companies reading your pricing or product pages.", "agent": "Website visitors",
     "finds": "Companies that visit your website and read the pages that matter, such as pricing or a "
              "product, without filling in a form. We name the company and find the right person there.",
     "where": ("Your website's visits, with a small script we give you", "The pages each company read, and how often",
               "Your customer profile, to keep only the companies that fit"),
     "lead": {"who": "IT Director", "where": "Insurance broker, 250 people",
              "why": "Three visits to your pricing page this week from the company's network.",
              "src": "Website visits · this week", "score": 83},
     "message": "A few of your team have been looking at how we price this. Happy to walk you through what "
                "a firm your size usually needs. Does next week work?",
     "fits": ("technology-saas", "it-services", "financial-services")},
    {"slug": "same-event", "group": "do", "name": "Going to the same event",
     "sign": "Speakers and attendees of events in your market.", "agent": "Event & Conference Intelligence",
     "finds": "The events your buyers go to, and the speakers and exhibitors at them. A shared event is a "
              "natural reason to meet, before, during or after it.",
     "where": ("Conference agendas, speaker and exhibitor lists", "Events in your market and regions",
               "Your customer profile, to keep only the people who fit"),
     "lead": {"who": "Director of Admissions", "where": "University, 15,000 students",
              "why": "Speaking at a higher-education marketing conference next month.",
              "src": "Event agenda · next month", "score": 82},
     "message": "Saw you're speaking at the conference next month. We'll be there too. Coffee before your "
                "session?",
     "fits": ("education", "healthcare", "it-services", "agencies")},
    {"slug": "lookalikes", "group": "match", "name": "Lookalikes of your best customers",
     "sign": "Companies and roles that match your best accounts.", "agent": "Lead Finder",
     "finds": "Companies that look like your best customers, by industry, size, place and the tools they "
              "use, and the people in the roles that buy from you. Steady volume to sit beside the "
              "sharper signs.",
     "where": ("Business databases of companies and roles", "Your best customers, named on the call",
               "Your customer profile"),
     "lead": {"who": "Head of Growth", "where": "Online furniture retailer, 90 people",
              "why": "Same size, market and tools as three of your best customers.",
              "src": "Profile match · today", "score": 80},
     "message": "We work with a few retailers very like yours on paid search. One question: which channel "
                "carries the most weight for you right now?",
     "fits": ("ecommerce", "technology-saas", "agencies", "professional-services")},
    {"slug": "several-signs-at-once", "group": "match", "name": "Several signs at once",
     "sign": "Two or more signs at one company in a short window.", "agent": "People & Signals",
     "finds": "Companies where two or more signs land close together: news, a new leader, a post about "
              "the problem, visits to your site. One sign can be chance; several in a fortnight is a "
              "company that is moving.",
     "where": ("Every play we run for you, combined by company", "The people at each company and their roles",
               "Your customer profile"),
     "lead": {"who": "CFO", "where": "Healthcare software company, 150 people",
              "why": "New CFO this month, a funding round, and two visits to your pricing page.",
              "src": "3 signs · last 14 days", "score": 94},
     "message": "Congratulations on the new role and the round. When finance changes hands, this is "
                "usually the first thing reviewed. Worth a short call?",
     "fits": ("technology-saas", "financial-services", "healthcare")},
    {"slug": "local-businesses", "group": "match", "name": "Local businesses like your customers",
     "sign": "Every business of one type in a city, scored.", "agent": "Local Business Radar",
     "finds": "Every business of the kind you serve in the cities you choose, such as clinics, agencies "
              "or showrooms, scored by how established they are and how well they show up online.",
     "where": ("Map listings and reviews", "Each business's website and how it ranks",
               "The business types and cities agreed on the call"),
     "lead": {"who": "Practice Owner", "where": "Dental clinic, 3 locations",
              "why": "Strong reviews but no ads running, and a website that loads slowly on phones.",
              "src": "Map listing · checked today", "score": 81},
     "message": "Your reviews are excellent, but a patient searching on a phone may not get far enough to "
                "see them. Can I show you what we found?",
     "fits": ("healthcare", "real-estate", "professional-services")},
)
PLAYS_BY_SLUG = {p["slug"]: p for p in PLAYS}

# The markets we book meetings in, each with its own page (/industries/<slug>). Every sample is a role
# and a kind of company, never a real person or company. "plays" are slugs from PLAYS above.
INDUSTRIES = (
    {"slug": "technology-saas", "name": "B2B software", "short": "Software",
     "headline": "Meetings with the people who buy software like yours.",
     "lead": "Software buyers research quietly and compare in public. We find the ones posting about the "
             "problem you solve, asking peers what to use, or engaging with your competitors, and book them "
             "in with your sales team.",
     "buyers": ("Heads of department who own the problem", "Founders and COOs at smaller companies",
                "Finance and IT, who sign off"),
     "plays": ("posting-about-the-problem", "rivals-audience", "visitors-on-your-site", "several-signs-at-once"),
     "samples": (
        {"lead": {"who": "Head of Customer Success", "where": "SaaS company, 180 people",
                  "why": "Posted that churn doubled after a price change and asked what others track.",
                  "src": "LinkedIn post · 2 days ago", "score": 90},
         "message": "Saw your post on churn after the price change. Which signal do you watch first today? "
                    "Happy to share what we see across similar teams."},
        {"lead": {"who": "CTO", "where": "Fintech platform, 70 people",
                  "why": "Commented on a competitor's post asking about data residency in the EU.",
                  "src": "LinkedIn comment · today", "score": 86},
         "message": "Noticed your question about EU data residency. It's how we're set up by default. Want a "
                    "15-minute look?"},
        {"lead": {"who": "VP Revenue", "where": "HR software company, 250 people",
                  "why": "New in the role, and the company read your pricing page twice this week.",
                  "src": "2 signs · this week", "score": 92},
         "message": "Congratulations on the new role. A few of your team have been reading how we price this; "
                    "happy to walk you through it."},
     ),
     "perf": "Software is a crowded search market. Our agents check search terms, competitors' keywords and "
             "landing pages daily, so budget goes to the searches that turn into trials and demos.",
     "faq": (("Do you book meetings with our sales team or with the founder?",
              "Whoever takes first calls today. The calendar link goes where you tell us."),
             ("Can you avoid our existing customers and open deals?",
              "Yes. Share the list and we exclude them from every play."))},
    {"slug": "agencies", "name": "Marketing and creative agencies", "short": "Agencies",
     "headline": "New clients for your agency, found while they're still choosing.",
     "lead": "Agency work is bought when something changes: a launch, a new marketing lead, a campaign that "
             "isn't working. We find the companies at that moment and book them in with you.",
     "buyers": ("Heads of marketing and growth", "Founders of growing brands", "Marketing directors who just started"),
     "plays": ("asking-for-recommendations", "new-in-the-job", "posting-about-the-problem", "lookalikes"),
     "samples": (
        {"lead": {"who": "Founder", "where": "D2C skincare brand, 15 people",
                  "why": "Asked their network to recommend a performance marketing agency before a launch.",
                  "src": "LinkedIn post · yesterday", "score": 95},
         "message": "Saw you're looking for help before the launch. Happy to share what we'd check first, no "
                    "strings. Would Thursday suit?"},
        {"lead": {"who": "New Marketing Director", "where": "Furniture retailer, 120 people",
                  "why": "Started two weeks ago; the company's ads haven't changed in four months.",
                  "src": "Job change · 2 weeks ago", "score": 88},
         "message": "Congratulations on the new role. When you're ready to look at the ads, we'd be glad to "
                    "share a quick audit."},
        {"lead": {"who": "Head of Brand", "where": "Fintech, 90 people",
                  "why": "Posted that their rebrand is stalling and asked how others ran theirs.",
                  "src": "LinkedIn post · 4 days ago", "score": 84},
         "message": "Read your post about the rebrand. The stall usually happens at one stage. Worth 20 "
                    "minutes to talk it through?"},
     ),
     "perf": "If you run ads for clients, our agents can check every client account daily and send each "
             "client its own morning message, so your team spends its time on the work clients see.",
     "faq": (("Can we use this to win clients and to serve them?",
              "Yes. We book meetings for your agency, and our ad agents can check your clients' accounts."),
             ("Do you approach our existing clients?",
              "No. Share your client list and we exclude it from every play."))},
    {"slug": "professional-services", "name": "Consultancies and professional services",
     "short": "Professional services",
     "headline": "Meetings with the firms that need your expertise this quarter.",
     "lead": "Consulting is bought by people with a named problem and a deadline. We find them in what "
             "they post, the tenders they publish and the changes at their companies.",
     "buyers": ("Partners and managing directors", "COOs and CFOs", "Heads of operations, people and finance"),
     "plays": ("posting-about-the-problem", "tenders-and-rfps", "experts-audience", "lookalikes"),
     "samples": (
        {"lead": {"who": "Head of Operations", "where": "Accounting firm, 120 people",
                  "why": "Posted that month-end close still takes nine days, and asked how others do it.",
                  "src": "LinkedIn post · 3 days ago", "score": 92},
         "message": "Saw your post about the nine-day close. Shortening it for firms your size is what we do. "
                    "Worth 20 minutes to compare notes?"},
        {"lead": {"who": "Procurement Lead", "where": "Regional council",
                  "why": "Published a request for proposals for a service redesign, closing in a month.",
                  "src": "Tender notice · today", "score": 87},
         "message": "Saw the request for proposals on the service redesign. Would a short call before the "
                    "deadline help shape your brief?"},
        {"lead": {"who": "COO", "where": "Engineering firm, 400 people",
                  "why": "Commented on an expert's post about scaling operations past 300 people.",
                  "src": "LinkedIn comment · 2 days ago", "score": 83},
         "message": "Your comment on scaling past 300 people rang true. It's the stage we help with most. "
                    "Open to a conversation?"},
     ),
     "perf": "Services are often searched by name and problem. Our agents keep your ads on the searches that "
             "bring enquiries and off the ones that bring job seekers and students.",
     "faq": (("Our deals are large and slow. Does this still work?",
              "Yes. We promise meetings, not deals, and a meeting with the right partner is the step that matters."),
             ("Can you work in regulated sectors?",
              "Yes. We agree on the call who we may contact and what the messages may say."))},
    {"slug": "it-services", "name": "IT services and security", "short": "IT and security",
     "headline": "Meetings with IT and security leaders who are changing something.",
     "lead": "IT buyers move when something forces them: an audit, a breach in the news, a migration, a "
             "tender. We watch for those moments and book you in while the decision is open.",
     "buyers": ("IT directors and CIOs", "Heads of security", "Operations leaders at smaller firms without IT teams"),
     "plays": ("tenders-and-rfps", "rivals-audience", "visitors-on-your-site", "same-event"),
     "samples": (
        {"lead": {"who": "IT Director", "where": "Insurance broker, 250 people",
                  "why": "Three visits to your managed-security page this week from the company's network.",
                  "src": "Website visits · this week", "score": 86},
         "message": "A few of your team have been reading about managed security. Happy to share what a firm "
                    "your size usually needs first."},
        {"lead": {"who": "Head of IT", "where": "School trust, 12 schools",
                  "why": "Published a tender for network and device support, closing in 3 weeks.",
                  "src": "Tender notice · yesterday", "score": 89},
         "message": "Saw the support tender. Would a short call before the deadline be useful? We can share "
                    "what similar trusts asked for."},
        {"lead": {"who": "CISO", "where": "Logistics group, 1,500 people",
                  "why": "Speaking on a panel about ransomware readiness next month.",
                  "src": "Event agenda · next month", "score": 80},
         "message": "Saw you're on the ransomware panel next month. We'll be there; coffee before it?"},
     ),
     "perf": "IT searches are expensive and full of researchers. Our agents cut the searches that never "
             "convert and watch which services and places bring real enquiries.",
     "faq": (("Can you target only companies in our region?",
              "Yes. Regions are part of the customer profile we agree on the call."),
             ("Do you need access to our website for the visitors play?",
              "Only a small script we give you. The other plays need nothing from your site."))},
    {"slug": "financial-services", "name": "Financial services and fintech", "short": "Financial services",
     "headline": "Meetings with finance leaders at the moment they're deciding.",
     "lead": "Finance buyers change suppliers around events: funding, a new CFO, an audit, a new market. "
             "We find those moments and book you in with the people who decide.",
     "buyers": ("CFOs and finance directors", "Heads of risk and compliance", "Founders of growing fintechs"),
     "plays": ("news-that-opens-a-door", "several-signs-at-once", "rivals-audience", "visitors-on-your-site"),
     "samples": (
        {"lead": {"who": "CFO", "where": "Healthcare software company, 150 people",
                  "why": "New CFO this month, a funding round, and two visits to your pricing page.",
                  "src": "3 signs · last 14 days", "score": 94},
         "message": "Congratulations on the new role and the round. When finance changes hands, this is "
                    "usually the first thing reviewed. Worth a short call?"},
        {"lead": {"who": "COO", "where": "Fintech, 60 people",
                  "why": "Announced a Series A and an office in London this week.",
                  "src": "Press release · 2 days ago", "score": 85},
         "message": "Congratulations on the round and the London office. Set-up in a new city is where we "
                    "usually help first. Open to a quick call?"},
        {"lead": {"who": "Head of Compliance", "where": "Payments company, 300 people",
                  "why": "Commented on a competitor's post about new reporting rules.",
                  "src": "LinkedIn comment · today", "score": 82},
         "message": "Saw your comment on the new reporting rules. We've built for them already. Want a "
                    "15-minute look?"},
     ),
     "perf": "Financial searches are among the most expensive there are. Our agents check every search term "
             "and place daily, so spend goes to the ones that bring applications, not clicks.",
     "faq": (("Can the messages meet our compliance rules?",
              "Yes. You approve every message before sending starts, and we agree what they may say."),
             ("Can you reach only certain company sizes?",
              "Yes. Size, industry and region are part of the profile we agree on the call."))},
    {"slug": "healthcare", "name": "Healthcare", "short": "Healthcare",
     "headline": "Meetings with clinics, hospitals and health businesses.",
     "lead": "Healthcare buyers are busy and careful. We find them through what they publish, the events "
             "they attend and the problems they raise, and book you in with a reason they'll recognise.",
     "buyers": ("Practice owners and managers", "Hospital operations and HR leaders", "Heads of digital and IT"),
     "plays": ("experts-audience", "tenders-and-rfps", "same-event", "local-businesses"),
     "samples": (
        {"lead": {"who": "Practice Owner", "where": "Dental clinic, 3 locations",
                  "why": "Strong reviews but no ads running, and a website that loads slowly on phones.",
                  "src": "Map listing · checked today", "score": 81},
         "message": "Your reviews are excellent, but a patient searching on a phone may not get far enough "
                    "to see them. Can I show you what we found?"},
        {"lead": {"who": "Head of People", "where": "Hospital group, 2,000 staff",
                  "why": "Commented on an HR expert's post about nurse retention: “this is our number one issue”.",
                  "src": "LinkedIn comment · 2 days ago", "score": 84},
         "message": "Your comment on retention stuck with me. Early turnover often starts in the first weeks "
                    "of onboarding. Would a short call be useful?"},
        {"lead": {"who": "Procurement Manager", "where": "Health trust",
                  "why": "Published a tender for patient communication software.",
                  "src": "Tender notice · this week", "score": 88},
         "message": "Saw the patient communication tender. Would a short call before the deadline help?"},
     ),
     "perf": "Patients search close to home and on their phones. Our agents check places, devices and "
             "landing pages daily, and Local Business Radar shows how you compare with every clinic nearby.",
     "faq": (("Do you handle patient data?",
              "No. We work with business contacts and public information, never patient records."),
             ("Can you work for a single clinic?",
              "Yes, for ads and for meetings with partners and suppliers, within one city or several."))},
    {"slug": "real-estate", "name": "Real estate", "short": "Real estate",
     "headline": "Meetings with developers, brokers and the buyers behind them.",
     "lead": "Property moves on news: a new project, an expansion, a new leader. We find developers and "
             "firms at those moments, and run the ads that bring buyers to site visits.",
     "buyers": ("Developers' marketing and sales heads", "Brokerage owners", "Property managers and investors"),
     "plays": ("news-that-opens-a-door", "new-in-the-job", "local-businesses", "lookalikes"),
     "samples": (
        {"lead": {"who": "New Head of Marketing", "where": "Property developer, 400 people",
                  "why": "Started the role 3 weeks ago; was a customer at their last company.",
                  "src": "Job change · 3 weeks ago", "score": 90},
         "message": "Congratulations on the new role. You worked with us at your last company; happy to "
                    "share what we'd look at first here."},
        {"lead": {"who": "Sales Director", "where": "Residential developer, 150 people",
                  "why": "Announced a new 300-home project launching in spring.",
                  "src": "Press release · this week", "score": 87},
         "message": "Congratulations on the new project. The months before launch are when enquiries are "
                    "won. Worth a call about filling the first site visits?"},
        {"lead": {"who": "Owner", "where": "Brokerage, 2 offices",
                  "why": "Well reviewed, but ranks below four rivals for searches in its own area.",
                  "src": "Map listing · checked today", "score": 79},
         "message": "Your reviews beat most of the brokers nearby, but four rank above you locally. Can I "
                    "show you why?"},
     ),
     "perf": "For property, the result that counts is a qualified enquiry or a site visit. Our agents check "
             "places, audiences and landing pages daily so budget follows the projects that sell.",
     "faq": (("Can you run ads for a single project?",
              "Yes. Each project can have its own campaigns, budget and morning message."),
             ("What counts as a result for property ads?",
              "We agree it with you after the audit: usually a qualified enquiry or a booked site visit."))},
    {"slug": "education", "name": "Education", "short": "Education",
     "headline": "Meetings with schools, colleges and universities.",
     "lead": "Education buys on a calendar: tenders, term dates and conferences. We find the people and "
             "the moments, and book you in before the decision is made.",
     "buyers": ("Directors of admissions and marketing", "IT and operations leads", "Heads and principals"),
     "plays": ("tenders-and-rfps", "same-event", "experts-audience", "posting-about-the-problem"),
     "samples": (
        {"lead": {"who": "Director of Admissions", "where": "University, 15,000 students",
                  "why": "Speaking at a higher-education marketing conference next month.",
                  "src": "Event agenda · next month", "score": 82},
         "message": "Saw you're speaking at the conference next month. We'll be there too. Coffee before "
                    "your session?"},
        {"lead": {"who": "Head of IT", "where": "School trust, 12 schools",
                  "why": "Published a tender for network and device support, closing in 3 weeks.",
                  "src": "Tender notice · yesterday", "score": 89},
         "message": "Saw the support tender. Would a short call before the deadline be useful?"},
        {"lead": {"who": "Marketing Director", "where": "Business school",
                  "why": "Posted that international applications fell this year and asked what others changed.",
                  "src": "LinkedIn post · 3 days ago", "score": 85},
         "message": "Read your post about international applications. Where applicants drop off is usually "
                    "findable. Worth comparing notes?"},
     ),
     "perf": "Applicants search and compare for months. Our agents check programmes, places and seasons "
             "daily so spend rises when applicants are deciding and falls when they aren't.",
     "faq": (("Can you plan around our intake dates?",
              "Yes. Seasonality is one of the things our agents check, and plays can follow your calendar."),
             ("Do you contact students?",
              "No. Meetings are with staff and decision makers; ads reach applicants."))},
    {"slug": "ecommerce", "name": "E-commerce and D2C brands", "short": "E-commerce",
     "headline": "More from your ads, and meetings with the partners you want.",
     "lead": "For online brands the ads are the business. Our agents check every product, search term and "
             "audience daily, and our plays find the partners and wholesale buyers you want to meet.",
     "buyers": ("Founders and heads of growth", "Retail and wholesale buyers", "Marketplace and partnership leads"),
     "plays": ("lookalikes", "asking-for-recommendations", "new-in-the-job", "news-that-opens-a-door"),
     "samples": (
        {"lead": {"who": "Head of Growth", "where": "Online furniture retailer, 90 people",
                  "why": "Same size, market and tools as three of your best customers.",
                  "src": "Profile match · today", "score": 80},
         "message": "We work with retailers very like yours on paid search. One question: which channel "
                    "carries the most weight for you right now?"},
        {"lead": {"who": "Buyer", "where": "Department store group",
                  "why": "Posted that they're looking for new sustainable homeware brands for spring.",
                  "src": "LinkedIn post · this week", "score": 88},
         "message": "Saw you're looking for sustainable homeware for spring. Ours fits; can I send the "
                    "range and set up a call?"},
        {"lead": {"who": "Founder", "where": "D2C skincare brand, 15 people",
                  "why": "Asked their network to recommend a performance marketing agency before a launch.",
                  "src": "LinkedIn post · yesterday", "score": 95},
         "message": "Saw you're looking for help before the launch. Happy to share what we'd check first, "
                    "no strings. Would Thursday suit?"},
     ),
     "perf": "Product Analysis shows which products earn their spend across Shopping, Performance Max and "
             "Meta catalogs; the other agents check search terms, audiences and budgets every morning.",
     "faq": (("What counts as a result for e-commerce ads?",
              "Usually revenue or orders at a target return on ad spend, agreed after the audit."),
             ("Do you work with Shopify and other stores?",
              "Yes. We read the ad accounts and their conversion data, whatever the store runs on."))},
)
INDUSTRIES_BY_SLUG = {i["slug"]: i for i in INDUSTRIES}

# The agents behind the work (/agents), in the words of the agents' own pages. The performance-marketing
# agents come from tracker/paid_catalog.py (WORKSPACE) at render time, so a new one appears here by itself.
GTM_AGENTS = (
    ("Lead Finder", "People and companies on LinkedIn, Reddit and tender notices showing they need what a "
                    "client sells, with a message ready."),
    ("People & Signals", "The right people at each target account, and what each account is doing."),
    ("Contact Finder", "The decision makers at a company, with checked contact details."),
    ("Market Radar", "Rivals' moves, new places nearby and an industry's news."),
    ("Job Change Alert", "Buyers and past customers who have just started a new role."),
    ("Event & Conference Intelligence", "The events worth a client's time and budget, with their speakers."),
    ("Website visitors", "The companies reading a client's website, and which pages."),
    ("Local Business Radar", "Every business of one kind in a city, scored and ranked."),
    ("Social Media Intelligence", "A client's social presence, set against their competitors'."),
    ("Thought Leader Intelligence", "A client's leaders' presence, and the PR openings around them."),
)
SEARCH_AGENTS = (
    ("Keyword Finder", "Keyword discovery, scoring and clustering."),
    ("Content briefs", "Briefs built from what already ranks for a search."),
    ("Site health and AI readiness", "What stops a site being found, by search engines and AI answers."),
    ("Answer-engine visibility", "How often AI answers name a client, and what to change."),
    ("Video Studio", "Video ads, made to brief."),
    ("Ads insight", "Yesterday's numbers and what changed, in Slack every morning at 11:30."),
)

# The full comparison (/compare). Columns: the options; rows: (question, one answer per option).
COMPARE_OPTIONS = ("A first sales hire", "A retainer agency", "A pay-per-meeting agency",
                   "A self-serve GTM tool", "Northaxis")
COMPARE_ROWS = (
    ("You pay for", ("Salary, about $108,600 in year one", "Hours, every month",
                     "Each meeting, commonly $75 to $500", "Seats or credits, $49 to $99 a month and up",
                     GTM_FEE + " a month, with the meetings promised")),
    ("Who finds the leads", ("They do, with tools you buy", "The agency", "The agency", "You do, in the tool",
                             "Our agents, every morning")),
    ("Who writes and sends", ("They do", "The agency", "The agency", "You do", "We do, in your name")),
    ("First meetings", ("After months of hiring and ramp", "In weeks", "In weeks",
                        "Once you've set it up and written the messages", "Within the first month")),
    ("If it doesn't work", ("You still pay", "You still pay", "You pay only for meetings booked",
                            "You still pay, and did the work",
                            "Each missing meeting is credited on your next bill")),
    ("Ads included", ("No", "Often, as a separate fee", "No", "No",
                      "Yes, as Performance Marketing, paid on results")),
    ("Fits better when", ("You want someone in the team for years and can manage them",
                          "You want a broad marketing programme more than meetings",
                          "You want meetings only, and a price per meeting suits you",
                          "Someone on your team has time to build plays and write messages",
                          "You want a promised number of meetings for a fixed fee, and ads paid on results")),
)

# Sample leads for the hero and the GTM page: a role and a kind of company, never a real person.
SAMPLE_LEADS = (
    {"who": "Head of Marketing", "where": "80-person HR software company",
     "why": "Posted about rising ad costs and asked how others cut them.",
     "src": "LinkedIn post · 2 days ago", "score": 91},
    {"who": "Operations Director", "where": "Logistics firm, 300 people",
     "why": "Published a tender for a customer-portal rebuild, closing in 3 weeks.",
     "src": "Tender notice · yesterday", "score": 88},
    {"who": "Founder", "where": "Seed-stage fintech, 25 people",
     "why": "Commented on a competitor's post about switching tools.",
     "src": "LinkedIn comment · today", "score": 86, "meeting": "Meeting booked · Thu 11:00"},
)

# What the performance-marketing agents check, grouped as the Performance Marketing page shows them.
PERF_CHECKS = (
    ("Before we touch anything", ("Business research", "Account audit, about 50 checks",
                                  "Keyword research", "Strategy and campaign book")),
    ("Every day", ("Search terms: negatives to add, keywords to bid on", "Ad strength and missing assets",
                   "Places, audiences, devices, days and hours", "Products that earn their spend",
                   "Budget pacing", "One live view of performance")),
    ("Every launch", ("A QA check of the campaign", "Does each landing page keep the ad's promise",
                      "Which experiments have said something")),
    ("Through the year", ("Seasonality, and what to do with budgets next",)),
)

COMPARE = (
    # (option, you pay for, who does the work, first meetings, if it doesn't work)
    ("A first sales hire", "Salary, about $108,600 in year one", "You manage them",
     "After months of hiring and ramp", "You still pay"),
    ("A retainer agency", "Hours, every month", "The agency", "In weeks", "You still pay"),
    ("A self-serve GTM tool", "Seats or credits, $49 to $99 a month and up", "You do",
     "Once you've set it up and written the messages", "You still pay, and did the work"),
    ("Northaxis", GTM_FEE + " a month, meetings promised", "We do", "Within the first month",
     "Each missing meeting is credited on your next bill"),
)

FAQ_MEETINGS = (
    ("What counts as a meeting?",
     "A meeting that takes place with someone who matches the profile we agreed on the call. "
     "A no-show doesn't count."),
    ("What if you book fewer meetings than promised?",
     "Each missing meeting is credited on your next bill, at the monthly fee divided by the number of "
     "meetings promised."),
    ("Whose name do the messages go out in?",
     "Yours. We write in your voice, you approve the messages before anything is sent, and we send them "
     "by email and LinkedIn."),
    ("Where do the leads come from?",
     "From what people do in public: posts, comments, tenders, news and events, plus business data "
     "providers. Every lead comes with a link to the sign that found it."),
    ("Can someone we write to say no?",
     "Yes. Every email carries a one-click opt-out, and nobody is contacted twice."),
    ("Do you guarantee sales?",
     "No. We promise meetings with the right people. Winning the deal is yours."),
)

FAQ_PERFORMANCE = (
    ("How is it priced?",
     "On results. What counts as a result, and the rate, are agreed with each client after the free audit."),
    ("Do you need access to my ad accounts?",
     "Read-only access is enough for the audit. You keep ownership of your accounts at all times."),
    ("Does a person check what the agents suggest?",
     "Yes. The agents find and explain; a person on our team decides and makes every change."),
    ("Which channels do you run?",
     "Google Ads (Search, Shopping and Performance Max) and Meta, plus search beyond ads: keyword "
     "research, content briefs and how often AI answers name you."),
    ("Do you make the ads?",
     "We write the copy, and our Video Studio makes video ads."),
)


# ── The look (static/css/press.css + static/js/press-play.js, shared with the previous site) ──────
# Eight flat shapes on a 100-unit square. The kinetic bands and the footer's shape tiles are drawn
# from them, and press-play.js morphs between them.
SHAPES = {
    "circle": "M50 4a46 46 0 1 1 0 92a46 46 0 1 1 0-92z",
    "star": "M50 2L61 35H98L68 57L79 91L50 70L21 91L32 57L2 35H39Z",
    "square": "M20 6h60a14 14 0 0 1 14 14v60a14 14 0 0 1-14 14H20A14 14 0 0 1 6 80V20A14 14 0 0 1 20 6z",
    "triangle": "M50 6L95 90H5Z",
    "quarter": "M6 94V6a88 88 0 0 1 88 88Z",
    "leaf": "M6 94C6 45 45 6 94 6C94 55 55 94 6 94Z",
    "half": "M4 72a46 46 0 0 1 92 0Z",
    "plus": "M38 6h24v32h32v24H62v32H38V62H6V38h32Z",
}


def _lead_deck(leads):
    """The hero's card deck: the sample leads as colour blocks, and the meeting one of them became."""
    cards = [{"c": c, "k": l["src"].split(" · ")[0], "b": l["who"], "l": l["where"], "s": str(l["score"])}
             for c, l in zip(("orange", "amber", "sky"), leads)]
    booked = leads[-1]
    cards.append({"c": "ink", "k": "Meeting booked", "b": booked["who"], "l": "Thursday, on your calendar", "s": "11:00"})
    return tuple(cards)


LEAD_DECK = _lead_deck(SAMPLE_LEADS)

# The Performance Marketing hero's deck: the findings in the sample Ads insight message.
ADS_DECK = (
    {"c": "sky", "k": "Yesterday", "b": "38 conversions", "l": "Cost per conversion $32.60", "s": "−14%"},
    {"c": "amber", "k": "Search terms", "b": "11 new negatives", "l": "About $96 a week wasted", "s": "$96"},
    {"c": "orange", "k": "Mobile after 9pm", "b": "Costs too much", "l": "Cost per conversion vs the account", "s": "2.1×"},
    {"c": "ink", "k": "Ad strength", "b": "Two ad groups", "l": "Below Good; three headlines suggested", "s": "2"},
)

# One line icon per industry and per group of plays (templates/site/_parts.html draws them).
INDUSTRY_ICONS = {
    "technology-saas": "code", "agencies": "megaphone", "professional-services": "briefcase",
    "it-services": "server", "financial-services": "coins", "healthcare": "heart",
    "real-estate": "home", "education": "cap", "ecommerce": "cart",
}
PLAY_ICONS = {"say": "chat", "do": "bolt", "match": "target"}

# The tickers: (address, words) for each play and each industry.
PLAY_LINKS = tuple(("/plays/" + p["slug"], p["name"]) for p in PLAYS)
INDUSTRY_LINKS = tuple(("/industries/" + i["slug"], i["name"]) for i in INDUSTRIES)
