/* The whole back end. It serves the static page and a small JSON API, and it is
   the only place the rules are enforced — the browser is never trusted with
   anything it shouldn't already be able to see.

   Three things never leave this file unless they are allowed to:
     - another person's sticky text, before the facilitator opens stage 1
     - the answer key and takeaway, before stage 2
     - the facilitator passcode, ever

   Identity is a random id the browser makes and keeps in localStorage. Nobody
   signs in. That id decides which stickies are "yours"; it is not a password,
   and it isn't treated as one. */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const bad = (msg, status = 400) => json({ error: msg }, status);

async function getControl(env) {
  const row = await env.DB.prepare(
    "select active, stage_a, stage_b from control where id = 1"
  ).first();
  return row || { active: "A", stage_a: 0, stage_b: 0 };
}

const stageFor = (control, conv) => (conv === "B" ? control.stage_b : control.stage_a);

async function isFacilitator(env, passcode) {
  if (!passcode) return false;
  const row = await env.DB.prepare("select code from facilitator where id = 1").first();
  return !!row && row.code === passcode;
}

/* ----------------------------------------------------------------- state --- */
/* One call returns everything the caller is entitled to and nothing else. */
async function getState(env, uid) {
  const control = await getControl(env);

  const stickyRows = (await env.DB.prepare(
    "select id, conversation, line_id, body, kind, author, created_at from stickies"
  ).all()).results || [];

  // Counts are over every sticky, so stage 0 can say "3 stickies from the room"
  // while the text of those stickies stays here.
  const counts = {};
  for (const s of stickyRows) counts[s.line_id] = (counts[s.line_id] || 0) + 1;

  const visible = stickyRows.filter(
    (s) => s.author === uid || stageFor(control, s.conversation) >= 1
  );
  const visibleIds = new Set(visible.map((s) => s.id));

  const voteRows = (await env.DB.prepare("select sticky_id, voter from votes").all()).results || [];
  const votes = voteRows.filter((v) => visibleIds.has(v.sticky_id));

  // The key and the takeaway do not exist for anyone until stage 2.
  let answerKey = [];
  let takeaways = [];
  const revealed = ["A", "B"].filter((c) => stageFor(control, c) >= 2);
  if (revealed.length) {
    const marks = revealed.map(() => "?").join(",");
    answerKey = (await env.DB.prepare(
      `select line_id, note from answer_key where conversation in (${marks})`
    ).bind(...revealed).all()).results || [];
    takeaways = (await env.DB.prepare(
      `select conversation, body from takeaways where conversation in (${marks})`
    ).bind(...revealed).all()).results || [];
  }

  return {
    control: { active: control.active, A: control.stage_a, B: control.stage_b },
    stickies: visible.map((s) => ({
      id: s.id, conv: s.conversation, line: s.line_id,
      text: s.body, kind: s.kind, author: s.author, at: s.created_at,
    })),
    votes: votes.map((v) => ({ sticky: v.sticky_id, voter: v.voter })),
    counts,
    answerKey: Object.fromEntries(answerKey.map((r) => [r.line_id, r.note])),
    takeaways: Object.fromEntries(takeaways.map((r) => [r.conversation, r.body])),
  };
}

/* ---------------------------------------------------------------- writes --- */

