/* Spot the Moment — the browser renders; the Worker decides. Nobody signs in:
   identity is a random id kept in localStorage, only so the page knows which
   stickies are yours. Every rule that matters is enforced in src/worker/index.js,
   which simply never sends what you aren't allowed to see. The answer-key notes
   and takeaways are deliberately absent from this file. */

const CONVS = {
  A: {
    label: "Conversation 1",
    kind: "flag",
    prompt: "<strong>Read it like you're listening in.</strong> Tap any line where the conversation is being steered, and add a sticky: what is the interviewer doing, and what does it do to what we learn?",
    lines: [
      ["i", "Thanks so much for making time — I know this time of year is a lot. Full transparency, we're working on some really exciting AI stuff right now, so I'd love to pick your brain. What's going on with AI in your district?"],
      ["d", "Oh, AI's the big one. Teachers are really worried about kids using it on their work."],
      ["i", "Yeah, I bet — that must be so frustrating for them. Is it mostly writing assignments? And is it more middle school or high school?"],
      ["d", "It is frustrating. Mostly writing, I'd say. Probably middle school."],
      ["i", "Totally makes sense. So if you had a magic wand, what would you want?"],
      ["d", "Honestly? A good AI detector. Teachers keep asking me for one."],
      ["i", "Got it. So if there were a tool that flagged AI-written work and gave teachers a report, would they use it?"],
      ["d", "Oh, absolutely. They'd love that."],
      ["i", "Awesome. And do you think that's something you'd have budget for this year?"],
      ["d", "I think so, yeah — if it worked well, I could make the case."],
      ["i", "Perfect, super helpful. And just so you know, we actually already have lessons on responsible AI use — I'll send those over too!"],
      ["d", "Oh great, that'd be great."],
    ],
  },
  B: {
    label: "Conversation 2",
    kind: "good",
    prompt: "<strong>Same district leader, same situation.</strong> Tap any line where the interviewer does something that works, and add a sticky: what did they do, and what did it get them?",
    lines: [
      ["i", "Thanks for making time. We're not selling anything today and this isn't about our product — we're trying to understand what's actually hard for districts right now, in your words. When it comes to kids and technology, what's the conversation in your district right now?"],
      ["d", "Oh, AI's the big one. Teachers are worried about kids using it on their work — honestly, they keep asking me for an AI detector."],
      ["i", "Tell me about the last time that came up."],
      ["d", "Just a few weeks ago, actually. One of our eighth grade ELA teachers gave a kid a zero on an essay because she was sure he'd used AI."],
      ["i", "What happened next?"],
      ["d", "The parent came in, pretty upset. The kid said he'd used it to brainstorm and outline, but he wrote it himself. It went to the principal and she reversed the zero."],
      ["s", "[The interviewer waits — about three seconds of silence]"],
      ["d", "…and the teacher was really upset about that. She felt like she got thrown under the bus."],
      ["i", "What made it so hard to sort out?"],
      ["d", "There wasn't really anything to point to. We don't have a policy on what's okay. The teacher down the hall lets kids brainstorm with AI; this teacher doesn't allow it at all. So who's right?"],
      ["i", "How often does something like that happen?"],
      ["d", "That was the one that blew up. Smaller versions? Probably every week. Every teacher's kind of making up their own rules."],
      ["i", "What does that leave your teachers dealing with?"],
      ["d", "Honestly, a lot of them have just stopped assigning writing at home. They do it all in class, on paper, so they don't have to deal with it. And nobody's actually teaching the kids where the line is. We punish them for crossing a line we never drew."],
      ["i", "[pause] Tell me more about that part."],
      ["d", "The kids are going to use this stuff — whatever job they end up in, it'll be there. Right now the only thing they're learning from us is \"don't get caught.\""],
      ["i", "Who in the district would say that's their responsibility?"],
      ["d", "That's the thing — nobody, really. Tech thinks it's instructional. Instruction thinks it's a policy thing. The board wants a policy, but nobody's written one."],
      ["i", "Of everything we've talked about, which is the biggest problem for you? Why that one?"],
      ["d", "The rules. Or really, that there aren't any. A detector would just give us more zeros to argue about."],
    ],
  },
};
const STAGE_BTN = ["Collect", "Show everyone's", "Reveal answers"];

