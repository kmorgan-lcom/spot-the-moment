# Setting up Spot the Moment

Everything below is done in a browser. There is nothing to install and no build
step. Budget about 20 minutes the first time.

You will need two browser tabs open throughout: this repo on GitHub, and your
new Supabase project.

---

## 1. Create a free Supabase project

1. Go to **https://supabase.com** and sign up (GitHub sign-in is fastest).
2. Click **New project**.
3. Give it a name (`spot-the-moment` is fine) and pick a region near you.
4. It will ask you to set a **database password**. Save it in your password
   manager. You will not need it for this setup, but you cannot recover it.
5. Click **Create new project** and wait about two minutes for it to finish
   building.

---

## 2. Turn on anonymous sign-ins

Participants never make an account. Instead, the page quietly issues each
browser an anonymous identity so the database can tell "your stickies" from
everyone else's. This is off by default.

1. In the left sidebar: **Authentication**.
2. Click **Sign In / Providers**.
3. Find **Anonymous sign-ins** and switch it **on**. Save.

---

## 3. Raise the anonymous sign-in rate limit

Everyone in the room is probably on one office wifi network, which means
Supabase sees one IP address making thirty sign-ins in two minutes. The default
limit is low enough that the last people to open the link would be turned away.

1. Still under **Authentication**, click **Rate Limits**.
2. Find the limit for **anonymous sign-ins** (shown per hour).
3. Raise it well above your room size — **200** is a comfortable setting for a
   30-person workshop, and costs nothing.
4. Save.

> If you skip this, the symptom on the day is that some people see
> "Couldn't join the room" while others are fine.

---

## 4. Create the tables

1. In the left sidebar: **SQL Editor**.
2. Click **New query**.
3. Open `supabase/schema.sql` from this repo, copy the whole file, paste it in,
   and click **Run**. It should say success. It is safe to run more than once.

Now the private half:

4. Open `supabase/seed-private.sql` from your local copy of this repo.
   **This file is not on GitHub and must never be** — it holds the answer key
   and your passcode.
5. Find this line near the top and replace the passcode with something long and
   random (a password manager's generator is ideal — 20+ characters):

   ```sql
   values (1, 'CHANGE-ME-to-something-long-and-random')
   ```

   Save the passcode somewhere you can find it on Friday. Anyone who has it can
   reveal the answers, so don't put it in the meeting invite.
6. Copy the whole edited file into a **New query** and click **Run**.

---

## 5. Point the page at your project

1. In the Supabase sidebar: **Project Settings** → **API**.
2. Copy the **Project URL** and the **anon / public** key.
3. Open `config.js` in this repo and paste them in:

   ```js
   window.SPOT_CONFIG = {
     SUPABASE_URL: "https://abcdefgh.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi...",
   };
   ```

4. Commit and push that change.

> The anon key is **meant** to be public — it is in the page source of every
> Supabase site on the web. It grants nothing on its own; the rules in
> `schema.sql` decide what it can actually see. Do not paste the
> **`service_role`** key here, which is a different key on the same page and
> does bypass everything.

---

## 6. Turn on GitHub Pages

1. In the GitHub repo: **Settings** → **Pages**.
2. Under **Source**, choose **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)**. Save.
4. Wait a minute, then reload. GitHub shows the live URL at the top of that
   page — something like `https://kmorgan-lcom.github.io/spot-the-moment/`.

That URL is what you send the room.

To open your own facilitator controls, add your passcode to the end:

```
https://kmorgan-lcom.github.io/spot-the-moment/?f=YOUR-PASSCODE
```

The passcode disappears from the address bar as soon as the page loads, and it
is remembered for that tab only — so you can refresh safely, but a participant
glancing at your screen won't see it, and if you accidentally share the URL from
your address bar it won't carry the passcode with it.

---

## 7. Test it before Friday

Do this once, end to end. It takes five minutes and it is the difference
between a smooth session and a live debug.

Open **three** windows:

- **A** — your normal window, with `?f=YOUR-PASSCODE`. You should see the
  orange facilitator panel.
- **B** and **C** — two *separate* incognito/private windows. These are your
  two participants. (Two normal tabs share an identity and will look like one
  person; incognito windows do not.)

Then check each of these:

| # | Do this | Expect |
|---|---|---|
| 1 | In B, add a sticky to a line. | B sees its own sticky. |
| 2 | Look at C. | C does **not** see B's text — just "1 sticky from the room". |
| 3 | In A, click **Show everyone's** for Conversation 1. | Within ~3 seconds, C sees B's sticky text appear. |
| 4 | In C, click **+1** on B's sticky. | The count goes to 1. Clicking again removes it. C cannot +1 twice. |
| 5 | In A, click **Reveal answers**. | Navy "What's happening" notes appear beside the marked lines, and the takeaway appears at the bottom. |
| 6 | In B, try to add a sticky. | The "+ Add sticky" button is gone. |
| 7 | In A, click **Open Conversation 2 for everyone**. | B and C both jump to Conversation 2 on their own. |
| 8 | In A, click **Clear all stickies** → **Yes, clear**. | Everything empties everywhere and both conversations go back to stage 0. |

Then the two that matter most, because the repo is public:

| # | Do this | Expect |
|---|---|---|
| 9 | In C (a participant, at stage 0 or 1), open the browser devtools **Network** tab and reload. Look at the responses. | The answer-key request comes back **empty**. No notes, no takeaways. |
| 10 | View source on the live page, and search the repo on GitHub for a phrase from an answer note. | **Nothing.** The notes exist only in your database, and only unlock at stage 2. |

If #9 or #10 shows anything, stop and check that you ran `schema.sql` and did
not accidentally commit `seed-private.sql`.

---

## On the day

1. Open the facilitator link. Leave both conversations on **Collect**.
2. Send the plain link to the room.
3. Give them a few minutes on Conversation 1, then **Show everyone's**, discuss,
   then **Reveal answers**.
4. **Open Conversation 2 for everyone** and repeat.

If someone says the page looks stuck, a refresh is always safe — their stickies
and their identity survive it.

---

## If something goes wrong

**"This page isn't connected to its database yet."**
`config.js` still has the placeholder values, or the push hadn't finished
deploying. Check step 5, then give Pages a minute.

**"Couldn't join the room."**
Anonymous sign-ins are off (step 2) or the rate limit was hit (step 3).

**Stickies save but nobody else ever sees them.**
The stage is still 0 — that is what stage 0 does. Click **Show everyone's**.

**The facilitator panel won't appear.**
The passcode in the URL doesn't match the one you seeded. Re-run the passcode
line from step 4, then reopen the link with `?f=` and the new value.

**Everything is slow or stale.**
The page refetches every 3 seconds regardless of the live connection, so worst
case is a three-second delay. If it is worse than that, the browser is offline.
