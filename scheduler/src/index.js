const REPORT_ENDPOINT = "https://myapp.ahui3c.com/api/cron/daily-review-email";

async function requestDailyReport(env, trigger) {
  if (!env.DAILY_REVIEW_CRON_SECRET) {
    throw new Error("DAILY_REVIEW_CRON_SECRET is not configured");
  }

  const response = await fetch(REPORT_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.DAILY_REVIEW_CRON_SECRET}`,
      "content-type": "application/json",
      "user-agent": "ytlang-cloudflare-scheduler/1.0"
    }
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Daily report request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  console.log(JSON.stringify({
    event: "daily-review-email",
    trigger,
    status: response.status,
    result: body.slice(0, 1000)
  }));
  return new Response(body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "application/json" }
  });
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(requestDailyReport(env, controller.cron));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, scheduler: "ytlang-daily-review" });
    }
    return new Response("Not found", { status: 404 });
  }
};