const state = {
  tab: "A",
  control: { active: "A", A: 0, B: 0 },
  stickies: [],     // {id, conv, line, text, author, at, kind}
  votes: [],        // {sticky, voter}
  counts: {},       // lineId -> total stickies on that line, from sticky_counts()
  answerKey: {},    // lineId -> note, only readable at stage 2
  takeaways: {},    // conv -> text, only readable at stage 2
  uid: null,
  canWrite: true,
  isFac: false,
  facPass: null,
  openComposer: null,
  offline: false,
  notice: null,
};

const API = "/api";

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach((c) => c && n.append(c));
  return n;
};
const announce = (msg) => { $("#live").textContent = msg; };

function stageOf(conv) { return state.control[conv] || 0; }
function bUnlocked() { return state.control.active === "B" || state.isFac; }

/* ---------- render ---------- */
function render() {
  const conv = CONVS[state.tab];
  const stage = stageOf(state.tab);

  for (const t of document.querySelectorAll(".tab")) {
    const c = t.dataset.conv;
    t.setAttribute("aria-selected", String(c === state.tab));
    t.tabIndex = c === state.tab ? 0 : -1;
    const locked = c === "B" && !bUnlocked();
    t.disabled = locked;
    t.textContent = CONVS[c].label;
    if (locked) t.append(el("span", { class: "lock", text: "· opens soon" }));
  }

  const notice = $("#notice");
  if (state.notice) { notice.hidden = false; notice.textContent = state.notice; }
  else notice.hidden = true;

  const lines = $("#lines");
  lines.replaceChildren();
  conv.lines.forEach(([who, said], i) => {
    const lineId = state.tab + (i + 1);
    const mine = state.stickies.filter((s) => s.line === lineId && s.author && s.author === state.uid);
    const all = state.stickies.filter((s) => s.line === lineId);
    const shown = stage >= 1 ? all : mine;

    const whoLabel = who === "i" || who === "s" ? "Interviewer" : "District leader";
    const left = el("div", { class: "line" },
      el("div", { class: "who" + (who !== "d" ? " int" : ""), text: whoLabel }),
      el("p", { class: "said" + (who === "s" ? " stage" : ""), text: said }),
    );

    const side = el("div", { class: "side" });
    const key = state.answerKey[lineId];
    if (stage >= 2 && key) side.append(el("div", { class: "key" }, el("b", { text: "What's happening" }), key));

    if (shown.length) {
      const wrap = el("div", { class: "stickies" });
      const ranked = shown.slice().sort((a, b) => voteCount(b.id) - voteCount(a.id) || a.at - b.at);
      ranked.forEach((s) => wrap.append(stickyEl(s, stage)));
      side.append(wrap);
    }

    // At stage 0 the room's stickies stay hidden, so the count comes from a
    // function that returns totals without the text.
    const others = stage === 0 ? (state.counts[lineId] || 0) - mine.length : all.length - mine.length;
    if (stage === 0 && others > 0) side.append(el("div", { class: "count" }, el("b", { text: String(others) }), others === 1 ? " sticky from the room" : " stickies from the room"));

    if (stage < 2 && state.canWrite) {
      if (state.openComposer === lineId) side.append(composerEl(lineId, conv.kind));
      else side.append(el("button", { class: "add", type: "button", "aria-label": `Add a sticky to line ${i + 1}`, onclick: () => { state.openComposer = lineId; render(); const ta = document.getElementById("ta-" + lineId); ta && ta.focus(); } }, "+ Add sticky"));
    }

    lines.append(el("div", { class: "row" }, left, side));
  });

  const tk = $("#takeaway");
  const takeaway = state.takeaways[state.tab];
  tk.hidden = stage < 2 || !takeaway;
  $("#takeawayText").textContent = takeaway || "";

  renderFac();
}

function voteCount(id) { return state.votes.filter((v) => v.sticky === id).length; }
function iVoted(id) { return state.votes.some((v) => v.sticky === id && v.voter === state.uid); }

