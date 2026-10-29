# Nimbus

Nimbus is a demo project: a small landing page for a tiered AI chat product
(Free / Pro / Enterprise), built to explore how LaunchDarkly's feature-flag,
targeting, and experimentation tools fit into a real tiered-SaaS pattern. It
is not a real product — there's no billing and no real user accounts, just
three fixed demo logins.

A deeper look at the architecture and the reasoning behind its design
decisions lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), including
diagrams of each data flow.

## Quick start (with an existing `.env.local`)

If you already have a `.env.local` for a LaunchDarkly environment where the
flags, targeting, and experiment below are configured, this is all it takes.
Starting from nothing? Skip to "Re-creating this independently" below.

```bash
git clone https://github.com/hiddenintel-rc/nimbus-ai-sample.git
cd nimbus-ai-sample
npm install
```

Put the `.env.local` file in the project root (same folder as
`package.json`), then:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in as
`demo-free@nimbus.app`, `demo-pro@nimbus.app` or
`demo-enterprise@nimbus.app`. All three share the password in
`DEMO_PASSWORD`, which isn't published in this repo or on the login page,
so the chat — and the hardware behind it — stays limited to people you
share it with. Keep `.env.local` private; `.gitignore` only stops you from
committing it by accident.

**What to try:**
- Log in as each account, open the model menu next to the chat's toggles,
  and send a message. Each reply shows a "served by …" caption naming the
  model and tier config used. Each account gets its own plan's menu: Free
  the 4B alone, Pro that plus the long-context 4B, Enterprise all four.
- With the "Memory" badge on, tell it "My name is Alex, remember that,"
  then ask "what's my name?" — it should recall it across turns. Memory is
  a paid feature, so use `demo-pro` or `demo-enterprise`; free accounts
  answer every message as if it were the first.
- As a free-tier account, the "Upgrade to Pro" button fires the conversion
  metric behind the Experimentation setup — no real checkout happens.
- The assistant's tone/personality and temperature come from a LaunchDarkly
  AI Config (`nimbus-assistant`), fetched fresh on every message — editing
  the prompt in the LD dashboard changes the very next reply, no redeploy.
- The logo in the header is gated behind `new-logo` — flip it off in LD and
  it reverts live to the plain text wordmark, no reload. A second example of
  the release/remediate pattern, this time for a brand rollout instead of a
  product feature.
- The "Compare plans" block between the headline and the chat is released
  behind `show-plan-comparison`, and each account sees it for a different
  reason: `demo-pro` by individual target, `demo-free` by a `tier` rule, and
  logged-out visitors through a 20% percentage rollout, each browser
  bucketed on its own key.

If something doesn't work, jump to "Re-creating this independently" below —
the same steps explain what each flag is doing, which is useful even if you
didn't set it up yourself.

## What's implemented

- A feature flag that can be released, toggled live with no page reload,
  and rolled back via a remote trigger
- Individual and rule-based targeting on one landing-page component: the
  "Compare plans" block (`show-plan-comparison`) goes to one named account
  by individual target, to free accounts by a rule on the `tier` attribute,
  and to a percentage of logged-out visitors, each bucketed on its own key
- Rules on that same server-built context decide which models, history
  window and message allowance each plan gets (`chat-tier-config`), and
  individual targets on the `demo-free` key switch image generation and
  memory off for that one login
- An experiment on that same component flag: does seeing "Compare plans"
  make free users click Upgrade more? A conversion metric, an experiment on
  the free-tier rule, and a traffic simulator for sample data
- A prompt experiment on the AI Config, scored two ways at once: 👍 / 👎
  on each reply (tied to the exact run that wrote it), and an LLM judge that
  rates replies; tokens and latency per variation are on the config's
  Monitoring tab
- Login gating, with the actual enforcement server-side, not just a hidden
  UI element
- A model menu per tier: Free gets the 4B, Pro adds the long-context 4B,
  and Enterprise adds Coder-30B and Qwen 3.8. Higher-tier models are shown
  greyed out, and the server rejects any model the tier doesn't allow
- A LaunchDarkly AI Config managing the assistant's prompt, temperature and
  default model (within what the tier allows), all live-editable with no
  redeploy
- A flag-gated "Generate an image" toggle. When it's on, that turn's prompt
  is sent to Open WebUI's image API instead of the chat model, and the
  picture is shown in the thread

There are two deployments, on purpose:

- **Self-hosted** (Docker, alongside the model backend) — the fully working
  one. Chat, web search, and image generation all function, because the
  inference call never leaves the host. See "Self-hosting with Docker" below.
