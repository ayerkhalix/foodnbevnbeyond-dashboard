# Food N Bev N Beyond Messenger inbox

Private Next.js inbox backed by Supabase Auth and Postgres. It receives new Messenger messages for the four configured restaurant Pages and sends manual text replies using the contacted Page's server-side access token.

Supabase project [Food N Bev N Beyond](https://supabase.com/dashboard/project/esgumaqulhvwdntfeivv), reference `esgumaqulhvwdntfeivv`.

A temporary operator, `operator@foodnbevnbeyond.test`, has access to all four restaurants. Its generated password is in the Git-ignored `.env.operator.local` file in this checkout.

## Local setup

1. Install with `npm ci`. Use the tracked npm lockfile for dependency installation.
2. Copy `.env.example` to `.env.local` and fill in the inbox project's Supabase URL, publishable key and server secret key. A legacy service-role key can use `SUPABASE_SERVICE_ROLE_KEY` instead of `SUPABASE_SECRET_KEY`.
3. Apply the SQL files in `supabase/migrations` in filename order using Supabase's SQL editor or migration tooling. They create and seed the inbox tables and Page records. These migrations are already applied to the project linked above. Local Postgres tests load the same migration files through PGlite.
4. Create an email/password operator account in Supabase Auth, with a confirmed email. Disable public sign-ups and anonymous sign-in in the project's Auth settings. The app has a password sign-in flow. Account provisioning and password resets are managed by the administrator.
5. Assign the operator to the required Pages. Use the operator's UUID from Supabase Auth, then run the SQL below. Grant Moringa first for the initial test. Add the other Page memberships when ready.

```sql
insert into public.messenger_page_members (page_id, user_id)
values ('500981746436108', 'REPLACE_WITH_OPERATOR_AUTH_UUID');
```

6. Fill in `META_APP_SECRET` for Meta app `1138755189151466` and the Page token for Moringa. Page tokens are held only in environment variables named `META_PAGE_TOKEN_<PAGE_ID>`.
7. Generate the verification token and store it in `META_WEBHOOK_VERIFY_TOKEN`. Keep this value identical in the deployment environment and Meta's webhook setup.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

8. Run `npm run dev`. Visit `http://localhost:3000` and sign in. Until Supabase is configured, the home page displays a setup notice. No sample guest conversations are loaded into the inbox.

## Deploy and connect Meta

Deploy this checkout to the existing Next.js/Vercel project and add the same environment variables in Vercel. Redeploy after changing public Supabase variables. Keep Supabase server keys, the Meta App Secret and Page tokens out of `NEXT_PUBLIC_` variables.

The public callback is `/api/meta/webhook`. The suggested production callback is `https://foodnbevnbeyond-dashboard.vercel.app/api/meta/webhook` once this version is deployed there. Exclude this callback from Vercel Deployment Protection or use a deployment/domain where Meta can reach it without authentication. The application session proxy already excludes the callback. Check the route over the public URL before saving it in Meta.

| Restaurant | Allowed Page ID | Token environment variable |
| --- | --- | --- |
| The Moringa Tree Restaurant El Nido | 500981746436108 | META_PAGE_TOKEN_500981746436108 |
| Sa Kurbada Hapag Karaenan | 651516738053247 | META_PAGE_TOKEN_651516738053247 |
| Coco Resto El Nido | 109815532143585 | META_PAGE_TOKEN_109815532143585 |
| The LightHouse El Nido | 103575287751558 | META_PAGE_TOKEN_103575287751558 |

In the existing Meta app's Messenger API setup, validate the Page token's app, Page identity, effective Page tasks, `pages_messaging` scope and expiry using Meta's token debugger and Page access tools. Configure the callback and generated verify token, then subscribe Moringa to `messages` and `message_echoes`. Page subscription management needs `pages_manage_metadata`. Verify the subscription in Meta or with `GET /v26.0/<PAGE_ID>/subscribed_apps` using the scoped Page token. Keep all tokens out of URLs saved in logs, screenshots and review documents.

Outbound calls are pinned to Graph API `v26.0` in `lib/messenger/graph.ts`. Requests use `messaging_type=RESPONSE`, the conversation's stored Page and PSID, a bearer Page token, an app-secret proof and request metadata for echo reconciliation. Consult Meta's current [version table](https://developers.facebook.com/docs/graph-api/changelog/versions/) before a future version upgrade.

## Storage and authorization

- `messenger_pages` contains the four Page IDs and their latest send error or rate-limit cooldown.
- `messenger_page_members` assigns an Auth user to a Page. Only administrators using a trusted database connection can change assignments.
- `messenger_conversations` is unique by Page and customer PSID. It tracks the latest message and qualifying inbound timestamp.
- `messenger_messages` deduplicates by Page and Meta message ID. An outbound request UUID prevents repeated browser submissions from dispatching twice.
- `messenger_reads` tracks each operator's read watermark. Viewing an older snapshot cannot mark a later arrival as read or move an existing watermark backwards.

All tables have RLS. Browser sessions can read only their assigned Pages. They can update only their own read status. The backend authenticates API requests with Supabase `getUser`, uses RLS for reads, and rechecks Page membership inside the server-only send-preparation transaction. The browser supplies a conversation ID and reply text. The backend resolves the sending Page, PSID and credential.

The webhook verifies HMAC SHA-256 over the raw request bytes before parsing, skips unsupported events independently, and durably commits supported messages in one transaction before returning HTTP 200. Persistence failure returns HTTP 503 so Meta can retry. Out-of-order events cannot regress the latest inbound timestamp. Attachments are represented by type labels. Raw event payloads, attachment URLs and customer profile lookups are excluded from storage.

## Reply and recovery behavior

The server enforces the standard 24-hour window using the latest inbound message. Echoes and outbound replies do not reopen it. The UI refreshes the current inbox and thread every 10 seconds while visible. Lists and threads load 50 records at a time. Search covers loaded conversations. Loading more inbox pages pauses automatic list replacement until an explicit refresh.

Drafts stay in React memory while this tab remains open, including when switching restaurants or reauthenticating. Reloading or closing the tab clears unsent drafts. The browser stores only the theme preference in local storage. The send button waits for the server result, and confirmed sends display `Sent`. Definite rejections preserve the text for an explicit retry. Page token errors, permissions, rate limits and a closed reply window have separate feedback.

A timeout, a provider 5xx, or a failure after dispatch can leave `pending` or `unknown`. The inbox preserves the draft and prevents another send in that conversation until delivery is reconciled. An echo carrying the request metadata automatically marks the saved outbound message `sent`. The backend never blindly retries Graph API sends.

For an unresolved send, check the actual Page conversation in Messenger. A trusted administrator can reconcile a confirmed send with the actual Meta message ID through `messenger_finish_reply`. If the original reply is confirmed absent, they can mark the saved outbound record `failed` using that function. This permits a new manual send. The operator must establish the actual outcome before changing it. Do not resolve uncertainty solely because a timer elapsed. A client timeout that never created an outbound record can be cleared by copying the draft and reloading after checking Messenger.

Logs contain operation names and sanitized database error codes. They omit message text, PSIDs, access tokens and raw provider errors. Configure database retention, backups and operator access according to FNBnB's actual policy before handling production data.

## Verification and rollout

Run `npm test`, `npm run typecheck` and `npm run build`. Tests use synthetic data and local PGlite Postgres. They cover signatures, challenge responses, Page allowlisting, event deduplication, atomic rollback, RLS, reply authorization, reply windows, idempotency, echo races and rate limiting.

Next.js was updated to 16.4.6 and compatible dependencies were refreshed after the existing lockfile reported critical advisories. The remaining npm audit findings are in the existing shadcn generator dependency tree. The application imports that package's Tailwind stylesheet during the build. Resolving those tooling advisories requires a separate dependency decision because npm proposes a breaking shadcn downgrade.

The Supabase Auth security advisor reports disabled leaked-password protection. Configuration details are in the [password security guide](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

For the Moringa acceptance test, use an account eligible to interact with the development app. Message the Page, confirm that the conversation is labeled Moringa, send a text reply and verify that Messenger shows it from Moringa. Redeliver the same signed fixture and confirm that no duplicate appears. Test a closed window, a revoked token, two operator sessions and an account with no Moringa membership. Verify all four Pages individually before rollout.

FNBnB still needs to supply the actual privacy policy and data deletion instructions URLs, retention policy, business portfolio ownership/verification details, valid Page tokens and the review outcome. Set the policy URLs in Meta Basic settings and complete the Messenger App Review and Publish requirements displayed for this app. Record a reviewer walkthrough with test data showing incoming messages, restaurant labels, a manual reply and receipt. After production access is approved, test each Page with a designated account that has no app role. Public access remains unverified until those tests pass.

This build starts with newly delivered events. Historical conversation imports, profile fetching and Human Agent replies require separate product scope and permission decisions.

Implementation references include [Supabase SSR auth](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Meta webhook signatures](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/), and the [Messenger Send API](https://developers.facebook.com/docs/messenger-platform/send-messages/).
