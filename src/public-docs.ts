import { evaluationInputJsonSchema } from "./domain";

const evaluationRequestUrl = "https://github.com/detroxryo/earnsignal/issues/new?template=evaluation-request.yml";

export const PUBLIC_DOCS_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="EarnSignal is an evidence-first API for evaluating legitimate Web3 earning opportunities without speculation or automatic wallet signing.">
<title>EarnSignal API</title>
<style>:root{color-scheme:dark;--bg:#07100d;--panel:#0f1c17;--line:#244237;--ink:#f0f8f3;--muted:#a1b8ab;--green:#a8f07c;--cyan:#75e6cc;--amber:#f5c36d}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% 0,#163b2c 0,transparent 35%),var(--bg);color:var(--ink);font:16px/1.6 system-ui,sans-serif}a{color:var(--cyan)}.shell{width:min(1080px,calc(100% - 32px));margin:auto}header{display:flex;justify-content:space-between;align-items:center;padding:24px 0;border-bottom:1px solid var(--line)}.brand{font-weight:800;letter-spacing:.08em}.badge{border:1px solid var(--line);border-radius:999px;padding:5px 10px;color:var(--muted);font-size:13px}.hero{padding:72px 0 48px;max-width:820px}h1{font-size:clamp(40px,8vw,76px);line-height:1.02;letter-spacing:-.055em;margin:0 0 24px}.lead{font-size:clamp(18px,3vw,24px);color:var(--muted);max-width:760px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}.button{display:inline-block;padding:11px 16px;border-radius:9px;border:1px solid var(--line);text-decoration:none;font-weight:750}.button.primary{background:var(--green);border-color:var(--green);color:#10200e}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.card{background:color-mix(in srgb,var(--panel) 92%,transparent);border:1px solid var(--line);border-radius:14px;padding:20px}.card h2{font-size:15px;margin:0 0 8px;color:var(--green)}.card p{color:var(--muted);margin:0}.method{font:12px ui-monospace,monospace;color:var(--cyan);margin-right:8px}.price{color:var(--amber);font-weight:800}.sample{margin:30px 0;background:#050a08;border:1px solid var(--line);border-radius:14px;padding:20px;overflow:auto}.sample pre{margin:0;white-space:pre-wrap;font:13px/1.55 ui-monospace,monospace;color:#d8e8de}.status{margin:38px 0;padding:18px 20px;border-left:3px solid var(--amber);background:var(--panel);color:var(--muted)}footer{margin-top:60px;padding:28px 0 48px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}@media(max-width:760px){.grid{grid-template-columns:1fr}.hero{padding-top:48px}}</style></head>
<body><div class="shell"><header><div class="brand">EARNSIGNAL</div><div class="badge" id="service">checking production</div></header>
<main><section class="hero"><h1>Evidence before execution.</h1><p class="lead">Deterministic scoring for caller-supplied facts about Web3 bounties, grants, paid tests, and agent work. The API never trades or signs a wallet transaction.</p>
<div class="actions"><a class="button primary" href="${evaluationRequestUrl}">Request a pilot evaluation</a><a class="button" href="/openapi.json">OpenAPI</a><a class="button" href="/llms.txt">llms.txt</a><a class="button" href="https://github.com/detroxryo/earnsignal">Source</a></div></section>
<section class="grid"><article class="card"><h2><span class="method">POST</span>/v1/evaluate/preview</h2><p>Free score range, expected net value, and deterministic hard-risk gates.</p></article><article class="card"><h2><span class="method">POST</span>/v1/evaluate</h2><p><span class="price">$0.10 USDC</span> full evidence, EV, bilingual rationale, and next action when payments are active.</p></article><article class="card"><h2><span class="method">POST</span>/v1/evaluate/full</h2><p><span class="price">$5 USDC</span> full evaluation plus a safety-constrained implementation plan.</p></article></section>
<div class="status" id="status">The preview does not fetch the official URL or infer omitted risks. Supply every known hard-risk flag, and do not send funds unless production health reports <code>paymentsActive: true</code>.</div>
<section class="sample"><pre>curl -X POST https://earnsignal.detroxryo.workers.dev/v1/evaluate/preview \
  -H 'content-type: application/json' \
  -d '{
    "title":"Example AI documentation bounty",
    "source":"USER",
    "officialUrl":"https://example.com/bounty",
    "rewardUsd":100,
    "successProbability":0.3,
    "timeHours":3,
    "payoutEvidence":0.8,
    "reputation":0.8,
    "capitalSafety":1,
    "skillFit":0.9,
    "deadlineFit":1,
    "competitionLevel":0.4,
    "repeatability":0.7,
    "technicalDifficulty":"MEDIUM",
    "hardRisks":[],
    "evidence":["Official scope and payout terms verified"]
  }'</pre></section></main>
