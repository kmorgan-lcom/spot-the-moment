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

Static files on GitHub Pages, with [Supabase](https://supabase.com) for shared
state. `supabase-js` loads from a CDN — there is no build step and no
`node_modules`.

Each browser gets an anonymous Supabase identity on load, which is what lets the
database tell "your stickies" from everyone else's without collecting a single
name.

| File | What's in it |
|---|---|
| `index.html` | Markup |
| `styles.css` | Learning.com brand tokens, layout, dark mode |
| `app.js` | The transcripts and the runtime |
| `config.js` | Your Supabase project URL and anon key |
| `supabase/schema.sql` | Tables, row-level security, the facilitator functions |
| `supabase/seed-private.sql` | **Not in this repo.** The answer key and passcode. |

## Security

This repo is public, so the rules are enforced in Postgres rather than in the
page. The browser holds only the anon key, and row-level security decides what
that key can actually read:

- You can read your own stickies always, everyone's only from stage 1.
- You can write a sticky only as yourself, and only before stage 2.
- The **answer key and takeaways are unreadable until that conversation reaches
  stage 2** — they are not in this repo, not in the page source, and not in any
  network response before the facilitator reveals them.
- The facilitator passcode has no read policy at all. Nothing can select it.
- Stages change only through `SECURITY DEFINER` functions that check the
  passcode and raise on a bad one.

## Setup

See **[SETUP.md](SETUP.md)** — step by step, no prior Supabase experience
assumed, with a test checklist to run before the session.
