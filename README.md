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
- **Plans and models:** log in as each account and open the model menu.
  Free gets the 4B alone, Pro adds the long-context 4B, Enterprise all four;
  each reply's caption names the model and plan that answered.
- **Memory:** as `demo-pro` or `demo-enterprise`, tell it "My name is Alex,
  remember that," then ask "what's my name?". `demo-free` has memory off.
- **Live flags:** flip `new-logo` or `enable-conversation-memory` in the
  dashboard and watch the header logo or the Memory badge change without a
  reload.
- **Targeting:** the "Compare plans" block reaches `demo-pro` by individual
  target, `demo-free` by a `tier` rule, and 20% of logged-out visitors by
  percentage rollout.
- **AI Config:** the assistant's prompt and temperature come from
  `nimbus-assistant`; edit the prompt and the next reply follows it.
- **Experiments:** the free plan's "Upgrade to Pro" button and the 👍 / 👎
  under each reply feed the two experiments described below.

Each flag's section under "Re-creating this independently" explains what it
does and how to try it, which helps even if you didn't set it up yourself.

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

There are two deployments: **self-hosted with Docker**, beside the model
backend, where everything works, and
**[nimbus-ai-sample.vercel.app](https://nimbus-ai-sample.vercel.app/)**,
where everything except chat works (see "Deploying to Vercel"). Both read the
same LaunchDarkly environment. Not built: third-party integrations. See
`docs/ARCHITECTURE.md` for the full status and the reasoning behind it.

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
call never passes through Cloudflare, which is what blocks chat on Vercel
(below).

```bash
docker compose --env-file .env.local up -d --build
```

The `--env-file` is required: Compose fills in `${...}` in the compose file
from the shell or a `.env` file, not from the `env_file:` key. Without it the
LaunchDarkly client ID is empty at build time (gotcha 2 below), and the
compose file's `:?` guard stops the build with an error.

`docker-compose.yml` reads secrets from `.env.local` and overrides three
values: `LOCAL_AI_BASE_URL` points at Open WebUI's internal address, the two
`CF_ACCESS_*` variables are blank (no Cloudflare hop), and
`AUTH_TRUST_HOST=true` is set. Check that the `networks:` block matches the
network Open WebUI runs on (`docker network ls`).

The container publishes on `127.0.0.1:3200`, loopback only, so it is
reachable from outside only through a tunnel. Point a Cloudflare Tunnel
public hostname at it with service type **HTTP** and URL `127.0.0.1:3200`;
TLS terminates at Cloudflare. Use the IP rather than `localhost`, since the
container binds IPv4 only and `localhost` may resolve to `::1` first.

Three things that break a hand-rolled deployment:

1. **`AUTH_TRUST_HOST=true` is required** behind a tunnel or reverse proxy.
   Auth.js v5 only trusts the request host automatically on Vercel; without
   it, logins fail at the callback.
2. **`NEXT_PUBLIC_LAUNCHDARKLY_CLIENT_ID` must be set at build time.**
   `next build` inlines it into the browser bundle, so the Dockerfile takes
   it as a build arg. Passed only at `docker run`, the client SDK is disabled
   with no error in production: the Memory badge and logo never respond to
   flag changes, while server-side flags keep working.
3. **The host needs outbound HTTPS to `*.launchdarkly.com`** for the server
   SDK's flag stream and events. The browser's client SDK connects to
   LaunchDarkly directly from each visitor's machine.

Once the hostname is public, the app's own login is what protects the
model backend: `/api/chat` checks the session and returns `401` whatever the
UI shows. Use a long, unique `DEMO_PASSWORD`. If you put a Cloudflare Access
policy in front of the hostname, see "Deployments" in `docs/ARCHITECTURE.md`
for which kind of policy works with the chat API.

## Deploying to Vercel

This project's own instance is live at
[nimbus-ai-sample.vercel.app](https://nimbus-ai-sample.vercel.app/), but
**chat doesn't work there**: Cloudflare challenges Vercel's requests to the
model backend (step 4). The landing page, login and live flag-driven UI do
work. The app is a standard Next.js project, so no build changes are needed.

1. **Import the repo** in the Vercel dashboard (or `vercel link`), framework
   preset **Next.js**.
2. **Add every variable from `.env.example`** under Project Settings →
   Environment Variables. Nothing Vercel-specific is needed: Auth.js trusts
   the host automatically on Vercel, so no `AUTH_TRUST_HOST` or
   `NEXTAUTH_URL`.
3. **On the Hobby plan**, functions are capped at 60 seconds.
   `app/api/chat/route.ts` sets `maxDuration = 60`, and `generateImage()` in
   `lib/inference.ts` times out at 55 s so a slow image fails with a clear
   error. Image generation takes about 50 s, so an occasional timeout is
   expected; Pro allows up to 300 s.
4. **Chat is blocked on the deployed instance.** Requests from Vercel to the
   backend's public hostname get Cloudflare's bot challenge (`403`, "Just a
   moment...") before they reach the backend, while identical requests from
   elsewhere succeed. Skipping the challenge for one hostname needs a paid
   Cloudflare plan. The full write-up is under "Deployments" in
   `docs/ARCHITECTURE.md`; self-host the app for a working chat.

## Re-creating this independently

Everything below is for setting this up from zero — your own LaunchDarkly
account and your own chat backend. Skip this if the quick start above
already worked for you.

### What you'll need

- **Node.js 20 or newer**, a **LaunchDarkly account** (the free trial is
  enough), and a **chat model backend** that speaks the OpenAI chat
  completions API. See "Assumptions about your environment" above for what
  each choice implies.
- **Backend options:**
  - **Your own OpenAI-compatible server** (Open WebUI, llama.cpp, Ollama,
    vLLM, etc.). This is the tested path. If it sits behind Cloudflare
    Access, the app can send service-token headers; otherwise leave those
    variables blank.
  - **Groq**, if you have no infrastructure: create an API key at
    [console.groq.com](https://console.groq.com). Its code path is
    implemented but has not been run end to end.

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
| `LAUNCHDARKLY_SDK_KEY` | **Project settings → Environments → (your environment) → SDK key**. Server-side, keep it secret. |
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
or treats every message as a fresh start.

1. **Create flag** → Name: `Conversation Memory`, Key: `enable-conversation-memory`
   (the key must match exactly), Type: **Boolean**.
2. Make sure **"Available on client-side SDKs"** is turned on — the landing
   page's live status badge needs it.
3. Set the default rule to serve `true`, and toggle the flag **On**.
4. **Turn it off for `demo-free`:** add an individual target, context key
   `demo-free` → serve `false`. To make memory a paid feature for every
   free account instead, use a rule: if `tier` is one of `free` → serve
   `false`.
5. **Add a remediation trigger:** open the flag, click the environment
   pill (e.g. "Test") near the top of the Targeting tab, choose
   **Flag actions → Configuration in environment**, find **Triggers**, and
   create one: Trigger type **Generic trigger**, action **turn the flag
   off**. Save the generated URL somewhere private — LaunchDarkly only shows
   it once.

**Try it:** log in as `demo-pro` or `demo-enterprise` (`demo-free` has
memory off). With the flag on, tell the chat "My name is
Alex, remember that," then ask "what's my name?" — it should recall it. `curl -X POST
<your trigger URL>` and ask again in the same browser tab (no reload): the
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
showing the button. A `tier` rule would make it a paid feature; it is left
ungated here so it shows the kill switch on its own.

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
instead of the chat model. Open WebUI generates it with ComfyUI, and Nimbus
shows the picture in the thread. On for everyone except the
`demo-free` account, which is individually gated off — it is the most widely
shared login, and image generation is the most expensive thing the single GPU
can be asked to do.

1. **Create flag** → Name: `Enable Image Generation`, Key:
   `enable-image-generation`, Type: **Boolean**.
2. Turn on **"Available on client-side SDKs"** — the toggle's visibility
   reads it live.
3. Set the default rule to serve `true`, and toggle the flag **On**.
4. **Gate the shared demo account:** add an **individual target**, context
   key `demo-free` → serve `false`. It is per-account rather than a `tier`
   rule: it keeps the GPU's most expensive operation away from the most
   widely shared login, without making image generation a plan feature.

Requires `INFERENCE_PROVIDER=local` and image generation configured in Open
WebUI (Admin → Settings → Images, engine ComfyUI). On Groq the toggle does
nothing. If both this toggle and web search are on, the image request wins
for that turn. If API key endpoint restrictions are on in Open WebUI, the
key's allowlist needs `/api/chat/completions`, `/api/v1/models`,
`/api/v1/images/generations` and `/api/v1/files`: the last two request the
picture and download the stored file.

**Try it:** turn the toggle on and describe a picture. The reply shows the
image with a "generated locally" caption. The first one can take a while,
since a single-GPU backend unloads the chat model to generate it.
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
   load first, so the chat says so instead of just "Thinking…". A model
   entry may also carry `aiConfigKey`, naming its own AI Config (see "One
   AI Config per model" in step 4):

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

   `requiredTier` is the plan name shown beside a locked model.
3. On the **Targeting** tab, add two custom rules (order between them
   doesn't matter, since `tier` only ever holds one value):
   - If `tier` is one of `pro` → serve **Pro Tier**
   - If `tier` is one of `enterprise` → serve **Enterprise Tier**
4. Set the **Default rule** to serve **Free Tier** — this is what accounts
   with any other (or no) tier attribute fall through to.
5. Toggle the flag **On**.

Each account now matches its own plan

Each account now matches its own plan, which is what makes the model menu
read correctly. Individual targets are evaluated before these rules, so
adding one (for example `demo-pro` → Free Tier) in front of an audience
collapses an open tab's model menu with no reload.

**Two limits.** `maxContextMessages` is how much history is replayed to the
model, and only applies when `enable-conversation-memory` is on for the
account. `maxMessagesPerConversation` is a hard message allowance: omit it
for unlimited (Pro and Enterprise), and set it on Free to show the limit
notice and its Upgrade button. `/api/chat` refuses with **403** once the
allowance is used. It is per conversation, because the app has no
database, and it fails open when LaunchDarkly is unreachable. Both are
explained under "Two limits that are easy to confuse" in
`docs/ARCHITECTURE.md`.

**Try it:** log in as each demo account (`demo-free`, `demo-pro`,
`demo-enterprise`, see `lib/demo-users.ts`) and open the model menu next
to the chat's toggles. Free has one model and three greyed out, Pro can
switch between the two 4B models, and Enterprise can pick all four. Each
reply's caption names the model and plan that answered. The first reply
after switching models is slower, because a single-GPU backend loads one
model at a time.

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

**Result, on synthetic data:** showing the block raised upgrade interest by
**+72.48%** (95% CI +30.41% to +114.54%, 4,001 contexts), so `true` was
shipped on the free-tier rule. To do the same, stop the iteration and choose
`true` as the variation to serve.

The full readout, and an earlier experiment on `chat-tier-config`, are in
`docs/ARCHITECTURE.md`.

### 4. Create the AI Config

AI Configs are a separate part of LaunchDarkly from the flags above, under
**Agents → Configs** in the left sidebar. It controls the assistant's prompt and temperature for
every model without a config of its own, and its model is the default selection in the model menu —
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
same conversation: the next reply follows the new prompt, with no
redeploy. While an experiment runs on the config its variations are
locked, so stop the experiment first to try this. To change the model the same way, log in as
`demo-enterprise`, leave the model menu untouched, and switch the config's
model to `Qwen3.8-27B-UD-Q3_K_XL`: the next reply's caption shows Qwen 3.8.
Free and Pro keep the 4B, because their tier doesn't allow that model.

#### One AI Config per model (optional)

Without this, every model shares `nimbus-assistant`: a 👍 on a Coder 30B
reply, and its tokens, are credited to `nimbus-assistant` and its 4B model.
Feedback events name the AI Config and variation, not the model, so a
model's feedback is only separable once the model has a config of its own.
That config's **Monitoring** tab then shows the model's feedback, tokens,
latency and judge scores, and its prompt can be tuned or experimented on
without touching the other models.

1. **Create config** → **Completion** mode, one per model, e.g. Key
   `nimbus-assistant-coder-30b`. Its **Model ID** must be exactly that
   model's `id` in `chat-tier-config`. Give it its own system message and
   temperature, set the default rule to serve the variation, and toggle it
   **On**. Judges are optional: a judge runs on the config's own model, so
   judging a large model holds the GPU longer.
2. In `chat-tier-config`, add `"aiConfigKey": "nimbus-assistant-coder-30b"`
   to that model's entry in **every** variation that lists it under
   `models`.

A model with no `aiConfigKey`, or whose config is off or missing, keeps
using `nimbus-assistant`, so the order of the two steps doesn't matter. If a
config's Model ID doesn't match the model that answered, the server logs a
warning: its events would be credited to the wrong model, and its judges
are skipped.

**Try it:** as `demo-enterprise`, pick Coder 30B, send a message and rate
the reply. The rating appears on the new config's **Monitoring** tab, not
on `nimbus-assistant`'s.

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
     model (`Qwen3.5-4B` here), and only on replies that model wrote: a
     single-GPU backend loads one model at a time, and judging on another
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
   On the judge metric, set units that send no event to **excluded**, not
   "included with a value of 0". Only the sampled share of replies is
   judged, so counting everyone else as 0 measures how often the judge ran
   rather than how well replies scored, and hides any real difference.
5. **Generate data:** `npm run simulate:ai-experiment [count]` (default
   4,000). It calls no model: each synthetic session records made-up
   tokens, latency, feedback and a judge score on a real AI Config tracker,
   through the same SDK calls the app makes. See the script's header.

**Result so far, on synthetic data:** the judge scores `structured-concise`
**+11.76%** more helpful (95% CI +7.44% to +16.09%, significant), and
positive feedback, the primary metric, reads +10.31% (CI −2.36% to +22.97%,
not yet significant). It isn't shipped: the primary decides, so the
experiment keeps running. The full readout, and the two configuration
mistakes fixed along the way, are in `docs/ARCHITECTURE.md`.

**Try it:** chat as any account. Each reply gets a **Helpful? 👍 👎** row.
A click records feedback on the AI Config run that wrote that reply, even if
the config has been edited since. With the judge attached, about one reply
in ten is scored right after it finishes. Scores appear in the experiment's
judge metric.

### 5. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in as
`demo-free@nimbus.app`, `demo-pro@nimbus.app` or
`demo-enterprise@nimbus.app`, using whatever you set `DEMO_PASSWORD` to.