<footer>Scores are deterministic. AI may summarize evidence, but it cannot change safety gates, submit identity-bound work, or approve transactions.</footer></div>
<script>Promise.all([fetch('/health').then(r=>r.json()),fetch('/v1/opportunities/top?limit=20').then(r=>r.json())]).then(([h,o])=>{document.querySelector('#service').textContent=h.ok?'production online':'production degraded';const n=Array.isArray(o.opportunities)?o.opportunities.length:0;document.querySelector('#status').textContent=h.paymentsActive?'Payment prerequisites are configured and the activation flag is enabled. Verify the returned 402 challenge before paying. '+n+' executable public opportunities are currently indexed.':'Pilot mode: paid routes are not accepting funds. The preview scores caller-supplied facts and does not infer omitted risks. '+n+' executable public opportunities are currently indexed; request a pilot evaluation on GitHub.'}).catch(()=>{document.querySelector('#service').textContent='status unavailable'})</script></body></html>`;

export const LLMS_TEXT = `# EarnSignal

> Evidence-first Web3 income opportunity evaluation API. EarnSignal applies deterministic hard gates to risks supplied by the caller and risks derivable from submitted cost, reputation, payout, and deadline fields. It does not fetch the official URL or infer omitted risks.

Production: https://earnsignal.detroxryo.workers.dev
Human documentation: /docs
Machine schema: /openapi.json
Health and payment activation: /health
Public executable candidates: GET /v1/opportunities/top
Free deterministic preview: POST /v1/evaluate/preview
Full x402 evaluation: POST /v1/evaluate (0.10 USDC when paymentsActive is true)
Full x402 evaluation plus implementation plan: POST /v1/evaluate/full (5 USDC when paymentsActive is true)
Non-betting fan experience: GET /matchpulse

Never send funds unless /health returns paymentsActive=true and the x402 challenge matches the documented Solana network, USDC asset, amount, and receiver. A self-payment is not counted as revenue.
`;

export function buildOpenApi(baseUrl: string): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "EarnSignal API",
      version: "0.1.0",
      description: "Evidence-first, deterministic evaluation of legitimate Web3 earning opportunities.",
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/health": { get: { summary: "Service and payment activation status", responses: { "200": { description: "Healthy" }, "503": { description: "Database unavailable" } } } },
      "/v1/opportunities/top": { get: { summary: "Public low-risk opportunities", responses: { "200": { description: "Executable opportunities" } } } },
      "/v1/evaluate/preview": {
        post: {
          summary: "Free deterministic score preview",
          requestBody: { required: true, content: { "application/json": { schema: evaluationInputJsonSchema } } },
          responses: { "200": { description: "Score range and hard risks" }, "400": { description: "Invalid input" } },
        },
      },
      "/v1/evaluate": {
        post: {
          summary: "Full x402 opportunity evaluation",
          description: "Costs 0.10 USDC only when /health reports paymentsActive=true. Input facts and hard risks are caller-supplied and are not independently fetched.",
          requestBody: { required: true, content: { "application/json": { schema: evaluationInputJsonSchema } } },
          responses: { "200": { description: "Full evaluation" }, "400": { description: "Invalid input" }, "402": { description: "x402 payment required" }, "503": { description: "Payments are not active" } },
        },
      },
      "/v1/evaluate/full": {
        post: {
          summary: "Full x402 evaluation and implementation plan",
          description: "Costs 5 USDC only when /health reports paymentsActive=true. Input facts and hard risks are caller-supplied and are not independently fetched.",
          requestBody: { required: true, content: { "application/json": { schema: evaluationInputJsonSchema } } },
          responses: { "200": { description: "Evaluation and plan" }, "400": { description: "Invalid input" }, "402": { description: "x402 payment required" }, "503": { description: "Payments are not active" } },
        },
      },
    },
  };
}
