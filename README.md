# Nimbus

Nimbus is a demo project: a small landing page for a tiered AI chat product
(Free / Pro / Enterprise), built to explore how LaunchDarkly's feature-flag,
targeting, and experimentation tools fit into a real tiered-SaaS pattern. It
is not a real product — there's no billing and no real user accounts, just
three fixed demo logins.

A deeper look at the architecture and the reasoning behind its design
decisions lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), including
diagrams of each data flow.

## Quick start (you were given a working `.env.local`)

If you received this repo's link along with a ready-made `.env.local` file,
that file already points at a live LaunchDarkly environment with the flags,
targeting, and experiment below already configured — you don't need to set
up anything on the LaunchDarkly side yourself.

```bash
git clone https://github.com/hiddenintel-rc/nimbus-ai-sample.git
cd nimbus-ai-sample
npm install
```

Drop the `.env.local` file you were given into the project root (same folder
as `package.json`), then:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with the
demo account details you were given alongside the `.env.local` (one Free,
one Pro, one Enterprise account; they share the password in
`DEMO_PASSWORD`). Logins aren't published in this repo or on the login
page, so the chat — and the hardware behind it — stays limited to people
who were given access. Keep that `.env.local` private — don't commit it or
forward it on; it's already excluded from git (see `.gitignore`), but that
only protects you from committing it by accident, not from handing it to
someone else yourself.

**What to try:**
- Log in as each account and send a message — the reply shows a "served
  by …" caption naming the actual model/context config used. `demo-free`
  and `demo-enterprise` should match their tier; `demo-pro` intentionally
  shows **Free**, not Pro (see "Individual targeting" in
  `docs/ARCHITECTURE.md` for why).
- With the "Memory" badge on, tell it "My name is Alex, remember that,"
  then ask "what's my name?" — it should recall it across turns.
- As a free-tier account, the "Upgrade to Pro" button fires the conversion
  metric behind the Experimentation setup — no real checkout happens.
- The assistant's tone/personality and temperature come from a LaunchDarkly
  AI Config (`nimbus-assistant`), fetched fresh on every message — editing
  the prompt in the LD dashboard changes the very next reply, no redeploy.
- The logo in the header is gated behind `new-logo` — flip it off in LD and
  it reverts live to the plain text wordmark, no reload. A second example of
  the release/remediate pattern, this time for a brand rollout instead of a
  product feature.

If something doesn't work, jump to "Re-creating this independently" below —
the same steps explain what each flag is doing, which is useful even if you
didn't set it up yourself.

## What's implemented

- A feature flag that can be released, toggled live with no page reload,
  and rolled back via a remote trigger
- Rule-based and individual targeting on a real context (tier +
  account age) driving which model/context-window a request gets
- An experiment on that same flag, with a conversion metric and a traffic
  simulator for generating sample data
- Login gating, with the actual enforcement server-side, not just a hidden
  UI element
- A LaunchDarkly AI Config managing the assistant's prompt and temperature —
  a separate concern from tier-based model routing, both live-editable with
  no redeploy

Not yet built: third-party integrations and a production deployment. See
`docs/ARCHITECTURE.md` for the full status and the reasoning behind what's
here.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app locally |
| `npm run build` | Production build (also type-checks) |
| `npm run simulate:experiment [count]` | Generate synthetic free-tier traffic against the experiment below |

---

## Re-creating this independently

Everything below is for setting this up from zero — your own LaunchDarkly
account and your own chat backend, with no files from anyone else. Skip this
if the quick start above already worked for you.

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
| `NEXT_PUBLIC_LAUNCHDARKLY_CLIENT_ID` | Same page → **Client-side ID**. Safe to expose in the browser. |
| `AUTH_SECRET` | Any random string. Generate one with `openssl rand -base64 32`. |
| `DEMO_PASSWORD` | The shared password for the three demo accounts. Pick your own; logins are disabled until it's set. |
| `INFERENCE_PROVIDER` | `local` or `groq`. This is a manual switch, not automatic — nothing silently fails over between the two. |
| `GROQ_API_KEY` | Only needed if `INFERENCE_PROVIDER=groq`. From your Groq account. |
| `LOCAL_AI_BASE_URL`, `LOCAL_AI_API_KEY` | Only needed if `INFERENCE_PROVIDER=local`. Point `LOCAL_AI_BASE_URL` at your own OpenAI-compatible endpoint (e.g. `https://your-host/api` or `http://localhost:11434/v1`), and `LOCAL_AI_API_KEY` at whatever key/token that server expects. |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | Only needed if your `local` endpoint sits behind Cloudflare Access with a Service Auth policy. Leave blank otherwise. |

