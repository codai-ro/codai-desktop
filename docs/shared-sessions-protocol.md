# Shared sessions protocol v1

Normative for `apps/gateway` (server), `apps/phone-android` (executor + viewer), `apps/web` console (viewer/editor),
future desktop/CLI. ADR: `docs/decisions/2026-09-13-shared-sessions-multi-device.md`.

## Objects

**Session** — `{ id: uuid, session_key: string, owner_user_id, title, created_at, last_event_at, last_seq: int,
executor_device_id?: uuid, lease_expires_at?: ts, e2e: bool }`. `session_key` is the client-chosen id already sent
as `x-codai-session-id` (phone UUID); `id` is server-assigned. Both are accepted in paths (`:id` may be either).

**Device** — `{ id: uuid, user_id, name, platform: android|ios|web|desktop|cli|agent, capabilities: string[],
push_token?, last_seen_at, api_key_id? }`. Registered at `/native/*` login (phone) or lazily on first
`X-Codai-Device` header (web/agents). `capabilities` examples: `screen`, `local_llm`, `terminal`, `contacts`.
`push_token` (FCM registration token) is set by the header `X-Codai-Push-Token` on **any** v2 request that carries
`X-Codai-Device`, or by `PATCH /v1/devices/:id`; it is never returned — clients see `has_push_token: bool`.

**Event** — append-only, `{ seq: int (1..), kind, ts: ms, sender_device_id, turn_id?, payload: object }`. Kinds are
the phone trace vocabulary; the server treats them opaquely except: `turn_start`, `turn_end`, `assistant`,
`user` (echo of a control), `ask`, `ask_resolved`, `deadline`, `error`. In E2E mode `payload` is
`{ hide: base64 container }` and only `kind/ts/sender/turn_id` are cleartext.

**Control** — a request to the executor, `{ id: client idempotency key, kind: send|answer|approve|deny|cancel|steer|
inject, text?, turn_id?, ask_id?, from_device_id, target_device_id? }`. Persisted (`session_controls`) so a
late-joining executor can drain; echoed to all viewers as an event `{ kind: "control", payload: control, applied:
bool }`. `target_device_id` is set only by Dispatch and lives in the echoed event payload (no column); a targeted
control is meant for that one device, every other executor should skip it.

**Presence** — ephemeral, `{ device_id, user_id, role: owner|editor|viewer, executor: bool, remote: bool,
last_seen: ms, driving: bool }`. `remote = device_id != viewer's own device`. Delivered as a `presence` frame
(not an event; not persisted).

**Share** — `{ id, session_id, principal_type: user|org|link, principal_id?, role: viewer|editor|owner,
has_token: bool, expires_at?, created_by_user_id, created_at }`. Grants `role` on one session to a user, to every
member of an org, or to whoever presents the link token. Link tokens are stored **only as sha256** (`token_hash`);
the plaintext is returned exactly once by the `POST` that created it.

**Org** — `{ id, name, owner_user_id, created_at }` with `org_memberships(org_id, user_id, role: owner|admin|member)`.

**Lease** — `{ session_id, device_id, expires_at }`. TTL 30 s, heartbeat every 10 s. Claim is compare-and-set;
a live lease held by another device can be taken only with `force=true` (editor+), which emits an event
`lease_transferred`.

## HTTP (all under the gateway, Bearer API key; principal = user)

