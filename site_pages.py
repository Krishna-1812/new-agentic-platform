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
    ("/how-it-works", "How it works"),
    ("/pricing", "Pricing"),
)

# The buying signs we watch for, each a play our agents run today. Hiring signals are off on purpose.
PLAYS = (
    {"slug": "posting-about-the-problem", "name": "Posting about the problem",
     "sign": "A LinkedIn post that names the problem you solve.", "agent": "Lead Finder"},
    {"slug": "rivals-audience", "name": "A rival's audience",
     "sign": "People commenting on a competitor's posts.", "agent": "Lead Finder"},
    {"slug": "experts-audience", "name": "An expert's audience",
     "sign": "People commenting on an industry expert's posts.", "agent": "Lead Finder"},
    {"slug": "asking-for-recommendations", "name": "Asking for recommendations",
     "sign": "“Can anyone recommend…” posts and Reddit threads.", "agent": "Lead Finder"},
    {"slug": "tenders-and-rfps", "name": "Tenders and RFPs",
     "sign": "A published request for proposals in your field.", "agent": "Lead Finder"},
    {"slug": "news-that-opens-a-door", "name": "News that opens a door",
     "sign": "Funding, a launch, an expansion or a new office.", "agent": "Market Radar"},
    {"slug": "new-in-the-job", "name": "New in the job",
     "sign": "A buyer who has just started a role.", "agent": "Job Change Alert"},
    {"slug": "visitors-on-your-site", "name": "Visitors on your site",
     "sign": "Companies reading your pricing or product pages.", "agent": "Website visitors"},
    {"slug": "lookalikes", "name": "Lookalikes of your best customers",
     "sign": "Companies and roles that match your best accounts.", "agent": "Lead Finder"},
    {"slug": "several-signs-at-once", "name": "Several signs at once",
     "sign": "Two or more signs at one company in a short window.", "agent": "People & Signals"},
    {"slug": "same-event", "name": "Going to the same event",
     "sign": "Speakers and attendees of events in your market.", "agent": "Event & Conference Intelligence"},
    {"slug": "local-businesses", "name": "Local businesses like your customers",
     "sign": "Every business of one type in a city, scored.", "agent": "Local Business Radar"},
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
