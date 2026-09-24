export interface Ad {
  Domain: string;
  "Advertiser Name": string;
  "Advertiser ID": string;
  "Creative ID": string;
  Format: string;
  Platform: string;
  Headline: string;
  Description: string;
  "Full Ad Text": string;
  CTA: string;
  "Destination URL": string;
  "Landing Page": string;
  "Image URLs": string;
  "Video URLs": string;
  "Thumbnail URLs": string;
  "Logo URLs": string;
  "Regions Served": string;
  "Impression Data": string;
  "First Shown": string;
  "Last Shown": string;
  Language: string;
  Status: string;
  "Messaging Angle": string;
  Offer: string;
  "Product Category": string;
  Keywords: string;
  "Value Proposition": string;
  "Social Profiles": string;
  "Website Summary": string;
  Services: string;
  "Pricing Model": string;
  "Audience Type": string;
  Timestamp: string;
}

export type AdFormat = 'image' | 'text' | 'video' | 'all';
export type TabId = 'insights' | 'overview' | 'gallery' | 'competitors' | 'creative';

/** Cross-tab navigation params — any subset can be passed */
export interface NavParams {
  tab?: TabId;
  domain?: string;      // gallery domain filter
  format?: string;      // gallery format filter
  search?: string;      // gallery search text
  competitor?: string;  // active competitor domain in Competitors tab
}
export type NavFn = (p: NavParams) => void;

export interface Competitor {
  domain: string;
  name: string;
  color: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

export const COMPETITORS: Competitor[] = [
  // One Outcomes block colour each, so a competitor reads the same colour on
  // every chart: sky, amber, orange. (The Tailwind families are laid out in
  // tailwind.config.js.)
  { domain: 'inspireaesthetics.com', name: 'Inspire Aesthetics', color: '#8CCBFF', bgColor: 'bg-sky-50',    textColor: 'text-sky-700',    borderColor: 'border-sky-200'    },
  { domain: 'drdanamd.com',          name: 'Dr. Dana MD',        color: '#FFB500', bgColor: 'bg-amber-50',  textColor: 'text-amber-700',  borderColor: 'border-amber-200'  },
  { domain: 'sonobello.com',         name: 'Sono Bello',         color: '#FF6022', bgColor: 'bg-orange-50', textColor: 'text-orange-700', borderColor: 'border-orange-200' },
];

export const FORMAT_COLORS: Record<string, string> = {
  image: '#FF6022',
  text:  '#8CCBFF',
  video: '#FFB500',
};

export const COMPETITOR_COLORS: Record<string, string> = {
  'inspireaesthetics.com': '#8CCBFF',
  'drdanamd.com':          '#FFB500',
  'sonobello.com':         '#FF6022',
};

// Text-safe shades. The block colours above are fills; set as text on white
// they fail (sky 1.7:1, amber 1.8:1, orange 3.0:1). Anything that paints a
// competitor or signal colour AS TEXT goes through tx().
const TEXT_SAFE: Record<string, string> = {
  '#8CCBFF': '#1D65A6', '#A8D8FF': '#1D65A6',
  '#FFB500': '#8A5A00',
  '#FF6022': '#B83C0C', '#FF7A45': '#B83C0C',
  '#FF3B30': '#C8261B', '#FF5A50': '#C8261B',
};
export const tx = (c: string): string => TEXT_SAFE[(c || '').toUpperCase()] ?? c;