| Method | Path                                         | Body → Result                                                                                                                                                                                 |
| ------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------- | -------- |
| POST   | `/v1/sessions`                               | `{ session_key?, title?, e2e? }` → Session (idempotent on `session_key`)                                                                                                                      |
| GET    | `/v1/sessions`                               | list (own + shared) with `role` and presence counts                                                                                                                                           |
| GET    | `/v1/sessions/shared-with-me`                | sessions shared with me (user or org shares, not expired) with `role`, `share_id`                                                                                                             |
| GET    | `/v1/sessions/:id`                           | Session + `role` (mine) + `members[{ user_id, role, remote, devices[] }]` + lease + presence (viewer+)                                                                                        |
| PATCH  | `/v1/sessions/:id`                           | `{ title?, archived? }` (owner)                                                                                                                                                               |
| DELETE | `/v1/sessions/:id`                           | owner                                                                                                                                                                                         |
| GET    | `/v1/sessions/:id/events?after=seq&limit=`   | events (cleartext or ciphertext) (viewer+)                                                                                                                                                    |
| POST   | `/v1/sessions/:id/events`                    | executor only, `{ events: Event[] }` (without `seq`; server assigns, returns `last_seq`); idempotent on `(session, sender_device, client_event_id)`                                           |
| POST   | `/v1/sessions/:id/control`                   | editor+, Control → `{ accepted, seq }`                                                                                                                                                        |
| POST   | `/v1/sessions/:id/dispatch`                  | editor+, `{ device_id, text, turn_id?, control_id? }` → `{ control_id, seq, target_device_id, queued: true, pushed: bool, push_reason? }` (202; 200 + `duplicate` on a repeated `control_id`) |
| GET    | `/v1/sessions/:id/controls?applied=&target=` | viewer+, pending controls; `target=me` (needs `X-Codai-Device`) or `target=<device uuid>` returns only controls dispatched at that device. Not lease-gated.                                   |
| POST   | `/v1/sessions/:id/lease`                     | owner, `{ device_id, force? }` → Lease ; `DELETE` releases ; `PUT` heartbeats                                                                                                                 |
| GET    | `/v1/sessions/:id/stream?after=seq`          | viewer+, SSE: `event: event                                                                                                                                                                   | presence                                             | lease                       | control` |
| GET    | `/v1/sessions/:id/ws`                        | viewer+, WebSocket: same frames down; up: `{ t: "control", ... }` (editor+)                                                                                                                   | { t: "events", events }                              | { t: "presence", driving }` |
| GET    | `/v1/sessions/:id/shares`                    | owner → `{ shares: Share[] }` (never includes tokens)                                                                                                                                         |
| POST   | `/v1/sessions/:id/shares`                    | owner, `{ principal_type, principal_id?, role, expires_at? }` → Share (+ `token` once for `link`)                                                                                             |
| DELETE | `/v1/sessions/:id/shares/:shareId`           | owner                                                                                                                                                                                         |
| POST   | `/v1/orgs`                                   | `{ name }` → Org (creator = org owner)                                                                                                                                                        |
| GET    | `/v1/orgs`                                   | my orgs with my `role`                                                                                                                                                                        |
| GET    | `/v1/orgs/:id/members`                       | any member → `{ members[{ user_id, email, role }] }`                                                                                                                                          |
| POST   | `/v1/orgs/:id/members`                       | org owner/admin, `{ user_id                                                                                                                                                                   | email, role }`(upsert; only the owner grants`owner`) |
| DELETE | `/v1/orgs/:id/members/:userId`               | org owner/admin (the org owner cannot be removed)                                                                                                                                             |
| GET    | `/v1/devices` · `DELETE /v1/devices/:id`     | own devices (`has_push_token`, never the token)                                                                                                                                               |
| PATCH  | `/v1/devices/:id`                            | owner of the device, `{ push_token?: string \| null, capabilities?: string[] }` → Device                                                                                                      |

Errors use the gateway's OpenAI-shaped envelope. `403 not_a_member`, `409 lease_held`, `409 seq_conflict`.
A session that exists but the caller has no (sufficient) role on is `403 not_a_member`; an unknown id is `404`.

### Share token

Link shares are exercised by presenting the plaintext token on every request, either as the header
`x-codai-share-token: <token>` or the query parameter `?share=<token>` (the query form is for SSE/WS from browsers).
The server compares `sha256(token)` against `session_shares.token_hash` and ignores expired rows. A token grants the
share's role to **any authenticated principal** that presents it — treat it like a password.

## Fan-out

Gateway instances publish `session:<id>` on Redis (frames as JSON). Without Redis (dev), an in-process bus serves
a single instance. Stream/WS handlers replay `events` from Postgres for `after` then switch to live.

## Executor loop (phone)

1. On app start / Dispatch wake: for each open session, `POST lease`; on success start `AgentRun`.
2. `AgentRun` writes every trace line to Room **and** batches to `POST events` (≤200 ms or 20 events).
3. Drains `session_controls` where `applied=false`, then subscribes WS for live controls.
4. Heartbeat lease every 10 s; on loss (409 from heartbeat) → stop executing, become viewer, show "driven by
   <device>".
5. Screen-touching turns acquire the `ScreenArbiter` lease; the queue position is emitted as
   `event: { kind: "screen_wait", position }` so remote viewers see why a session is idle.

## Dispatch (start a task on a named device)

ADR decision 6. Any editor+ client (console, another phone, CLI, an agent) can hand a task to one specific device of
the session **owner** — only owner devices can claim the lease, so a target outside that set is `404`.

1. `POST /v1/sessions/:id/dispatch { device_id, text, turn_id?, control_id? }`. The server:
   - inserts a `session_controls` row of kind `send` (`from_device_id` = the dispatching device) and echoes it as a
     `control` event whose `payload.control.target_device_id = device_id`;
   - writes a `session_audit` row `dispatch` `{ control_id, target_device_id, seq, pushed, push_reason? }` (in
     addition to the usual `control:send`);
   - if the target has a `push_token`, sends an FCM HTTP v1 **data-only, high-priority** message and returns
     `pushed: true|false`. If it has none → `202 { queued: true, pushed: false, push_reason: "no_push_token" }`.
     Push is **fail-open**: FCM errors never fail the request; the control is durable either way. On
     `UNREGISTERED`/404 the server clears that device's `push_token`.
2. Push payload (`fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, ADC as the gateway SA):

   ```json
   {
     "message": {
       "token": "<push_token>",
       "data": { "type": "dispatch", "session_id": "<uuid>", "control_id": "<id>" },
       "android": { "priority": "high" }
     }
   }
   ```

   No `notification` block — Android hands it to the app's `FirebaseMessagingService` even when the app is
   backgrounded, and the message carries no content: the device re-reads everything from the protocol.