- **[nimbus-ai-sample.vercel.app](https://nimbus-ai-sample.vercel.app/)** —
  the landing page, login, and live flag badges work, but **chat doesn't**:
  Cloudflare challenges Vercel's requests to the backend before they arrive.
  Kept as proof the app deploys cleanly to a standard platform. See
  "Deploying to Vercel" below.

Both point at the same LaunchDarkly environment, so a flag flipped in the
dashboard changes both at once. Not yet built: third-party integrations. See
`docs/ARCHITECTURE.md` for the full status and the reasoning behind what's
here.

## Assumptions about your environment

The setup instructions below assume the following. Where one doesn't hold
for you, the note says what changes.

- **Node.js 20 or newer and npm.** Built and tested on Node 22.
- **Your own LaunchDarkly account**, with one project and environment. A
  free trial is enough. The flags, AI Config and metric are **not** created
  by the app: you create them by hand with the exact keys given below, and
  each flag the browser reads needs "Available on client-side SDKs" turned on.
- **An OpenAI-compatible chat backend you control.** The model IDs in this
  repo's flag variations belong to one self-hosted setup: Open WebUI in front
  of a llama.cpp router. On any other backend, replace them with model IDs
  that exist there.
  - **Groq** is the no-infrastructure alternative. Its code path is
    implemented and type-checked but has not been run end to end, so treat
    it as the least-proven route.
  - **Web search and image generation need Open WebUI specifically**, with
    Tavily and ComfyUI configured in it. On any other backend those toggles
    appear but do nothing.
- **Outbound HTTPS to `*.launchdarkly.com`** from the server (flag stream,
  events) and from each visitor's browser (the client SDK connects directly).
- **Local development is served at `http://localhost:3000` with no proxy in
  front.** Behind a reverse proxy or tunnel, set `AUTH_TRUST_HOST=true`.
- **The Docker path assumes Open WebUI runs in Docker on the same host**, so
  the app can join its network, and that you publish the app through
  something like a Cloudflare Tunnel. Vercel works for everything except
  chat against a backend behind Cloudflare's bot protection.
- **A single-GPU backend loads one model at a time.** The first reply after
  switching models waits for a load, from a few seconds to about 30.
- **No database.** Three fixed demo accounts share one password
  (`DEMO_PASSWORD`). Nothing is persisted, so the free plan's message
  allowance is per conversation and resets on reload.
- **Browsers allow localStorage.** Logged-out visitors get a random
  LaunchDarkly key saved there. Where storage is blocked, the visitor gets a
  new key, and so a new context, on every page load.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app locally |
| `npm run build` | Production build (also type-checks) |
| `npm run simulate:experiment [count]` | Generate synthetic free-tier traffic against the Compare plans experiment (default 4,000 sessions) |
| `npm run simulate:ai-experiment [count]` | Generate synthetic chat metrics against the AI Config prompt experiment (default 4,000 sessions) |

---

## Self-hosting with Docker

This is the deployment where everything works. The app runs on the same host
as Open WebUI and reaches it over the local Docker network, so the inference
call never passes through Cloudflare — which is exactly what breaks the
Vercel deployment (see below).

```bash
docker compose --env-file .env.local up -d --build
```

The `--env-file` is not optional. Compose substitutes `${...}` in the compose
file from the shell or a `.env` file — *not* from the `env_file:` key, which
only sets runtime variables inside the container. Without it the LaunchDarkly
client ID resolves to an empty string and gets baked into the browser bundle
that way (see gotcha 2 below). The compose file guards against this with a
`:?` default so it fails with an explanatory error instead of building a
quietly broken image.

`docker-compose.yml` reads secrets from `.env.local` and overrides three
values for this environment: `LOCAL_AI_BASE_URL` points at Open WebUI's
internal address, the two `CF_ACCESS_*` variables are blanked (no Cloudflare
hop means no service token), and `AUTH_TRUST_HOST=true` is set. Check the
`networks:` block at the bottom matches the network Open WebUI actually runs
on — `docker network ls` will tell you.

The container publishes on `127.0.0.1:3200` — loopback only, so it's reachable
from outside solely through the tunnel. Point a hostname at it: a
`proj-nimbus.<domain>` public hostname on an existing Cloudflare Tunnel, service
type **HTTP**, URL `127.0.0.1:3200`. Plain HTTP is correct — `cloudflared` runs
on the same host and TLS terminates at Cloudflare's edge. Use the literal IP
rather than `localhost`: the container binds IPv4 loopback only, so on a host
where `localhost` also resolves to `::1`, the dialer can try IPv6 first and
fail.

Three things that will bite you if you deploy this by hand instead:

1. **`AUTH_TRUST_HOST=true` is required.** Auth.js v5 only trusts the request
   host automatically on Vercel. Behind a tunnel or reverse proxy without
   this, logins fail at the callback with a confusing host error.
2. **`NEXT_PUBLIC_LAUNCHDARKLY_CLIENT_ID` must be set at *build* time**, not
   run time — `NEXT_PUBLIC_*` values are inlined into the browser bundle by
   `next build`. The Dockerfile takes it as a build arg for this reason. Pass
   it only at `docker run` and the client SDK is silently disabled: no error,
   no warning in production, just a Memory badge and logo swap that never
   respond to flag changes while server-side flags keep working fine.
3. **The host needs outbound HTTPS to `*.launchdarkly.com`** for the server
   SDK's flag stream and event flush. The browser's client SDK connects to
   LaunchDarkly directly from each visitor's machine, so that path doesn't
   touch your infrastructure.

Once this is publicly reachable, the app's own login is what stands between
the internet and the GPU: `/api/chat` checks the session and returns `401`
regardless of what the UI shows. Make `DEMO_PASSWORD` a long random value
that isn't reused anywhere else.

This deployment also has a Cloudflare Access application on its hostname,
configured as a regional Bypass policy: traffic from the permitted country
reaches the app directly, anything else is refused at the edge. The landing
page is public by design; the chat is not.

If you instead give Access a policy that *requires* authentication, know that
it intercepts every path, `/api/chat` included — so an expired Access session
returns its HTML login page where the browser expects JSON, and the UI reports
the generic "chat backend is unreachable" error. A login lapse that looks
exactly like an outage. Use a generous session duration if you go that route.

## Deploying to Vercel

This project's own instance is live at
[nimbus-ai-sample.vercel.app](https://nimbus-ai-sample.vercel.app/), but
**chat doesn't work there** — see step 5. It's kept as evidence the app
deploys cleanly to a standard platform, and the flag-driven parts of the UI
(logo swap, live Memory badge, login) do work there. For a working chat demo,
self-host it instead (above). The steps below are what it took to get here,
if you're setting up your own.

The app is a standard Next.js project — no build changes are needed to put
it on Vercel. What matters is getting the environment right, since nothing
above is read from `.env.local` once it's off this machine.

1. **Import the repo** in the Vercel dashboard (or `vercel link` from this
   directory), framework preset **Next.js**.
2. **Add every variable from `.env.example`** under Project Settings →
   Environment Variables (Production, and Preview if you want preview
   deployments to work too):
   `LAUNCHDARKLY_SDK_KEY`, `NEXT_PUBLIC_LAUNCHDARKLY_CLIENT_ID`,
   `AUTH_SECRET`, `DEMO_PASSWORD`, `INFERENCE_PROVIDER`, `GROQ_API_KEY`,
   `LOCAL_AI_BASE_URL`, `LOCAL_AI_API_KEY`, `CF_ACCESS_CLIENT_ID`,
   `CF_ACCESS_CLIENT_SECRET`. There's nothing Vercel-specific to add —
   NextAuth (Auth.js) v5 trusts the host automatically when it detects
   Vercel's own `VERCEL` environment variable, so no `NEXTAUTH_URL` is
   needed.
3. **Deploy.** The home-lab backend behind `LOCAL_AI_BASE_URL` is reached
   over its public Cloudflare Tunnel hostname with a Service Auth token, the
   same way it's reached from a local dev server — in principle, Vercel's
   functions are just another caller on the public internet. In practice,
   see step 5.
4. **If you're on the Hobby (free) plan**, function duration is capped at
   60 seconds. `app/api/chat/route.ts` already sets `maxDuration = 60` for
   this reason, and `generateImage()` in `lib/inference.ts` times out at 55s
   so a slow upstream fails with a clean error instead of Vercel killing the
   function mid-request. Image generation took ~50s in local testing, so
   there's little headroom — an occasional timeout on a slow prompt is
   expected on Hobby. Raise `maxDuration` (Pro supports up to 300s) if that
   turns out to be too flaky.
5. **Chat is currently blocked on the deployed instance.** Every chat request
   from Vercel gets a `403` back from Cloudflare — the body is Cloudflare's
   "Just a moment..." interstitial, meaning Bot Fight Mode (or Super Bot
   Fight Mode) is challenging the request at the edge before it reaches the
   Access Service Auth policy or Open WebUI. Identical requests from local
   dev succeed with the same credentials, so this is specifically about how
   Cloudflare treats traffic from Vercel's network. The real fix is a
   Cloudflare Configuration Rule scoped to the `LOCAL_AI_BASE_URL` hostname
   that skips Bot Fight Mode for just that hostname — but Configuration
   Rules (and Custom Rules) are gated behind a paid Cloudflare plan on this
   zone. The only free-tier lever is the zone-wide Bot Fight Mode toggle,
   which would also drop bot protection from the main Open WebUI hostname —
   not worth that trade-off for a demo deployment. **Self-host it (above) for
   a working chat demo** — running alongside Open WebUI sidesteps this
   entirely, since the inference call stops being internet traffic. See
   "Known gaps" in `docs/ARCHITECTURE.md` for the full writeup.

## Re-creating this independently

Everything below is for setting this up from zero — your own LaunchDarkly
account and your own chat backend. Skip this if the quick start above
already worked for you.

### What you'll need

- **Node.js 20 or newer** (built against Node 22; Node 18 will fail to
  install some dependencies).
- **A LaunchDarkly account** — the free trial is enough. One project with
  at least one environment.
- **A chat model backend.** The app talks to any OpenAI-compatible chat
  completions API:
  - **Groq** (recommended for just trying this out) — free account at
    [console.groq.com](https://console.groq.com), create an API key. No
    infrastructure of your own required.
  - **Your own self-hosted OpenAI-compatible server** (Ollama, llama.cpp,
    Open WebUI, vLLM, etc.) — if it's on a private network, the app can
    optionally send Cloudflare Access service-token headers alongside the
    request; if it's open or local, just leave those two variables blank.

### 1. Clone and install

```bash
git clone https://github.com/hiddenintel-rc/nimbus-ai-sample.git
cd nimbus-ai-sample
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in:

| Variable | Where it comes from |
|---|---|
| `LAUNCHDARKLY_SDK_KEY` | Your LD project's environment → **Account settings → Projects → (your environment) → SDK key**. Server-side, keep it secret. |
| `NEXT_PUBLIC_LAUNCHDARKLY_CLIENT_ID` | Same page → **Client-side ID**. Safe to expose in the browser. Note it's read at *build* time, not run time — see "Self-hosting with Docker". |
| `AUTH_SECRET` | Any random string. Generate one with `openssl rand -base64 32`. |
| `AUTH_TRUST_HOST` | Set to `true` only when serving from a custom domain behind a proxy/tunnel. Not needed for local dev or Vercel. |
| `DEMO_PASSWORD` | The shared password for the three demo accounts. Pick your own; logins are disabled until it's set. |
| `INFERENCE_PROVIDER` | `local` or `groq`. This is a manual switch, not automatic — nothing silently fails over between the two. |
| `GROQ_API_KEY` | Only needed if `INFERENCE_PROVIDER=groq`. From your Groq account. |
| `LOCAL_AI_BASE_URL`, `LOCAL_AI_API_KEY` | Only needed if `INFERENCE_PROVIDER=local`. Point `LOCAL_AI_BASE_URL` at your own OpenAI-compatible endpoint — its internal address if you're running alongside it (e.g. `http://open-webui:8080/api`), or a public hostname otherwise — and `LOCAL_AI_API_KEY` at whatever key/token that server expects. |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | Only needed if your `local` endpoint sits behind Cloudflare Access with a Service Auth policy. Leave blank otherwise, including when reaching it internally. |

**If you're using Groq:** the model IDs in this repo's flag variations
(below) are specific to a particular self-hosted setup and won't exist on
Groq. When you create the `chat-tier-config` flag, replace every model `id`
and `defaultModel` with real Groq model IDs (check
[console.groq.com](https://console.groq.com) for the current list — e.g. a
small/fast model for Free, larger ones for Pro and Enterprise), and use the
same ID for the AI Config's model in step 4. Leave out `"slow": true`, since
Groq doesn't load models on demand.

### 3. Re-create the LaunchDarkly flags

This app reads six flags and sends one custom event (there's also a
separate AI Config, covered in step 4). All of these need to exist in your
own LD environment — they are not created automatically.

#### `sanity-check` (optional)

Not read by the app anymore. Skip this one unless you want a throwaway flag
to confirm your SDK key/client ID work before moving on.

#### `enable-conversation-memory` — boolean

Controls whether the chat remembers earlier turns in the same conversation,
or treats every message as a fresh start. It is also plan-gated: memory is
a paid feature, so free accounts are served `false`.

1. **Create flag** → Name: `Conversation Memory`, Key: `enable-conversation-memory`
   (the key must match exactly), Type: **Boolean**.
2. Make sure **"Available on client-side SDKs"** is turned on — the landing
   page's live status badge needs it.
3. Set the default rule to serve `true`, and toggle the flag **On**.
4. **Exclude the free plan:** add a custom rule — if `tier` is one of
   `free` → serve `false`. Memory is what `chat-tier-config`'s
   `maxContextMessages` caps, so a tier without memory is stateless and that
   cap never applies to it (see the note under `chat-tier-config`). This
   project's own environment currently does it with an individual target on
   `demo-free` rather than a rule; a rule is what makes it a plan boundary
   rather than one account's setting.
5. **Add a remediation trigger:** open the flag, click the environment
   pill (e.g. "Test") near the top of the Targeting tab, choose
   **Flag actions → Configuration in environment**, find **Triggers**, and
   create one: Trigger type **Generic trigger**, action **turn the flag
   off**. Save the generated URL somewhere private — LaunchDarkly only shows
   it once.

**Try it:** log in as `demo-pro` or `demo-enterprise` (free has no memory by
design, so it can't show this). With the flag on, tell the chat "My name is
Alex, remember that," then ask "what's my name?" — it should recall it. `curl -X POST
<your trigger URL>` and ask again in the same browser tab (no reload) — the
"Memory" badge flips to Off live, and the assistant immediately forgets.

#### `new-logo` — boolean

Gates the redesigned cloud + wordmark logo vs. the original plain text
wordmark — a second example of the release/remediate pattern, applied to a
brand rollout instead of a product feature.

1. **Create flag** → Name: `New Logo`, Key: `new-logo` (must match exactly),
   Type: **Boolean**.
2. Make sure **"Available on client-side SDKs"** is turned on.
3. Set the default rule to serve `true`, and toggle the flag **On**.

**Try it:** with the flag on, the header shows the cloud icon above
"Nimbus." Flip the flag **Off** in the dashboard and watch the same tab (no
reload) — it reverts instantly to the plain text wordmark.

#### `show-plan-comparison` — boolean

Gates the landing page's "Compare plans" block, a new component going out
to everyone who visits the page. It is the targeting example: individual
targeting, a rule and a percentage rollout each release it to a different
audience, the usual order for shipping a component carefully to a large
audience.

1. **Create flag** → Name: `Show Plan Comparison`, Key:
   `show-plan-comparison` (must match exactly), Type: **Boolean**.
2. Turn on **"Available on client-side SDKs"**. This one is required, not
   just for live updates: logged-out visitors are only ever evaluated in the
   browser, because their key is generated there.
3. **Individual target:** on the Targeting tab, add an individual target
   serving `true` to context key `demo-pro` — one named account that gets
   the component before anyone else, to try it in production.
4. **Rule:** add a custom rule — if `tier` is one of `free` → serve `true`.
   Free accounts are who a plan comparison is for.
5. **Default rule:** serve a **percentage rollout**, 20% `true` / 80%
   `false`, bucketed by `key`. This reaches logged-out visitors (each
   browser has its own generated key) and any account the target and rule
   above didn't match.
6. Toggle the flag **On**.

**Try it:** log in as `demo-free` and `demo-pro` and the block is there,
for two different reasons. The dashboard's flag evaluation (or the
`Contexts` page) shows which: individual target for one, rule match for the
other. Logged out, roughly one browser in five sees it. Delete the
`ld:$anonUserId` entry from the site's localStorage and reload to become a
new visitor with a new bucket. Raise the rollout to 100% and every open
logged-out tab shows the block without a reload.

#### `enable-web-search` — boolean

Offers a "Search the web" toggle in the chat. When it's on and the user
turns the toggle on, the request asks Open WebUI to run a web search (its
Tavily integration) and add the results to the model's context.

It is a pure kill switch, not an entitlement: no rules, no targets, on for
every account. Turning it **Off** removes the toggle from all of them at
once, and the server stops honouring search requests even from pages still
showing the button. In a live product you'd add a `tier` rule to make it a
paid feature; here it stays deliberately ungated, so it demonstrates the
kill switch on its own.

1. **Create flag** → Name: `Enable Web Search`, Key: `enable-web-search`,
   Type: **Boolean**.
2. Turn on **"Available on client-side SDKs"** — the toggle's visibility
   reads it live.
3. Set the default rule to serve `true`, and toggle the flag **On**.

Requires `INFERENCE_PROVIDER=local` and web search configured in Open WebUI
(Admin → Settings → Web Search), with the Web Search permission granted to
the user that owns `LOCAL_AI_API_KEY`. On Groq the toggle does nothing.

**Try it:** turn the toggle on and ask about something recent; the reply's
caption adds "searched the web", each `[n]` marker links to its source, and
the cited sources are listed under the reply (built from the `sources` field
Open WebUI returns). Flip the flag **Off** and the toggle
disappears without a reload — and the server ignores search requests even
from a stale page, since it re-checks the flag on every message.

#### `enable-image-generation` — boolean

Offers a "Generate an image" toggle in the chat. When it's on, that turn's
prompt is sent to Open WebUI's image API (`POST /api/v1/images/generations`)
instead of the chat model. Open WebUI paints it with the local ComfyUI
setup and Nimbus shows the picture in the thread. On for everyone except the
`demo-free` account, which is individually gated off — it is the most widely
shared login, and image generation is the most expensive thing the single GPU
can be asked to do.

1. **Create flag** → Name: `Enable Image Generation`, Key:
   `enable-image-generation`, Type: **Boolean**.
2. Turn on **"Available on client-side SDKs"** — the toggle's visibility
   reads it live.
3. Set the default rule to serve `true`, and toggle the flag **On**.
4. **Gate the shared demo account:** add an **individual target** — context
   key `demo-free` → serve `false`. This is deliberately per-account, not a
   `tier` rule: the point is to keep the GPU's most expensive operation away
   from the login that gets passed around, not to make image generation a
   plan feature.

Requires `INFERENCE_PROVIDER=local` and image generation configured in Open
WebUI (Admin → Settings → Images, engine ComfyUI). On Groq the toggle does
nothing. If both this toggle and web search are on, the image request wins
for that turn. If API key endpoint restrictions are on, the key also has to
be allowed to call `/api/v1/images/generations` and `/api/v1/files` — chat
completions alone cannot return the picture.

**Try it:** turn the toggle on and describe a picture. The reply shows the
image with a "generated locally" caption. The first one can take a while —
the home lab starts the painter and unloads the chat model for that job.
Flip the flag **Off** and the toggle disappears without a reload.

#### `chat-tier-config` — JSON

Controls which models each account's tier can pick from the chat's model
menu, which ones it sees greyed out as an upsell, how much conversation
history it gets, and how many messages it may send in one conversation.

1. **Create flag** → Name: `Chat Tier Config`, Key: `chat-tier-config`,
   Type: **JSON**. Turn on **"Available on client-side SDKs"** — the model
   menu reads it live. Without it the menu still works, but only picks up
   flag changes on a page reload. The server re-checks every request either
   way, so a greyed-out model can never be used by editing the request.
2. On the **Variations** tab, define three variations. `models` are the
   selectable entries (each `id` is a model ID on your backend — adjust them
   if you're on Groq, see above); `lockedModels` are shown disabled with the
   plan that unlocks them; `slow: true` marks a model the backend has to
   load first, so the chat says so instead of just "Thinking…":

   ```json
   // "Free Tier"
   {
     "label": "Free",
     "maxContextMessages": 4,
     "maxMessagesPerConversation": 4,
     "defaultModel": "Qwen3.5-4B",
     "models": [{ "id": "Qwen3.5-4B", "label": "Qwen 4B" }],
     "lockedModels": [
       { "id": "Qwen3.5-4B-128k", "label": "Qwen 4B · long context", "requiredTier": "Pro" },
       { "id": "Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL", "label": "Qwen Coder 30B", "requiredTier": "Enterprise" },
       { "id": "Qwen3.8-27B-UD-Q3_K_XL", "label": "Qwen 3.8 27B", "requiredTier": "Enterprise" }
     ]
   }
   ```
   ```json
   // "Pro Tier"
   {
     "label": "Pro",
     "maxContextMessages": 20,
     "defaultModel": "Qwen3.5-4B",
     "models": [
       { "id": "Qwen3.5-4B", "label": "Qwen 4B" },
       { "id": "Qwen3.5-4B-128k", "label": "Qwen 4B · long context", "slow": true }
     ],
     "lockedModels": [
       { "id": "Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL", "label": "Qwen Coder 30B", "requiredTier": "Enterprise" },
       { "id": "Qwen3.8-27B-UD-Q3_K_XL", "label": "Qwen 3.8 27B", "requiredTier": "Enterprise" }
     ]
   }
   ```
   ```json
   // "Enterprise Tier"
   {
     "label": "Enterprise",
     "maxContextMessages": 50,
     "defaultModel": "Qwen3.5-4B",
     "models": [
       { "id": "Qwen3.5-4B", "label": "Qwen 4B" },
       { "id": "Qwen3.5-4B-128k", "label": "Qwen 4B · long context", "slow": true },
       { "id": "Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL", "label": "Qwen Coder 30B", "slow": true },
       { "id": "Qwen3.8-27B-UD-Q3_K_XL", "label": "Qwen 3.8 27B", "slow": true }
     ],
     "lockedModels": []
   }
   ```

   The older single-model shape (`{ "model": "…", "maxContextMessages": 4,
   "label": "Free" }`) is still accepted, as a one-entry menu.
3. On the **Targeting** tab, add two custom rules (order between them
   doesn't matter, since `tier` only ever holds one value):
   - If `tier` is one of `pro` → serve **Pro Tier**
   - If `tier` is one of `enterprise` → serve **Enterprise Tier**
4. Set the **Default rule** to serve **Free Tier** — this is what accounts
   with any other (or no) tier attribute fall through to.
5. Toggle the flag **On**.

Each account now matches its own plan, which is what makes the model menu
read correctly. Earlier revisions also kept a standing **individual target**
(`demo-pro` → Free Tier) to show that individual targets beat rules; that was
retired because a Pro account served the Free config contradicted every other
part of the demo. The precedence is better shown live — add the target in
front of an audience and the open tab's model menu collapses with no reload,
then delete it again.

**Two different limits, often confused.** `maxContextMessages` is a sliding
window over what gets replayed to the model, and it only takes effect when
`enable-conversation-memory` is on for the account — it never refuses a
message, it just forgets older ones. Free is excluded from memory above, so
the free tier is stateless and its `4` is never reached; it is kept as the
value that would apply if memory ever reached free.

`maxMessagesPerConversation` is the hard stop. Omit it and the plan is
unlimited, which is what Pro and Enterprise do. Set it, and `/api/chat`
refuses with **403** once the conversation has used its allowance, and the
browser replaces the composer with the plan's wall and the upgrade button
before that happens. It does not depend on memory. Two things follow from
the app having no database:

- **It is per conversation, not per account.** The count comes from the
  history the browser submits, so reloading starts a fresh allowance. That is
  a real product shape ("4 messages per conversation on the free plan"), not
  an account quota — a per-account limit needs storage this project
  deliberately doesn't have.
- **It fails open.** `DEFAULT_TIER_CONFIG` sets no limit, so if LaunchDarkly
  is unreachable nobody is turned away because a flag couldn't be read.

The app ships inert until a variation carries the field: no
`maxMessagesPerConversation` anywhere means no behavior change at all.

If you change these variations on a deployment that's still running an
older build of this app, keep a `"model"` field in each one (the tier's
single model, as before) until the new build is live — older builds read
only that field, and newer ones ignore it.

**Try it:** log in as each demo account (`demo-free`, `demo-pro`,
`demo-enterprise` — see `lib/demo-users.ts`) and open the model menu next
to the chat's toggles. Free has one model and three greyed out, Pro can
switch between the two 4B models, and Enterprise can pick all four. Each
reply's "served by …" caption names the model and tier config that
answered. Switching to a different model makes the first reply
slow on a single-GPU home lab, which keeps one model loaded at a time.

#### Experiment + metric (optional)

The experiment runs on `show-plan-comparison`, the flag the targeting
example is built on: does seeing the "Compare plans" block make free users
click **Upgrade to Pro** more often?

1. **Create the metric** (any "+ Create" menu → Metric). This project's is
   named `Upgrade interest`, key `upgrade-interest`, Event key
   `clicked-upgrade`, Custom event. The metric's own name and key are yours
   to choose; the **event key must be exactly `clicked-upgrade`**, since
   that's the string `/api/track-upgrade` sends. Measuring **occurrence**
   (did the context click at all) rather than count is the better choice
   for real traffic, since one account can press the button more than once.
2. **Experiments → Create experiment.** Flag `show-plan-comparison`,
   targeting rule **Rule 1** (`tier is one of free`), randomize by `user`,
   **100%** of the rule's contexts in the experiment, `false` (no block) as
   **control** and `true` as treatment, 50 / 50. Attach `upgrade-interest`
   as the primary metric. This project uses frequentist with sequential
   testing, significance 0.05, two-sided. Then **Start** it.
   Run it on the free-tier rule, not the default rule: logged-out and
   Enterprise visitors reach the default rule, and neither ever sees an
   Upgrade button, so they could never convert.
3. **Generate data:** `npm run simulate:experiment [count]` (default 4,000)
   sends synthetic free-tier sessions against it, each evaluating the flag
   once and clicking Upgrade at most once, more often when the block is
   shown. See the script's header comment; this is clearly synthetic data,
   not real usage. Results take several minutes to appear.

Both arms get the genuine free product and the same Upgrade button; the only
difference is whether the plan comparison is shown. While the experiment
runs, the free-tier rule serves the experiment rather than `true`, so
`demo-free` sees whichever arm it was bucketed into.

An earlier experiment ran on `chat-tier-config`'s default rule (Free Tier vs
Pro Tier). It produced a clear result but was stopped, because its treatment
arm handed free accounts the Pro entitlement while still showing them
"Upgrade to Pro". Its result, the reason it was stopped, and the readout of
the current experiment are under "Experiment result and decision" in
`docs/ARCHITECTURE.md`.

### 4. Create the AI Config

This is a separate LaunchDarkly product (branded **AgentControl** in the
dashboard, under **Agents** in the left sidebar) from the flags above — it's
not under Features. It controls the assistant's prompt and temperature for
every account, and its model is the default selection in the model menu —
but only for tiers whose `chat-tier-config` allows that model. A user's own
pick from the menu wins.

1. **Agents → Configs → Create config** → **Completion** mode. Name:
   `Nimbus Assistant`, Key: `nimbus-assistant` (must match exactly).
2. On the config's **Variations** tab, in the one default variation:
   - **Model** → **Select a model → + Add a model** to register a custom
     one (adjust to match whatever you set `LOCAL_AI_BASE_URL`'s model names
     to, or your Groq model if using Groq): Name `Qwen3.5-4B (Self Hosted)`,
     Model ID `Qwen3.5-4B`, Input/output token cost `$0` (accurate for a
     self-hosted model). The **Model ID** must match one of the `id`s in
     `chat-tier-config` — the app uses it as the default model for any tier
     that allows it, and falls back to the tier's `defaultModel` otherwise.
     Register the other models the same way if you want to switch between
     them here.
   - Add the parameter **temperature**, value `0.7` (or enter
     `{ "temperature": 0.7 }` if you're given a raw JSON box instead of a
     parameter picker).
   - Add a **System** message with whatever prompt you want the assistant
     to follow.
3. **Review and save**, then on the **Targeting** tab set the default rule
   to serve this variation and toggle the config **On**.

**Try it:** ask the assistant something generic like "tell me about your
day." Then go back and edit the system message to something distinctive
(e.g. "You are a pirate. Speak only in pirate slang.") and save. Ask again,
same conversation — the very next reply should reflect the new prompt
immediately, with no redeploy. To change the model the same way, log in as
`demo-enterprise`, leave the model menu untouched, and switch the config's
model to `Qwen3.8-27B-UD-Q3_K_XL`: the next reply's caption shows Qwen 3.8.
Free and Pro keep the 4B, because their tier doesn't allow that model.

#### Prompt experiment, scored by feedback and a judge (optional)

Tests a second system prompt against the current one, on two kinds of
evidence at once: what users say (👍 / 👎) and what an LLM judge says about
the same replies. What each reply costs (output tokens) and how long it makes
people wait (time to first token) are tracked per variation too, on the AI
Config's Monitoring tab, though not as experiment metrics. Only the prompt
changes between the arms; model and temperature stay the same, so any
difference is the prompt's.

1. **Create the judge.** Agents → Configs → Create config → **Judge** mode.
   Name `Nimbus Judge — Helpfulness`, key `nimbus-judge-helpfulness`.
   - **Model:** any; the form only lists hosted providers, and the app
     ignores this field. Every judge runs on the assistant variation's own
     model (`Qwen3.5-4B` here), and only on replies that model wrote: the
     home lab keeps one model loaded at a time, and judging on another one
     would unload the model the user is chatting with.
   - Parameter **temperature** `0`, so the same reply gets the same score.
   - **System** message, the rubric:
     > You are grading one reply from a chat assistant. Score how helpful it
     > is to the user who asked. 1 means it answers what was asked,
     > correctly and clearly, at a sensible length. 0.5 means partly useful,
     > padded, or missing something important. 0 means wrong, off-topic or
     > evasive. Grade the reply, not the question.
   - **Evaluation metric key:** whatever the dashboard creates or offers for
     the judge. The app reads it from the config, so it needs no change here.
   - Targeting: default rule serves this variation; toggle it **On**.
2. **Add the treatment variation** to `nimbus-assistant`: key
   `structured-concise` (the simulator looks for this key), same model and
   temperature as the existing variation, system message:
   > You are the Nimbus assistant. Answer the question in your first
   > sentence. If more detail helps, add at most three short bullet points.
   > Be accurate, and say plainly when you don't know. Ask a clarifying
   > question only when the request is genuinely ambiguous.
3. **Attach the judge to both variations,** with the same sampling rate on
   each (this project uses **10%**). The judge configuration lives on each
   variation, so attaching it to only one arm would leave the other arm
   with no judge scores at all.
4. **Experiments → Create experiment.** AI Config `nimbus-assistant`, the
   default rule, randomize by `user`, 100% in the experiment, the existing
   variation as **control**, 50 / 50. Metrics: **positive feedback** as the
   primary metric (`$ld:ai:feedback:user:positive`); the judge's score
   (`$ld:ai:judge:nimbus-judge-helpfulness`, numeric average) as a secondary
   metric. Start it.
5. **Generate data:** `npm run simulate:ai-experiment [count]` (default
   4,000). It calls no model: each synthetic session records made-up
   tokens, latency, feedback and a judge score on a real AI Config tracker,
   through the same SDK calls the app makes. See the script's header.

**Try it:** chat as any account. Each reply gets a **Helpful? 👍 👎** row.
A click records feedback on the AI Config run that wrote that reply, even if
the config has been edited since. With the judge attached, about one reply
in ten is scored right after it finishes. The score shows up on the AI
Config's **Monitoring** tab and in the experiment.

### 5. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in as
`demo-free@nimbus.app`, `demo-pro@nimbus.app` or
`demo-enterprise@nimbus.app`, using whatever you set `DEMO_PASSWORD` to.