function stickyEl(s, stage) {
  const isMine = s.author && s.author === state.uid;
  const n = voteCount(s.id);
  const card = el("div", { class: "sticky" + (s.kind === "good" ? " good" : "") }, el("span", { text: s.text }));
  const meta = el("div", { class: "meta" });
  if (isMine) {
    meta.append(el("span", { class: "mine", text: "Yours" }));
    if (stage < 2 && state.canWrite) meta.append(el("button", { type: "button", "aria-label": "Delete your sticky", onclick: () => removeSticky(s) }, "Delete"));
    if (n) meta.append(el("span", { text: `+${n}` }));
  } else if (stage >= 1) {
    const voted = iVoted(s.id);
    meta.append(el("button", { type: "button", "aria-pressed": String(voted), "aria-label": voted ? `Remove your +1, ${n} total` : `Add +1, ${n} so far`, disabled: !state.canWrite || !state.uid, onclick: () => toggleVote(s) }, `+1${n ? " · " + n : ""}`));
  }
  if (meta.childNodes.length) card.append(meta);
  return card;
}

function composerEl(lineId, kind) {
  const ta = el("textarea", { id: "ta-" + lineId, maxlength: "160", placeholder: kind === "good" ? "What did they do? What did it get them?" : "What's the interviewer doing here?", "aria-label": "Your sticky" });
  const save = async () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    state.openComposer = null;
    await addSticky(lineId, text, kind);
  };
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
    if (e.key === "Escape") { state.openComposer = null; render(); }
  });
  return el("div", { class: "composer" + (kind === "good" ? " good" : "") }, ta,
    el("div", { class: "acts" },
      el("button", { class: "btn primary", type: "button", onclick: save }, "Add sticky"),
      el("button", { class: "btn", type: "button", onclick: () => { state.openComposer = null; render(); } }, "Cancel"),
      el("span", { class: "hint", text: "Enter to add" }),
    ));
}

/* ---------- facilitator ---------- */
function renderFac() {
  const fac = $("#fac");
  fac.hidden = !state.isFac;
  if (!state.isFac) return;
  for (const seg of fac.querySelectorAll(".seg")) {
    const c = seg.dataset.conv;
    seg.replaceChildren(...STAGE_BTN.map((label, i) => el("button", { type: "button", "aria-pressed": String(stageOf(c) === i), onclick: () => setStage(c, i) }, label)));
  }
  const ub = $("#unlockB");
  ub.textContent = state.control.active === "B" ? "Lock Conversation 2" : "Open Conversation 2 for everyone";
  ub.className = state.control.active === "B" ? "btn" : "btn primary";
  const a = state.stickies.filter((s) => s.conv === "A").length, b = state.stickies.filter((s) => s.conv === "B").length;
  const people = new Set(state.stickies.map((s) => s.author).filter(Boolean)).size;
  $("#facStats").textContent = `${a} stickies on 1 · ${b} on 2 · from ${people} ${people === 1 ? "person" : "people"}`;
}

async function setStage(conv, stage) {
  state.control = { ...state.control, [conv]: stage };
  render();
  try { await api("/control", { passcode: state.facPass, action: "stage", conversation: conv, stage }); }
  catch (e) { announce("Couldn't update the room. Try again."); }
  await refetchAll();
}

async function setActive(conv) {
  state.control = { ...state.control, active: conv };
  render();
  try { await api("/control", { passcode: state.facPass, action: "active", conversation: conv }); }
  catch (e) { announce("Couldn't update the room. Try again."); }
  await refetchAll();
}

$("#unlockB").addEventListener("click", () => {
  const opening = state.control.active !== "B";
  setActive(opening ? "B" : "A");
  if (opening) { state.tab = "B"; render(); }
});
$("#clearBtn").addEventListener("click", () => { $("#clearConfirm").hidden = false; $("#clearBtn").hidden = true; $("#clearYes").focus(); });
$("#clearNo").addEventListener("click", () => { $("#clearConfirm").hidden = true; $("#clearBtn").hidden = false; });
$("#clearYes").addEventListener("click", async () => {
  $("#clearConfirm").hidden = true; $("#clearBtn").hidden = false;
  try {
    await api("/control", { passcode: state.facPass, action: "clear" });
    state.tab = "A";
    await refetchAll();
    announce("All stickies cleared.");
  } catch (e) { announce("Couldn't clear the room. Try again."); }
});