3. Wake flow on the device: FCM data message → `HeadlessExecutorService` starts →
   `GET /v1/sessions/:session_id/controls?applied=false&target=me` (viewer+, **before** holding the lease, so a
   woken device always sees its own work) → `POST /v1/sessions/:id/lease` (claim; `force=true` if another device
   holds a live lease and the user policy allows) → `AgentRun` executes the drained `send` → marks it applied via
   `POST …/control/:cid/applied` (lease-gated as usual) → normal executor loop.
4. **Lease semantics.** Dispatch never touches the lease. If another device holds the executor lease at dispatch
   time the control still queues (the request is still `202 queued: true`); the target claims or force-claims when
   it wakes. The current holder should skip controls whose `target_device_id` is not its own.

Gateway log line for every attempt: `msg: "fcm.dispatch"` with `session_id`, `control_id`, `device_id`, `ok`,
`reason` (`no_token | auth_failed | network_error | unregistered | http_<status>`), `duration_ms`. Env:
`FCM_PROJECT_ID` (default `codai-p`).

## Roles

`resolveRole(principal, session, linkToken?)` → `owner` when `conversation_sessions.user_id` is the caller; otherwise
the **max** role over non-expired `session_shares` rows matching `(user, caller)`, `(org, any org the caller belongs
to)` or `(link, sha256(token))`; otherwise `null` (403). Every device of the owning user is `owner`.

| Action                                                      |                              viewer                              | editor | owner |
| ----------------------------------------------------------- | :--------------------------------------------------------------: | :----: | :---: |
| GET session / events / controls / stream / WS               |                                ✓                                 |   ✓    |   ✓   |
| POST control (HTTP or WS `{ t: "control" }`), POST dispatch |                                                                  |   ✓    |   ✓   |
| PATCH / DELETE session                                      |                                                                  |        |   ✓   |
| POST lease (claim / force), PUT heartbeat, DELETE release   |                                                                  |        |   ✓   |
| GET / POST / DELETE shares                                  |                                                                  |        |   ✓   |
| POST events, mark control applied                           | executor lease holder only (any role that can claim, i.e. owner) |        |       |

Org member management (`/v1/orgs/:id/members`) is org **owner/admin** only; listing members is any org member;
sharing a session _into_ an org requires being a member of that org.

Every share/org mutation writes a `session_audit` row: `share_add`, `share_remove` (session_id = the session),
`org:create`, `org:member_add`, `org:member_remove` (session_id = the org id).

### Tier gating

Storing and streaming one's **own** sessions through this protocol is available to every paid tier. The
`persistent_memory` entitlement gates only server-side memory/search (the legacy read-only `GET /v1/sessions[/:key]`
message API in `sessions.ts`, memory capture/recall in chat completions and the MCP memory tools).

## Versioning

Frames carry `v: 1`. Additive fields are non-breaking; a new `kind` is non-breaking (viewers ignore unknown kinds).
