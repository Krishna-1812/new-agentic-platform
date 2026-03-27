const axios = require('axios');

// In-memory daily search counter (resets on server restart or new day)
let dailySearchCount = 0;
let lastResetDate = new Date().toDateString();

function resetIfNewDay() {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    dailySearchCount = 0;
    lastResetDate = today;
  }
}

async function searchGoogle(keyword) {
  resetIfNewDay();

  if (dailySearchCount >= 100) {
    const err = new Error('Daily quota exceeded (100 searches/day limit)');
    err.code = 'QUOTA_EXCEEDED';
    throw err;
  }

  const params = {
    key: process.env.GOOGLE_API_KEY,
    cx: process.env.GOOGLE_CX,
    q: keyword,
    num: 10,
    gl: 'us',
    hl: 'en',
    cr: 'countryUS'
  };

  let response;
  try {
    response = await axios.get('https://www.googleapis.com/customsearch/v1', { params, timeout: 15000 });
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const message = err.response.data?.error?.message || 'Unknown Google API error';
      if (status === 403) {
        throw new Error(`Google API error: ${message}. Check your API key and ensure Custom Search API is enabled.`);
      }
      if (status === 429) {
        const quotaErr = new Error('Daily quota exceeded (100 searches/day limit)');
        quotaErr.code = 'QUOTA_EXCEEDED';
        throw quotaErr;
      }
      throw new Error(`Google API error (${status}): ${message}`);
    }
    throw new Error(`Failed to reach Google API: ${err.message}`);
  }

  dailySearchCount++;

  const items = response.data.items || [];
  const totalResults = parseInt(response.data.searchInformation?.totalResults || '0');

  return {
    results: items.map((item, index) => ({
      position: index + 1,
      title: item.title || '',
      url: item.link || '',
      snippet: item.snippet || '',
      displayUrl: item.displayLink || ''
    })),
    searchCount: dailySearchCount,
    totalResults
  };
}

function getDailyCount() {
  resetIfNewDay();
  return dailySearchCount;
}

module.exports = { searchGoogle, getDailyCount };