**If you're using Groq:** the model names baked into this repo's flag
variations (below) are specific to a particular self-hosted setup and won't
exist on Groq. When you create the `chat-tier-config` flag, swap the
`model` field in each variation for a real Groq model ID (check
[console.groq.com](https://console.groq.com) for the current list — e.g.
a small/fast model for Free, a larger one for Pro and Enterprise).

### 3. Re-create the LaunchDarkly flags

This app reads four flags and sends one custom event (there's also a
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
4. **Add a remediation trigger:** open the flag, click the environment
   pill (e.g. "Test") near the top of the Targeting tab, choose
   **Flag actions → Configuration in environment**, find **Triggers**, and
   create one: Trigger type **Generic trigger**, action **turn the flag
   off**. Save the generated URL somewhere private — LaunchDarkly only shows
   it once.

**Try it:** with the flag on, tell the chat "My name is Alex, remember
that," then ask "what's my name?" — it should recall it. `curl -X POST
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

#### `enable-web-search` — boolean

Offers a "Search the web" toggle in the chat. When it's on and the user
turns the toggle on, the request asks Open WebUI to run a web search (its
Tavily integration) and add the results to the model's context. Enabled for
every tier in this demo; in a live product you'd restrict it with a rule on
`tier`.

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

#### `chat-tier-config` — JSON

Controls which model and how much conversation history each account's tier
gets.

1. **Create flag** → Name: `Chat Tier Config`, Key: `chat-tier-config`,
   Type: **JSON**. Leave "Available on client-side SDKs" **off** — this one
   is only ever evaluated server-side.
2. On the **Variations** tab, define three variations (adjust the `model`
   values if you're on Groq — see above):

   ```json
   // "Free Tier"
   { "model": "Qwen3.5-4B", "maxContextMessages": 4, "label": "Free" }
   ```
   ```json
   // "Pro Tier"
   { "model": "Qwen3.5-4B-128k", "maxContextMessages": 20, "label": "Pro" }
   ```
   ```json
   // "Enterprise Tier"
   { "model": "Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL", "maxContextMessages": 50, "label": "Enterprise" }
   ```
3. On the **Targeting** tab, add two custom rules (order between them
   doesn't matter, since `tier` only ever holds one value):
   - If `tier` is one of `pro` → serve **Pro Tier**
   - If `tier` is one of `enterprise` → serve **Enterprise Tier**
4. Set the **Default rule** to serve **Free Tier** — this is what accounts
   with any other (or no) tier attribute fall through to.
5. Add an **individual target**: context key `demo-pro` → serve **Free
   Tier**. This deliberately *downgrades* one Pro account rather than
   upgrading a Free one — see `docs/ARCHITECTURE.md` for why.
6. Toggle the flag **On**.

**Try it:** log in as each demo account (`demo-free`, `demo-pro`,
`demo-enterprise` — see `lib/demo-users.ts`) and send a
message — the reply shows a "served by …" caption naming the actual
model/config used. `demo-free` and `demo-enterprise` should match their
tier; `demo-pro` should show **Free**, not Pro, because of the individual
override.

#### Experiment + metric (optional, for the Experimentation extra layer)

If you also want to reproduce the experiment: create a metric (any
"+ Create" menu → Metric) named e.g. `Upgrade click`, Event key
`clicked-upgrade`, Custom event. Then on `chat-tier-config`'s **Default
rule**, change its Serve action from a static variation to **Experiment**,
with **Free Tier** and **Pro Tier** as the two arms (leave Enterprise Tier
unchecked from "Include in experiment" — otherwise a slice of free-tier
traffic will randomly get routed to your most expensive model), attach the
metric, and start it. `npm run simulate:experiment [count]` (default 300)
generates synthetic free-tier traffic against it so the results page has
something to show — see the script's header comment for details; this is
clearly synthetic data, not real usage.

### 4. Create the AI Config

This is a separate LaunchDarkly product (branded **AgentControl** in the
dashboard, under **Agents** in the left sidebar) from the flags above — it's
not under Features. It controls the assistant's prompt and temperature for
every account, independent of tier.

1. **Agents → Configs → Create config** → **Completion** mode. Name:
   `Nimbus Assistant`, Key: `nimbus-assistant` (must match exactly).
2. On the config's **Variations** tab, in the one default variation:
   - **Model** → **Select a model → + Add a model** to register a custom
     one (adjust to match whatever you set `LOCAL_AI_BASE_URL`'s model names
     to, or your Groq model if using Groq): Name `Qwen3.5-4B (Self Hosted)`,
     Model ID `Qwen3.5-4B`, Input/output token cost `$0` (accurate for a
     self-hosted model). This registration is just metadata for LaunchDarkly's
     own cost tracking — the app never reads this model field to decide
     which backend to call; that's still `chat-tier-config`'s job.
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
immediately, with no redeploy.

### 5. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in as
`demo-free@nimbus.app`, `demo-pro@nimbus.app` or
`demo-enterprise@nimbus.app`, using whatever you set `DEMO_PASSWORD` to.
