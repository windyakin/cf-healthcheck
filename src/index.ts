export const Health = {
  OK: "healthy",
  ERROR: "unhealthy",
  FAILED: "dead",
} as const;

export type Health = (typeof Health)[keyof typeof Health] | null;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const targetUrl = env.TARGET_URL;
    const targetHost = new URL(targetUrl).host;
    const kvKey = `endpoint-status--${targetHost.replace(/\./g, '-')}`;
    let currentStatus = await env.STATUS_KV.get(kvKey);
    return new Response(
      `${targetHost} is ${currentStatus || 'unknown'}`,
    );
  },

  async scheduled(event, env, ctx): Promise<void> {
    const targetUrl = env.TARGET_URL;
    const targetHost = new URL(targetUrl).host;

    const kvKey = `endpoint-status--${targetHost.replace(/\./g, '-')}`;

    let previousStatus: Health = await env.STATUS_KV.get(kvKey) as Health;
    let currentStatus = previousStatus;

    let resultMessage: string;

    try {
      const response = await Promise.race([
        fetch(targetUrl),
        // fetch timeout
        new Promise((resolve, reject) => setTimeout(() => reject(new Error('Timeout')), env.TIMEOUT_MS || 5000)),
      ]);
      if (response instanceof Response) {
        currentStatus = response.ok ? Health.OK : Health.ERROR;
        resultMessage = `${response.status} (${response.statusText})`;
      } else {
        throw new Error('ERROR to fetch');
      }
    } catch (error: any) {
      console.error(error);
      currentStatus = Health.FAILED;
      resultMessage = `${error.message}`;
    }

    const slackWebhookUrl = env.SLACK_WEBHOOK_URL;

    if (previousStatus !== currentStatus) {
      if (slackWebhookUrl) {
        await fetch(slackWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: currentStatus == Health.FAILED || currentStatus == Health.ERROR ? `<!channel> ${targetHost} is ${currentStatus}` : undefined,
            attachments: [{
              color: getColor(currentStatus),
              blocks: [
                {
                  type: 'section',
                  text: { type: 'mrkdwn', text: `${getEmoji(currentStatus)} *${targetHost} is ${currentStatus}*` }
                },
                {
                  type: 'section',
                  fields: [{ type: 'mrkdwn', text: `*Target URL*\n${targetUrl}` }, { type: 'mrkdwn', text: `*Result*\n${resultMessage}` }]
                },
                {
                  type: 'context',
                  elements: [
                    { type: 'mrkdwn', text: `<!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} {time_secs}|${new Date().toISOString()}>` }
                  ]
                }
              ]
            }]
          }),
        });
      }

      let nextScheduledTime = null;
      const resetHoursInUTC = parseInt(`${env.RESET_HOURS_IN_UTC}`);
      if (!Number.isNaN(resetHoursInUTC) && (0 <= resetHoursInUTC && resetHoursInUTC <= 23)) {
        nextScheduledTime = new Date();
        nextScheduledTime.setUTCHours(resetHoursInUTC, 0, 0, 0);
      }
      await env.STATUS_KV.put(kvKey, currentStatus, (nextScheduledTime ? { expiration: nextScheduledTime.getTime() / 1000 } : undefined));
    }
    console.log('This is a scheduled event');
  }
} satisfies ExportedHandler<Env>;

export const getColor = function(status: Health): string {
  switch (status) {
    case Health.OK:
      return '#008888';
    case Health.ERROR:
      return '#FF8800';
    case Health.FAILED:
      return '#880000';
  }
  return 'gray';
}

export const getEmoji = function(status: Health): string {
  switch (status) {
    case Health.OK:
      return ':white_check_mark:';
    case Health.ERROR:
      return ':warning:';
    case Health.FAILED:
      return ':x:';
  }
  return ':question:';
}
