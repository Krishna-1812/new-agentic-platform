const RULES = [
  { type: 'homepage',  test: p => p === '/' || p === '' },
  { type: 'blog',      test: p => /\/(blog|news|articles|post|posts)\//i.test(p) },
  { type: 'service',   test: p => /\/(service|services|treatment|treatments|procedure)\//i.test(p) },
  { type: 'location',  test: p => /\/(location|locations|office|offices|clinic|clinics)\//i.test(p) },
  { type: 'doctor',    test: p => /\/(doctor|doctors|provider|providers|team|staff|dentist)\//i.test(p) },
  { type: 'static',    test: p => /\/(about|about-us|contact|faq|privacy|terms)\//i.test(p) },
  { type: 'taxonomy',  test: p => /\/(category|tag|author)\//i.test(p) },
];

function classify(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  for (const rule of RULES) {
    if (rule.test(pathname)) return rule.type;
  }
  return 'other';
}

function classifyAndSample(urls, domainUrl) {
  const groups = {};
  for (const url of urls) {
    const type = classify(url);
    if (!groups[type]) groups[type] = [];
    groups[type].push(url);
  }

  // Sort each group by ascending path length (shortest = cleanest representative)
  for (const type of Object.keys(groups)) {
    groups[type].sort((a, b) => a.length - b.length);
  }

  // If more than 10 groups, keep the 10 most populous
  let types = Object.keys(groups);
  if (types.length > 10) {
    types = types.sort((a, b) => groups[b].length - groups[a].length).slice(0, 10);
  }

  const result = [];
  for (const type of types) {
    result.push({ url: groups[type][0], pageType: type });
  }

  // Homepage guarantee: always include homepage
  const hasHomepage = result.some(r => r.pageType === 'homepage');
  if (!hasHomepage && domainUrl) {
    const base = domainUrl.replace(/\/$/, '') + '/';
    // Remove an 'other' entry if at cap to make room
    if (result.length >= 10) {
      const otherIdx = result.findIndex(r => r.pageType === 'other');
      if (otherIdx !== -1) result.splice(otherIdx, 1);
      else result.pop();
    }
    result.unshift({ url: base, pageType: 'homepage' });
  }

  return result.slice(0, 10);
}

module.exports = { classifyAndSample };
