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
  // One Bento hue each, so a competitor reads the same colour on every chart:
  // sky, lime, clay. (Tailwind's indigo/lime/orange scales are remapped to
  // those hues in tailwind.config.js.)
  { domain: 'inspireaesthetics.com', name: 'Inspire Aesthetics', color: '#5AA9E6', bgColor: 'bg-indigo-50', textColor: 'text-indigo-700', borderColor: 'border-indigo-200' },
  { domain: 'drdanamd.com',          name: 'Dr. Dana MD',        color: '#C6F24E', bgColor: 'bg-lime-50',   textColor: 'text-lime-700',   borderColor: 'border-lime-200'   },
  { domain: 'sonobello.com',         name: 'Sono Bello',         color: '#E8663D', bgColor: 'bg-orange-50', textColor: 'text-orange-700', borderColor: 'border-orange-200' },
];

export const FORMAT_COLORS: Record<string, string> = {
  image: '#C6F24E',
  text:  '#5AA9E6',
  video: '#EFE9DC',
};

export const COMPETITOR_COLORS: Record<string, string> = {
  'inspireaesthetics.com': '#5AA9E6',
  'drdanamd.com':          '#C6F24E',
  'sonobello.com':         '#E8663D',
};