/* ---------- writes ---------- */
async function addSticky(lineId, text, kind) {
  const conv = lineId[0];
  try {
    await api("/sticky", { conversation: conv, line_id: lineId, text, kind });
    announce("Sticky added.");
    await refetchAll();
  } catch (e) { announce("That sticky didn't save. Try again."); }
}
async function removeSticky(s) {
  try {
    await api("/sticky/delete", { id: s.id });
    announce("Sticky deleted.");
    await refetchAll();
  } catch (e) { announce("Couldn't delete that sticky."); }
}
async function toggleVote(s) {
  if (!state.uid) return;
  try {
    await api(iVoted(s.id) ? "/vote/delete" : "/vote", { sticky_id: s.id });
    await refetchAll();
  } catch (e) { announce("Couldn't record that +1."); }
}

/* ---------- tabs ---------- */
for (const t of document.querySelectorAll(".tab")) {
  t.addEventListener("click", () => { if (t.disabled) return; state.tab = t.dataset.conv; state.openComposer = null; render(); });
  t.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = state.tab === "A" ? "B" : "A";
    if (next === "B" && !bUnlocked()) return;
    state.tab = next; state.openComposer = null; render(); document.getElementById("tab" + next).focus();
  });
}

render();

/* ---------- talking to the Worker ---------- */
async function api(path, body) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uid: state.uid, ...body }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "failed");
  return res.json();
}

async function refetchAll() {
  try {
    const res = await fetch(`${API}/state?uid=${encodeURIComponent(state.uid)}`, { cache: "no-store" });
    if (!res.ok) throw new Error("state");
    const s = await res.json();

    const prev = state.control.active;
    state.control = s.control;
    state.stickies = s.stickies;
    state.votes = s.votes;
    state.counts = s.counts;
    state.answerKey = s.answerKey;
    state.takeaways = s.takeaways;

    if (prev !== "B" && state.control.active === "B" && !state.isFac) {
      state.tab = "B"; state.openComposer = null; announce("Conversation 2 is open.");
    }
    if (state.control.active !== "B" && !state.isFac && state.tab === "B") state.tab = "A";

    if (state.notice) { state.notice = null; }
    keepComposerRender();
  } catch (e) {
    state.notice = "Lost the connection to the room. Still trying…";
    render();
  }
}

/* ---------- connect ---------- */
(async () => {
  // No accounts. A random id in localStorage is what makes "your stickies" mean
  // something; it survives a refresh, which is why a reload never loses your work.
  let uid = null;
  try { uid = localStorage.getItem("spot-uid"); } catch (e) {}
  if (!uid) {
    uid = (crypto.randomUUID && crypto.randomUUID()) ||
          String(Date.now()) + Math.random().toString(36).slice(2);
    try { localStorage.setItem("spot-uid", uid); } catch (e) {}
  }
  state.uid = uid;

  // ?f=<passcode> turns on the facilitator panel. The passcode is checked by the
  // Worker, kept for this tab so a refresh keeps the panel, and wiped from the
  // address bar so it isn't read over a shoulder or shared by copying the URL.
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get("f");
  const pass = fromUrl || sessionStorage.getItem("spot-fac");
  if (fromUrl) {
    params.delete("f");
    const q = params.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
  }
  if (pass) {
    try {
      const r = await api("/facilitator", { passcode: pass });
      if (r.ok) { state.isFac = true; state.facPass = pass; sessionStorage.setItem("spot-fac", pass); }
      else sessionStorage.removeItem("spot-fac");
    } catch (e) { sessionStorage.removeItem("spot-fac"); }
  }

  await refetchAll();
  render();

  // Polling is the whole sync mechanism. Two seconds is well inside what a
  // conversation tolerates, and it has no connection to drop.
  setInterval(refetchAll, 2000);
})();

/* re-render without losing a half-typed sticky */
function keepComposerRender() {
  const open = state.openComposer;
  const ta = open ? document.getElementById("ta-" + open) : null;
  const draft = ta ? ta.value : null;
  const hadFocus = ta && document.activeElement === ta;
  const pos = ta ? ta.selectionStart : 0;
  render();
  if (open && draft !== null) {
    const nta = document.getElementById("ta-" + open);
    if (nta) { nta.value = draft; if (hadFocus) { nta.focus(); nta.setSelectionRange(pos, pos); } }
  }
}
