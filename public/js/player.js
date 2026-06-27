// Player phone client. Holds your PRIVATE state — your secret word, your bluff,
// your vote. The server is the brain; this file renders whatever it's told, per mode.
const socket = io();
const $ = (s) => document.querySelector(s);

const params = new URLSearchParams(location.search);
if (params.get("code")) $("#code").value = params.get("code").toUpperCase();
const codeEl = $("#code");
codeEl.addEventListener("input", () => (codeEl.value = codeEl.value.toUpperCase()));

let me = { name: "" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

$("#joinBtn").addEventListener("click", () => {
  const code = codeEl.value.trim();
  const name = $("#name").value.trim();
  if (code.length !== 4) return toast("Need the 4-letter code.");
  if (!name) return toast("Pop a name in.");
  socket.emit("player:join", { code, name });
});
socket.on("player:error", toast);
socket.on("player:joined", ({ name }) => (me.name = name));

socket.on("player:state", (s) => {
  const wrap = document.querySelector(".wrap");
  if (s.phase === "DEAD") return void (wrap.innerHTML = view.dead());
  if (!s.phase || s.phase === "LOBBY") { if (me.name) wrap.innerHTML = view.lobby(s); return; }
  if (s.phase === "WRITE") { wrap.innerHTML = view.write(s); bindWrite(s); return; }
  if (s.phase === "VOTE") { wrap.innerHTML = view.vote(s); bindVote(); return; }
  if (s.phase === "JUDGE") { wrap.innerHTML = view.judge(s); bindJudge(); return; }
  if (s.phase === "REVEAL") return void (wrap.innerHTML = view.reveal(s));
  if (s.phase === "GAMEOVER") return void (wrap.innerHTML = view.gameover(s));
});

const header = (s) => `
  <div class="spread" style="margin-bottom:24px">
    <div class="logo" style="font-size:22px"><span class="cu">C U</span> Next Tues</div>
    <div class="chip you">${esc(me.name)}${s.you ? " · " + s.you.score : ""}</div>
  </div>`;

const lockedCard = (title, sub) =>
  `<div class="card center stack"><div class="big" style="font-size:30px">${title}</div><div class="muted">${sub}</div></div>`;

const subject = (txt, size = 40) => `<div class="term" style="font-size:${size}px;margin-top:6px">${esc(txt)}</div>`;

const view = {
  lobby: (s) => `${header(s)}
    <div class="stack center" style="margin-top:18%">
      <div class="big">You're in.</div>
      <div class="muted">Eyes on the big screen. Host kicks it off when everyone's here.</div>
    </div>`,

  write(s) {
    // Card Czar in Fill the Gap doesn't write.
    if (s.role === "czar")
      return `${header(s)}<div class="stack center" style="margin-top:16%">
        <div class="big" style="font-size:34px">👑 You're the judge</div>
        <div class="muted">Everyone else is filling the gap. You crown the winner next.</div>
        <div class="card" style="margin-top:12px">${blank(s.prompt)}</div></div>`;

    let promptBlock, inputType, placeholder;
    if (s.mode === "fillgap") {
      promptBlock = `<div class="kicker">${esc(s.instruction)}</div><div class="card" style="margin-top:10px">${blank(s.prompt)}</div>`;
      inputType = "area"; placeholder = "Your answer. Make it dirty.";
    } else if (s.mode === "imposter" && s.role === "mole") {
      promptBlock = `<div class="kicker">You're the MOLE 🕵️ — you don't know the word</div>
        <div class="muted" style="margin-top:8px">Category</div>${subject(s.category, 34)}
        <div class="muted" style="margin-top:10px">Bluff a clue that fits the category. Don't get rumbled.</div>`;
      inputType = "word"; placeholder = "Your clue word";
    } else if (s.mode === "imposter") {
      promptBlock = `<div class="muted">${esc(s.category)}</div>
        <div class="kicker" style="margin-top:10px">${esc(s.instruction)}</div>${subject(s.word, 44)}
        <div class="muted" style="margin-top:6px">One word that hints at it — without being too obvious.</div>`;
      inputType = "word"; placeholder = "Your clue word";
    } else {
      // bluff
      promptBlock = `<div class="kicker">${esc(s.instruction)}</div>${subject(s.term, 40)}`;
      inputType = "area"; placeholder = "Sound convincing. Bluff the room.";
    }

    return `${header(s)}<div class="stack-lg">
      <div>${promptBlock}</div>
      ${
        s.done
          ? lockedCard("Locked in 🤫", "Sit tight while the others cook.")
          : `<div class="stack">
              ${inputType === "area" ? `<textarea id="sub" maxlength="140" placeholder="${placeholder}"></textarea>` : `<input id="sub" maxlength="40" placeholder="${placeholder}" autocomplete="off" />`}
              <button id="subBtn" class="accent">Lock it in</button>
            </div>`
      }
    </div>`;
  },

  vote(s) {
    if (s.isAuthorOnly) return `${header(s)}<div class="card center"><div class="muted">You wrote everyone's options this round. Sit this vote out.</div></div>`;
    const clues =
      s.mode === "imposter" && s.clues
        ? `<div class="card stack" style="margin-bottom:6px"><div class="kicker">The clues</div>${s.clues
            .map((c) => `<div class="spread"><span class="muted">${esc(c.name)}</span><span style="font-weight:700">${esc(c.clue)}</span></div>`)
            .join("")}</div>`
        : "";
    const head =
      s.mode === "finger"
        ? `<div class="kicker">${esc(s.instruction)}</div>${subject(s.prompt, 26)}`
        : s.mode === "imposter"
        ? `<div class="kicker">${esc(s.instruction)}</div><div class="muted" style="margin-top:6px">Category: ${esc(s.category)}</div>`
        : `<div class="kicker">${esc(s.instruction)}</div>${subject(s.term, 38)}`;

    return `${header(s)}<div class="stack-lg">
      <div>${head}</div>
      ${clues}
      ${
        s.done
          ? lockedCard("Vote's in ✅", "Reckon you nailed it?")
          : `<div class="stack" id="opts">${(s.options || []).map((o) => `<div class="opt" data-id="${o.id}">${esc(o.text)}</div>`).join("")}</div>`
      }
    </div>`;
  },

  judge(s) {
    if (s.role === "czar")
      return `${header(s)}<div class="stack-lg">
        <div><div class="kicker">👑 You're judging — pick the winner</div><div class="card" style="margin-top:10px">${blank(s.prompt)}</div></div>
        ${s.done ? lockedCard("Crowned 👑", "Check the big screen.") : `<div class="stack" id="opts">${s.options.map((o) => `<div class="opt" data-id="${o.id}">${esc(o.text)}</div>`).join("")}</div>`}
      </div>`;
    return `${header(s)}<div class="stack center" style="margin-top:16%">
      <div class="big" style="font-size:30px">👑 ${esc(s.czarName)} is judging</div>
      <div class="muted">Your answer's in the running. Big screen has them all.</div>
      <div class="card" style="margin-top:12px">${blank(s.prompt)}</div></div>`;
  },

  reveal: (s) => `${header(s)}<div class="stack center" style="margin-top:12%">
    <div class="kicker">Scores</div>${miniScores(s.scores, me.name)}
    <div class="muted">Next round's loading on the big screen…</div></div>`,

  gameover(s) {
    const w = s.scores[0];
    const youWon = w && w.name === me.name;
    return `${header(s)}<div class="stack center" style="margin-top:10%">
      <div class="kicker">${youWon ? "You absolute legend" : "Game over"}</div>
      <div class="big">${youWon ? "🏆 You won" : esc(w ? w.name + " won" : "Done")}</div>
      ${miniScores(s.scores, me.name)}
      <div class="muted">Host can run it back.</div></div>`;
  },

  dead: () => `<div class="stack center" style="margin-top:30%">
    <div class="big" style="font-size:40px">Host left 👋</div>
    <div class="muted">The big screen closed the game. Reload to join a new one.</div></div>`,
};

// Style the ___ blank inside a Fill the Gap prompt.
function blank(text) {
  return `<div style="font-size:22px;line-height:1.4;font-weight:600">${esc(text).replace(/_{2,}/g, '<span style="color:var(--accent)">␣␣␣</span>')}</div>`;
}

function miniScores(scores, myName) {
  return `<div class="stack" style="width:100%;max-width:360px;margin:8px auto">
    ${(scores || [])
      .map((p, i) => `<div class="score-row ${i === 0 ? "lead" : ""}">
        <span><span class="rank">${i + 1}</span><span class="nm">${esc(p.name)}${p.name === myName ? " (you)" : ""}</span></span>
        <span class="pts">${p.score}</span></div>`)
      .join("")}</div>`;
}

function bindWrite() {
  const btn = $("#subBtn");
  if (!btn) return;
  const send = () => {
    const text = $("#sub").value.trim();
    if (!text) return toast("Write something, ya muppet.");
    socket.emit("player:submit", { text });
  };
  btn.addEventListener("click", send);
  const inp = $("#sub");
  if (inp && inp.tagName === "INPUT") inp.addEventListener("keydown", (e) => e.key === "Enter" && send());
}

function bindVote() {
  document.querySelectorAll(".opt").forEach((el) =>
    el.addEventListener("click", () => {
      document.querySelectorAll(".opt").forEach((o) => o.classList.remove("sel"));
      el.classList.add("sel");
      socket.emit("player:vote", { optionId: el.dataset.id });
    })
  );
}

function bindJudge() {
  document.querySelectorAll(".opt").forEach((el) =>
    el.addEventListener("click", () => {
      document.querySelectorAll(".opt").forEach((o) => o.classList.remove("sel"));
      el.classList.add("sel");
      socket.emit("player:judge", { optionId: el.dataset.id });
    })
  );
}
