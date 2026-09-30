# Spot the Moment

A 30-minute workshop activity for Learning.com's Listening Tour prep.

Two versions of the same district interview sit side by side. Participants read
a transcript, tap any line where something is happening, and add an anonymous
sticky saying what they see. The facilitator walks the room through three
stages per conversation:

| Stage | What people see |
|---|---|
| **Collect** | Only your own stickies, plus a count of everyone else's — "3 stickies from the room" — without the text. |
| **Show everyone's** | All stickies, visible to all. You can +1 someone else's; the most-agreed rise to the top. |
| **Reveal answers** | Adding closes. The answer key appears beside each line that has one, and the conversation's takeaway appears at the bottom. |

Conversation 2 stays locked until the facilitator opens it, at which point
every screen in the room switches to it.

**Nobody signs in.** Participants open a link. That's the whole onboarding.

## How it works

One Cloudflare Worker serves the page *and* a small JSON API, with a D1 (SQLite)
database behind it. No build step, no framework, no bundler — `public/` ships
as-is. `npm run deploy` is the whole pipeline.

Nobody signs in. Each browser makes a random id and keeps it in `localStorage`,
which is all that's needed to know which stickies are yours. No names, no
accounts, no email.

| File | What's in it |
|---|---|
| `public/index.html` | Markup |
| `public/styles.css` | Learning.com brand tokens, layout, dark mode |
| `public/app.js` | The transcripts and the runtime |
| `src/worker/index.js` | The API, and every rule worth enforcing |
| `migrations/0001_init.sql` | Tables |
| `seed-private.sql` | **Not in this repo.** The answer key, takeaways and passcode. |

## Security

Rules live in the Worker, not the page. The server simply never sends what you
aren't entitled to:

- Another person's sticky **text** doesn't leave the server until stage 1. At
  stage 0 you get a count and nothing more.
- The **answer key and takeaways don't leave the server until stage 2** — they
  are not in this repo, not in the page source, and not in any network response
  before the facilitator reveals them.
- The **passcode never leaves the server.** Stage changes are refused without it.
- Adding and deleting are refused after stage 2; a +1 is refused on your own
  sticky, and twice on anyone's.

Identity is a browser-generated id, not a credential — this is a workshop for
colleagues, not a system with adversaries. It decides whose stickies are whose;
it is not relied on for anything secret.

## Setup

```bash
npm install && npm run db:migrate:local && npm run db:seed:local && npm run dev
```

That runs the whole thing at http://localhost:8787/ with **no Cloudflare login
and no account**. See **[SETUP.md](SETUP.md)** for deploying it so other people
can join, plus a test checklist to run before the session.
