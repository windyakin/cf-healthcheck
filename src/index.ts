export const Health = {
  OK: "healthy",
  ERROR: "unhealthy",
  FAILED: "dead",
} as const;

export type Health = (typeof Health)[keyof typeof Health] | null;

export const TIMEOUT_ERROR = 'Timeout';

// Fetch a URL, rejecting with a Timeout error if it does not respond in time.
export const fetchWithTimeout = async function(
  url: string,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetcher(url),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(TIMEOUT_ERROR)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

// Fetch a URL, retrying up to `maxRetries` extra times when it times out.
// Non-timeout errors are thrown immediately without retrying.
export const fetchWithRetry = async function(
  url: string,
  timeoutMs: number,
  maxRetries: number,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchWithTimeout(url, timeoutMs, fetcher);
    } catch (error: any) {
      lastError = error;
      if (error?.message !== TIMEOUT_ERROR) {
        throw error;
      }
      console.warn(`Timeout fetching ${url} (attempt ${attempt + 1}/${maxRetries + 1})`);
    }
  }
  throw lastError;
}

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

    const timeoutMs = env.TIMEOUT_MS || 5000;
    const maxRetries = Math.max(0, parseInt(`${env.RETRY_COUNT}`) || 0);

    try {
      const response = await fetchWithRetry(targetUrl, timeoutMs, maxRetries);
      currentStatus = response.ok ? Health.OK : Health.ERROR;
      resultMessage = `${response.status} (${response.statusText})`;
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
        nextScheduledTime.setDate(nextScheduledTime.getDate() + 1);
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