async function addSticky(env, { uid, conversation, line_id, text, kind }) {
  if (!uid) return bad("missing id");
  if (conversation !== "A" && conversation !== "B") return bad("unknown conversation");
  if (kind !== "flag" && kind !== "good") return bad("unknown kind");
  if (!/^[AB][0-9]{1,3}$/.test(line_id || "")) return bad("bad line");
  // a line has to belong to the conversation it claims, or the stage gate below
  // could be dodged by pointing a locked line at an open conversation
  if (line_id[0] !== conversation) return bad("line is not in that conversation");

  const body = (text || "").trim();
  if (!body) return bad("empty");
  if (body.length > 160) return bad("too long");

  const control = await getControl(env);
  if (stageFor(control, conversation) >= 2) return bad("adding is closed", 403);

  await env.DB.prepare(
    "insert into stickies (id, conversation, line_id, body, kind, author, created_at) values (?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), conversation, line_id, body, kind, uid, Date.now()).run();

  return json({ ok: true });
}

async function deleteSticky(env, { uid, id }) {
  if (!uid || !id) return bad("missing id");
  const row = await env.DB.prepare("select conversation, author from stickies where id = ?").bind(id).first();
  if (!row) return json({ ok: true });
  if (row.author !== uid) return bad("not yours", 403);

  const control = await getControl(env);
  if (stageFor(control, row.conversation) >= 2) return bad("deleting is closed", 403);

  await env.DB.prepare("delete from votes where sticky_id = ?").bind(id).run();
  await env.DB.prepare("delete from stickies where id = ? and author = ?").bind(id, uid).run();
  return json({ ok: true });
}

async function addVote(env, { uid, sticky_id }) {
  if (!uid || !sticky_id) return bad("missing id");
  const row = await env.DB.prepare("select conversation, author from stickies where id = ?").bind(sticky_id).first();
  if (!row) return bad("no such sticky", 404);

  const control = await getControl(env);
  if (stageFor(control, row.conversation) < 1) return bad("voting isn't open", 403);
  if (row.author === uid) return bad("a +1 is for someone else's sticky", 403);

  // the primary key makes a second +1 from the same person a no-op
  await env.DB.prepare("insert or ignore into votes (sticky_id, voter) values (?,?)").bind(sticky_id, uid).run();
  return json({ ok: true });
}

async function removeVote(env, { uid, sticky_id }) {
  if (!uid || !sticky_id) return bad("missing id");
  await env.DB.prepare("delete from votes where sticky_id = ? and voter = ?").bind(sticky_id, uid).run();
  return json({ ok: true });
}

/* ----------------------------------------------------------- facilitator --- */

async function control(env, body) {
  if (!(await isFacilitator(env, body.passcode))) return bad("not authorized", 403);

  if (body.action === "stage") {
    const { conversation, stage } = body;
    if (conversation !== "A" && conversation !== "B") return bad("unknown conversation");
    if (![0, 1, 2].includes(stage)) return bad("unknown stage");
    const col = conversation === "A" ? "stage_a" : "stage_b";
    await env.DB.prepare(`update control set ${col} = ? where id = 1`).bind(stage).run();
    return json({ ok: true });
  }

  if (body.action === "active") {
    if (body.conversation !== "A" && body.conversation !== "B") return bad("unknown conversation");
    await env.DB.prepare("update control set active = ? where id = 1").bind(body.conversation).run();
    return json({ ok: true });
  }

  if (body.action === "clear") {
    await env.DB.prepare("delete from votes").run();
    await env.DB.prepare("delete from stickies").run();
    await env.DB.prepare("update control set active = 'A', stage_a = 0, stage_b = 0 where id = 1").run();
    return json({ ok: true });
  }

  return bad("unknown action");
}

/* ------------------------------------------------------------------ main --- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      if (url.pathname === "/api/state" && request.method === "GET") {
        return json(await getState(env, url.searchParams.get("uid") || ""));
      }

      if (request.method !== "POST") return bad("use POST", 405);
      const body = await request.json().catch(() => ({}));

      switch (url.pathname) {
        case "/api/sticky":        return await addSticky(env, body);
        case "/api/sticky/delete": return await deleteSticky(env, body);
        case "/api/vote":          return await addVote(env, body);
        case "/api/vote/delete":   return await removeVote(env, body);
        case "/api/facilitator":   return json({ ok: await isFacilitator(env, body.passcode) });
        case "/api/control":       return await control(env, body);
        default:                   return bad("not found", 404);
      }
    } catch (err) {
      return bad("server error: " + (err && err.message), 500);
    }
  },
};
