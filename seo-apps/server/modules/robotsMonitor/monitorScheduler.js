const cron = require('node-cron');
const monitorStore = require('./monitorStore');
const { runMonitorCheck } = require('./monitorRunner');

let scheduledJob = null;

async function init() {
  const config = await monitorStore.getSlackConfig();
  startScheduler(config);
}

function startScheduler(config) {
  if (scheduledJob) {
    scheduledJob.destroy();
    scheduledJob = null;
  }

  if (!config.scheduleTime || !config.timezone) return;

  const [hour, minute] = config.scheduleTime.split(':');
  if (!hour || !minute) return;

  const cronExpression = `${minute} ${hour} * * *`;

  try {
    scheduledJob = cron.schedule(cronExpression, async () => {
      console.log(`[RobotsMonitor] Scheduled run starting at ${new Date().toISOString()}`);
      try {
        await runMonitorCheck({ triggeredBy: 'scheduler' });
      } catch (err) {
        console.error('[RobotsMonitor] Scheduled run failed:', err.message);
      }
    }, { timezone: config.timezone });

    console.log(`[RobotsMonitor] Scheduler initialised — ${cronExpression} (${config.timezone})`);
  } catch (err) {
    console.error('[RobotsMonitor] Failed to initialise scheduler:', err.message);
  }
}

async function reinitScheduler() {
  const config = await monitorStore.getSlackConfig();
  startScheduler(config);
}

module.exports = { init, reinitScheduler };
