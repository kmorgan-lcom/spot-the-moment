# Setting up Spot the Moment

No accounts for participants. They open a link and start typing.

You need one thing: a Cloudflare account, which you already have (it's the one
`maya` deploys to). Everything else is four commands.

---

## Try it right now — no login, no account

```bash
cd ~/repos/spot-the-moment
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

That serves the whole app at **http://localhost:8787/** against a local database.
It is the real thing — stickies, +1s, stages, the answer key — just only on your
machine. Your facilitator link is:

```
http://localhost:8787/?f=change-me-now
```

This is enough to rehearse the whole session. You only need the steps below when
you want other people on it.

---

## Putting it on the internet

### 1. Log in to Cloudflare (once)

```bash
npx wrangler login
```

A browser window opens, you approve, done. Your existing token has expired,
which is the only reason this step is here.

### 2. Make the database

```bash
npm run db:create
```

It prints a block ending in a `database_id`. Copy that id into `wrangler.jsonc`,
replacing the zeros:

```jsonc
"database_id": "00000000-0000-0000-0000-000000000000"
```

### 3. Set your passcode

Open `seed-private.sql` and change this line to something only you know:

```sql
insert into facilitator (id, code) values (1, 'change-me-now')
```

This file is gitignored and stays on your laptop.

### 4. Create the tables and load the answer key

```bash
npm run db:migrate
npm run db:seed
```

### 5. Deploy

```bash
npm run deploy
```

It prints your URL — something like
`https://spot-the-moment.<your-subdomain>.workers.dev`.

That URL is what you send the room. Your own link adds the passcode:

```
https://spot-the-moment.<your-subdomain>.workers.dev/?f=YOUR-PASSCODE
```

The passcode disappears from the address bar the moment the page loads, and is
remembered for that tab only — so refreshing is safe, and if you paste the URL
from your address bar it won't carry the passcode with it.

To push a change later, just `npm run deploy` again.

---

## Test it before Friday

Open **three** windows:

- **A** — your window, with `?f=YOUR-PASSCODE`. You should see the orange panel.
- **B** and **C** — two *separate* incognito windows. (Two normal tabs share an
  identity and will look like one person.)

| # | Do this | Expect |
|---|---|---|
| 1 | In B, add a sticky. | B sees it. |
| 2 | Look at C. | C does **not** see B's text — just "1 sticky from the room". |
| 3 | In A, click **Show everyone's**. | Within ~2 seconds C sees B's text. |
| 4 | In C, click **+1**. | Count goes to 1. Clicking again removes it. No double-counting. |
| 5 | In A, click **Reveal answers**. | Navy notes appear beside the marked lines; the takeaway appears at the bottom. |
| 6 | In B, try to add a sticky. | The "+ Add sticky" button is gone. |
| 7 | In A, **Open Conversation 2 for everyone**. | B and C jump to Conversation 2 on their own. |
| 8 | In A, **Clear all stickies** → **Yes, clear**. | Everything empties and both conversations return to stage 0. |
| 9 | In C at stage 0 or 1, open devtools → Network → reload → look at `/api/state`. | `answerKey` and `takeaways` are **empty**, and no other person's sticky text is in the response. |

If #9 shows anything, stop — that is the one that matters.

---

## On the day

1. Open your facilitator link. Leave both conversations on **Collect**.
2. Send the plain URL to the room.
3. A few minutes on Conversation 1 → **Show everyone's** → discuss →
   **Reveal answers**.
4. **Open Conversation 2 for everyone** and repeat.

A refresh is always safe. Identity lives in the browser, so people keep their
stickies.

---

## If something goes wrong

**"Lost the connection to the room."**
The Worker isn't reachable. The page keeps retrying every 2 seconds and
recovers on its own.

**The facilitator panel won't appear.**
The passcode in the URL doesn't match the one in the database. Re-run
`npm run db:seed` after fixing `seed-private.sql`.

**Stickies save but nobody else sees them.**
That is what **Collect** does. Click **Show everyone's**.

**Deploy fails with an auth error.**
`npx wrangler login` again.
