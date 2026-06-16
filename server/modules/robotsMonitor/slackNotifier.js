const axios = require('axios');

function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

function sitemapFootnote(domain) {
  if (domain.sitemapStatus === 'found') return 'Sitemap: found';
  if (domain.sitemapStatus === 'not-found') return 'Sitemap: not found — homepage only';
  return `Sitemap error: ${domain.error || 'unknown'}`;
}

function buildClientMessage(clientResult, runResult) {
  const { clientName, domains } = clientResult;
  const date = formatDate(runResult.startedAt);
  const triggerLabel = runResult.triggeredBy === 'manual' ? 'Manual' : 'Scheduled';

  const allIssues = domains.flatMap(d => d.issues || []);
  const hasIssues = allIssues.length > 0;

  const prodIssues = domains.flatMap(d =>
    (d.issues || []).filter(i => i.issueType === 'noindex-on-production').map(i => ({ ...i, domainUrl: d.url }))
  );
  const stagingIssues = domains.flatMap(d =>
    (d.issues || []).filter(i => i.issueType === 'noindex-missing-on-staging').map(i => ({ ...i, domainUrl: d.url }))
  );

  const totalPages = domains.reduce((s, d) => s + (d.pagesChecked || []).length, 0);
  const durationSec = Math.round((runResult.durationMs || 0) / 1000);
  const sitemapNotes = domains.map(sitemapFootnote).join(' | ');

  const headerEmoji = hasIssues ? '🔴' : '✅';
  const blocks = [];

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `${headerEmoji} Index Monitor — ${date} · ${triggerLabel}`,
      emoji: true,
    },
  });

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*Client: ${clientName}*` },
  });

  blocks.push({ type: 'divider' });

  if (prodIssues.length > 0) {
    const lines = prodIssues.map(i => {
      let line = `• <${i.url}|${i.url}> — noindex via *${i.signal || 'unknown'}*`;
      if (i.finalUrl && i.finalUrl !== i.url) line += `\n  ↳ Redirected to: ${i.finalUrl}`;
      return line;
    }).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*🔴 PRODUCTION ISSUES (noindex found)*\n${lines}` },
    });
  }

  if (stagingIssues.length > 0) {
    const lines = stagingIssues.map(i => `• <${i.url}|${i.url}> — no noindex found`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*🟡 STAGING ISSUES (noindex missing)*\n${lines}` },
    });
  }

  if (!hasIssues) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '✅ All pages indexable as expected — no issues detected.' },
    });
  }

  blocks.push({ type: 'divider' });

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Run: \`${runResult.runId}\` · ${totalPages} pages · ${durationSec}s · ${sitemapNotes}`,
    }],
  });

  return {
    text: `${headerEmoji} Index Monitor — ${date} · ${triggerLabel} | Client: ${clientName}`,
    blocks,
  };
}

async function sendRunAlert(runResult, slackConfig) {
  if (!slackConfig.enabled) return { sent: false, error: null };
  if (!slackConfig.webhookUrl) return { sent: false, error: 'No webhook URL configured' };

  const results = [];
  for (const clientResult of (runResult.clients || [])) {
    const payload = buildClientMessage(clientResult, runResult);
    try {
      await axios.post(slackConfig.webhookUrl, payload, { timeout: 10000 });
      results.push({ clientId: clientResult.clientId, sent: true });
    } catch (err) {
      console.error(`[RobotsMonitor] Slack send failed for client ${clientResult.clientId}:`, err.message);
      results.push({ clientId: clientResult.clientId, sent: false, error: err.message });
    }
  }

  const allSent = results.every(r => r.sent);
  return { sent: allSent, error: allSent ? null : 'One or more Slack messages failed — see server logs' };
}

async function sendTestMessage(slackConfig) {
  if (!slackConfig.webhookUrl) throw new Error('No webhook URL configured');
  const payload = {
    text: '✅ RobotsMonitor test message — your webhook is working.',
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: '✅ *RobotsMonitor test message* — your Slack webhook is configured correctly.' },
    }],
  };
  await axios.post(slackConfig.webhookUrl, payload, { timeout: 10000 });
}

module.exports = { sendRunAlert, sendTestMessage };
