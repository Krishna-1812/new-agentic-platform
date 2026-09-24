const COUNTRY_TO_DATABASE = {
  'Afghanistan': 'af', 'Albania': 'al', 'Algeria': 'dz', 'Argentina': 'ar',
  'Australia': 'au', 'Austria': 'at', 'Azerbaijan': 'az', 'Bahrain': 'bh',
  'Bangladesh': 'bd', 'Belarus': 'by', 'Belgium': 'be', 'Bolivia': 'bo',
  'Bosnia and Herzegovina': 'ba', 'Brazil': 'br', 'Bulgaria': 'bg',
  'Cambodia': 'kh', 'Canada': 'ca', 'Chile': 'cl', 'China': 'cn',
  'Colombia': 'co', 'Costa Rica': 'cr', 'Croatia': 'hr', 'Cyprus': 'cy',
  'Czech Republic': 'cz', 'Denmark': 'dk', 'Dominican Republic': 'do',
  'Ecuador': 'ec', 'Egypt': 'eg', 'El Salvador': 'sv', 'Estonia': 'ee',
  'Finland': 'fi', 'France': 'fr', 'Georgia': 'ge', 'Germany': 'de',
  'Ghana': 'gh', 'Greece': 'gr', 'Guatemala': 'gt', 'Honduras': 'hn',
  'Hong Kong': 'hk', 'Hungary': 'hu', 'India': 'in', 'Indonesia': 'id',
  'Ireland': 'ie', 'Israel': 'il', 'Italy': 'it', 'Jamaica': 'jm',
  'Japan': 'jp', 'Jordan': 'jo', 'Kazakhstan': 'kz', 'Kenya': 'ke',
  'Kuwait': 'kw', 'Latvia': 'lv', 'Lebanon': 'lb', 'Lithuania': 'lt',
  'Luxembourg': 'lu', 'Malaysia': 'my', 'Malta': 'mt', 'Mexico': 'mx',
  'Moldova': 'md', 'Morocco': 'ma', 'Netherlands': 'nl', 'New Zealand': 'nz',
  'Nicaragua': 'ni', 'Nigeria': 'ng', 'Norway': 'no', 'Oman': 'om',
  'Pakistan': 'pk', 'Panama': 'pa', 'Paraguay': 'py', 'Peru': 'pe',
  'Philippines': 'ph', 'Poland': 'pl', 'Portugal': 'pt', 'Qatar': 'qa',
  'Romania': 'ro', 'Russia': 'ru', 'Saudi Arabia': 'sa', 'Serbia': 'rs',
  'Singapore': 'sg', 'Slovakia': 'sk', 'Slovenia': 'si', 'South Africa': 'za',
  'South Korea': 'kr', 'Spain': 'es', 'Sri Lanka': 'lk', 'Sweden': 'se',
  'Switzerland': 'ch', 'Taiwan': 'tw', 'Thailand': 'th', 'Trinidad and Tobago': 'tt',
  'Tunisia': 'tn', 'Turkey': 'tr', 'Ukraine': 'ua', 'United Arab Emirates': 'ae',
  'United Kingdom': 'uk', 'United States': 'us', 'Uruguay': 'uy',
  'Venezuela': 've', 'Vietnam': 'vn',
};

function getDatabase(country) {
  if (!country) return 'us';
  const direct = COUNTRY_TO_DATABASE[country];
  if (direct) return direct;
  const lower = country.toLowerCase();
  const match = Object.entries(COUNTRY_TO_DATABASE).find(
    ([k]) => k.toLowerCase() === lower
  );
  return match ? match[1] : 'us';
}

const COUNTRY_LIST = Object.keys(COUNTRY_TO_DATABASE).sort();

module.exports = { getDatabase, COUNTRY_LIST };
