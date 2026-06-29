// Host screen client (laptop / iPad). Renders PUBLIC state per mode + phase.
// No secrets here — never shows the imposter's word or who voted for what.
const socket = io();
const app = document.getElementById("app");
let created = null;
const logo = `<div class="logo"><span class="cu">C U</span> Next Tuesday</div>`;
function renderConnecting(msg) {
  app.innerHTML = `<div class="center stack" style="margin-top:16%">${logo}<div class="muted" style="margin-top:18px">${msg}</div></div>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
socket.on("host:error", toast);

// Render something immediately — never a blank screen while the socket connects.
renderConnecting("Warming up…");
// (Re)create the room on every connect, so a dropped connection or a free-tier
// cold start recovers on its own instead of leaving the screen stuck blank.
socket.on("connect", () => { renderConnecting("Setting up the room…"); socket.emit("host:create"); });
socket.on("connect_error", () => renderConnecting("Can't reach the server — retrying. A free host can take ~30s to wake up."));
socket.on("disconnect", () => renderConnecting("Connection dropped — reconnecting…"));
socket.on("host:created", (d) => (created = d));

socket.on("host:state", (s) => {
  if (s.phase === "LOBBY") render.lobby(s);
  else if (s.phase === "WRITE") render.write(s);
  else if (s.phase === "VOTE") render.vote(s);
  else if (s.phase === "JUDGE") render.judge(s);
  else if (s.phase === "REVEAL") render.reveal(s);
  else if (s.phase === "GAMEOVER") render.gameover(s);
});

const roundPill = (s) => `<div class="pill mono">Round ${s.round} / ${s.totalRounds}</div>`;
const term = (txt, size = "clamp(42px,8vw,96px)") => `<div class="term" style="font-size:${size}">${esc(txt)}</div>`;
const blank = (text) => `<div style="font-size:clamp(28px,5vw,56px);font-weight:800;line-height:1.15;letter-spacing:-0.02em">${esc(text).replace(/_{2,}/g, '<span style="color:var(--accent)">______</span>')}</div>`;
const chips = (submitted = [], waiting = [], mark = "✓") =>
  `<div class="row" style="justify-content:center">
    ${submitted.map((n) => `<div class="chip on">${esc(n)} ${mark}</div>`).join("")}
    ${waiting.map((n) => `<div class="chip">${esc(n)}…</div>`).join("")}
  </div>`;
const skipBtn = (label) => `<button class="ghost" id="skip" style="width:auto;margin:18px auto 0">${label} →</button>`;
const wireSkip = () => { const b = document.getElementById("skip"); if (b) b.onclick = () => socket.emit("host:next"); };

const render = {
  lobby(s) {
    const m = s.modes.find((x) => x.id === s.mode);
    const selDecks = new Set(s.settings.deckIds);
    app.innerHTML = `
      <div class="spread" style="margin-bottom:28px">${logo}
        <div class="row">
          <button class="ghost" id="minus" style="width:auto">–</button>
          <div class="pill mono">${s.settings.rounds} rounds</div>
          <button class="ghost" id="plus" style="width:auto">+</button>
        </div>
      </div>

      <div class="stack-lg">
        <div class="stack">
          <div class="kicker">Pick your game</div>
          <div class="grid-decks">
            ${s.modes
              .map(
                (md) => `<div class="deck ${md.id === s.mode ? "sel" : ""}" data-mode="${md.id}">
                  <div class="nm">${esc(md.name)}</div>
                  <div class="tl">${esc(md.tagline)}</div>
                  <div class="tl mono" style="margin-top:8px">${md.minPlayers}+ players</div>
                </div>`
              )
              .join("")}
          </div>
        </div>

        <div style="display:grid;gap:32px;grid-template-columns:1fr;align-items:start">
          <div class="card center stack" style="justify-self:center;max-width:420px;width:100%">
            <div class="kicker">Join on your phone</div>
            ${created?.qr ? `<img class="qr" style="margin:0 auto" src="${created.qr}" alt="Join QR" />` : ""}
            <div class="joincode">${esc(s.code)}</div>
            <div class="muted" style="font-size:14px">${created ? esc(created.joinUrl.replace(/^https?:\/\//, "")) : ""}</div>
          </div>

          ${
            m?.needsDecks
              ? `<div class="stack"><div class="kicker">Decks in play — tap to toggle</div>
                  <div class="grid-decks">
                    ${s.decks
                      .map(
                        (d) => `<div class="deck ${selDecks.has(d.id) ? "sel" : ""}" data-deck="${d.id}">
                          <div class="spread"><div class="nm">${esc(d.name)}</div>${d.nsfw ? `<div class="nsfw">18+</div>` : ""}</div>
                          <div class="tl">${esc(d.tagline)}</div>
                          <div class="tl mono" style="margin-top:8px">${d.count} cards</div>
                        </div>`
                      )
                      .join("")}
                  </div></div>`
              : `<div class="stack center">
                  <div class="kicker">Filth level</div>
                  <button class="${s.settings.spicy ? "accent" : "ghost"}" id="spicy" style="max-width:320px;margin:0 auto">${s.settings.spicy ? "🔞 Sending it (18+ unlocked)" : "😇 Keeping it clean — tap to send it"}</button>
                </div>`
          }
        </div>

        <div class="stack">
          <div class="kicker">Players (${s.players.length})</div>
          <div class="row">${s.players.length ? s.players.map((p) => `<div class="chip">${esc(p.name)}</div>`).join("") : `<div class="waiting">Waiting for legends to join…</div>`}</div>
          <button class="accent" id="start" ${s.players.length < (m?.minPlayers || 2) ? "disabled" : ""}>${
      s.players.length < (m?.minPlayers || 2) ? `Need ${m?.minPlayers || 2}+ players` : "Start the carnage"
    }</button>
        </div>
      </div>
      <div class="foot">Phones private · big screen public · what happens at the table stays at the table</div>`;

    document.querySelectorAll("[data-mode]").forEach((el) => (el.onclick = () => socket.emit("host:settings", { mode: el.dataset.mode })));
    document.querySelectorAll("[data-deck]").forEach((el) =>
      (el.onclick = () => {
        const next = new Set(s.settings.deckIds);
        next.has(el.dataset.deck) ? next.delete(el.dataset.deck) : next.add(el.dataset.deck);
        if (!next.size) return toast("Pick at least one deck.");
        socket.emit("host:settings", { deckIds: [...next] });
      })
    );
    const sp = document.getElementById("spicy");
    if (sp) sp.onclick = () => socket.emit("host:settings", { spicy: !s.settings.spicy });
    document.getElementById("minus").onclick = () => socket.emit("host:settings", { rounds: s.settings.rounds - 1 });
    document.getElementById("plus").onclick = () => socket.emit("host:settings", { rounds: s.settings.rounds + 1 });
    document.getElementById("start").onclick = () => socket.emit("host:start");
  },

  write(s) {
    let body;
    if (s.mode === "fillgap")
      body = `<div class="kicker">👑 ${esc(s.czarName)} is judging · everyone else fills the gap</div>
        <div style="max-width:900px;margin:18px auto">${blank(s.prompt)}</div>`;
    else if (s.mode === "imposter")
      body = `<div class="kicker">Secret word's on your phones · one of you is the Mole</div>
        <div class="muted" style="margin-top:14px">Category</div>${term(s.category)}
        <div class="muted" style="margin-top:8px">Everyone: give one clue word.</div>`;
    else
      body = `<div class="kicker">Everyone: invent a definition for</div>${term(s.term)}<div class="muted">On your phones now. Make it believable.</div>`;

    app.innerHTML = `<div class="spread" style="margin-bottom:48px">${logo}${roundPill(s)}</div>
      <div class="center stack-lg" style="margin-top:3%">${body}
        ${chips(s.submitted, s.waitingOn, "✍️")}${skipBtn("Skip the stragglers")}</div>`;
    wireSkip();
  },

  vote(s) {
    let body;
    if (s.mode === "imposter") {
      body = `<div class="center" style="margin-bottom:24px"><div class="kicker">Sniff out the Mole · category: ${esc(s.category)}</div></div>
        <div class="stack" style="max-width:760px;margin:0 auto">
          ${s.clues.map((c) => `<div class="opt spread"><span>${esc(c.clue)}</span><span class="muted" style="font-size:15px">${esc(c.name)}</span></div>`).join("")}
        </div>`;
    } else if (s.mode === "finger") {
      body = `<div class="center"><div class="kicker">Point the finger</div><div style="max-width:900px;margin:16px auto">${term(s.prompt, "clamp(30px,5vw,60px)")}</div>
        <div class="muted">Vote on your phones.</div></div>`;
    } else {
      body = `<div class="center" style="margin-bottom:24px"><div class="kicker">Which one's the truth?</div>${term(s.term, "clamp(34px,6vw,72px)")}</div>
        <div class="stack" style="max-width:820px;margin:0 auto">${s.options.map((o) => `<div class="opt">${esc(o.text)}</div>`).join("")}</div>`;
    }
    app.innerHTML = `<div class="spread" style="margin-bottom:32px">${logo}${roundPill(s)}</div>${body}
      <div class="center stack" style="margin-top:26px">${chips(s.voted, s.waitingOn)}${skipBtn("Reveal now")}</div>`;
    wireSkip();
  },

  judge(s) {
    app.innerHTML = `<div class="spread" style="margin-bottom:24px">${logo}${roundPill(s)}</div>
      <div class="center" style="margin-bottom:8px"><div class="kicker">👑 ${esc(s.czarName)} is crowning a winner</div></div>
      <div style="max-width:900px;margin:0 auto 28px">${blank(s.prompt)}</div>
      <div class="stack" style="max-width:820px;margin:0 auto">${s.options.map((o) => `<div class="opt">${esc(o.text)}</div>`).join("")}</div>
      <div class="center"><div class="waiting" style="margin-top:22px">Waiting on the judge…</div></div>`;
  },

  reveal(s) {
    const r = s.reveal;
    let body;
    if (r.kind === "bluff") {
      body = `<div class="center" style="margin-bottom:20px"><div class="kicker">${esc(r.term)} — the truth was</div></div>
        ${revealGrid(
          r.options
            .map(
              (o) => `<div class="opt ${o.isTruth ? "truth" : ""}">
                ${o.isTruth ? `<div class="badge-truth">✓ The real one</div>` : ""}
                <div style="margin-top:${o.isTruth ? 6 : 0}px">${esc(o.text)}</div>
                <div class="who">${o.isTruth ? "" : `by <span class="name">${esc(o.authorName)}</span> · `}${o.voters.length ? "fooled: " + o.voters.map((v) => `<span class="name">${esc(v)}</span>`).join(", ") : o.isTruth ? "nobody spotted it" : "fooled nobody"}</div>
              </div>`
            )
            .join(""),
          s
        )}`;
    } else if (r.kind === "fillgap") {
      body = `<div class="center" style="margin-bottom:14px"><div class="kicker">👑 ${esc(r.czarName)} picked</div></div>
        <div style="max-width:760px;margin:0 auto 18px">${blank(r.prompt)}</div>
        ${revealGrid(
          r.options
            .map(
              (o) => `<div class="opt ${o.won ? "truth" : ""}">${o.won ? `<div class="badge-truth">👑 Winner</div>` : ""}
                <div style="margin-top:${o.won ? 6 : 0}px">${esc(o.text)}</div>
                <div class="who">by <span class="name">${esc(o.authorName)}</span></div></div>`
            )
            .join(""),
          s
        )}`;
    } else if (r.kind === "imposter") {
      body = `<div class="center stack" style="margin-bottom:18px">
          <div class="kicker">${r.caught ? "Mole busted 🎯" : "The Mole got away 🕵️"}</div>
          <div class="big" style="font-size:clamp(36px,7vw,84px)">${esc(r.moleName)}</div>
          <div class="muted">was the Mole · the word was <span style="color:var(--truth);font-weight:700">${esc(r.word)}</span></div>
        </div>
        ${revealGrid(
          r.clues
            .map((c) => `<div class="opt ${c.isMole ? "truth" : ""}">${c.isMole ? `<div class="badge-truth">🕵️ The Mole</div>` : ""}<div class="spread" style="margin-top:${c.isMole ? 6 : 0}px"><span style="font-weight:700">${esc(c.clue)}</span><span class="muted">${esc(c.name)}</span></div></div>`)
            .join(""),
          s
        )}`;
    } else if (r.kind === "finger") {
      const maxV = Math.max(1, ...r.tally.map((t) => t.votes));
      body = `<div class="center stack" style="margin-bottom:18px"><div class="kicker">The group has spoken</div>
          <div style="max-width:820px;margin:0 auto">${term(r.prompt, "clamp(24px,4vw,44px)")}</div>
          <div class="big" style="font-size:clamp(34px,7vw,80px);color:var(--accent)">👉 ${esc(r.crowned.join(" & "))}</div></div>
        <div style="display:grid;gap:28px;grid-template-columns:1.3fr 1fr;align-items:start">
          <div class="stack">${r.tally
            .map((t) => `<div class="spread"><span style="width:30%">${esc(t.name)}</span><span class="grow" style="height:18px;background:var(--card);border-radius:9px;overflow:hidden"><span style="display:block;height:100%;width:${(t.votes / maxV) * 100}%;background:var(--accent)"></span></span><span class="mono" style="width:36px;text-align:right">${t.votes}</span></div>`)
            .join("")}</div>
          <div class="stack"><div class="kicker">Scoreboard</div>${scoreList(s.scores)}${nextBtn(s)}</div>
        </div>`;
      app.innerHTML = `<div class="spread" style="margin-bottom:20px">${logo}${roundPill(s)}</div>${body}`;
      document.getElementById("next").onclick = () => socket.emit("host:next");
      return;
    }
    app.innerHTML = `<div class="spread" style="margin-bottom:20px">${logo}${roundPill(s)}</div>${body}`;
    document.getElementById("next").onclick = () => socket.emit("host:next");
  },

  gameover(s) {
    const w = s.scores[0];
    app.innerHTML = `<div class="spread" style="margin-bottom:36px">${logo}<div class="pill">Game over</div></div>
      <div class="center stack-lg" style="margin-top:2%">
        <div class="kicker">The biggest menace at the table</div>
        <div class="big">🏆 ${esc(w ? w.name : "—")}</div>
        <div class="stack" style="max-width:560px;margin:0 auto;width:100%">${scoreList(s.scores)}</div>
        <button class="accent" id="again" style="max-width:320px;margin:16px auto 0">Run it back</button>
      </div>`;
    document.getElementById("again").onclick = () => socket.emit("host:again");
  },
};

// Reveal layout: option list on the left, scoreboard + next on the right.
function revealGrid(optionsHtml, s) {
  return `<div style="display:grid;gap:32px;grid-template-columns:1.4fr 1fr;align-items:start">
    <div class="stack" style="max-width:760px">${optionsHtml}</div>
    <div class="stack"><div class="kicker">Scoreboard</div>${scoreList(s.scores)}${nextBtn(s)}</div>
  </div>`;
}
const nextBtn = (s) => `<button class="accent" id="next">${s.round >= s.totalRounds ? "Final scores" : "Next round"} →</button>`;

function scoreList(scores) {
  return `<div class="stack" style="width:100%">${(scores || [])
    .map((p, i) => `<div class="score-row ${i === 0 ? "lead" : ""}"><span><span class="rank">${i + 1}</span><span class="nm">${esc(p.name)}</span></span><span class="pts">${p.score}</span></div>`)
    .join("")}</div>`;
}
