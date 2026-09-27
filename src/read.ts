const MAX_RETRY_DELAY_MS = 30_000;

/** Internal GET-only transport. Never use this to replay inference or writes. */
export async function fetchRead(
  url: string,
  headers?: Record<string, string>,
  retryReads = true,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = headers ? await fetch(url, { headers }) : await fetch(url);
    if (!retryReads || ![429, 502, 503].includes(response.status) || attempt >= 2) {
      return response;
    }
    const retryAfter = response.headers.get('Retry-After')?.trim() ?? '';
    let serverDelay = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 0;
    // Date.parse also accepts bare numbers/decimals; only try HTTP-style dates.
    if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*[ ,]/.test(retryAfter)) {
      // asctime HTTP-dates omit GMT but still represent UTC, not local time.
      const date = /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/.test(retryAfter)
        ? `${retryAfter} GMT`
        : retryAfter;
      const timestamp = Date.parse(date);
      if (Number.isFinite(timestamp)) serverDelay = Math.max(0, timestamp - Date.now());
    }
    // A longer server cooldown ends automatic retries, rather than retrying early.
    if (serverDelay > MAX_RETRY_DELAY_MS) return response;
    const backoff = Math.floor(250 * 2 ** attempt * (1 + Math.random()));
    const delay = Math.max(backoff, serverDelay);
    // Release the failed response's connection without parsing an HTML error page.
    await response.body?.cancel().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}
