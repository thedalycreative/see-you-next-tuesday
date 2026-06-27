import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { networkInterfaces } from "node:os";
import QRCode from "qrcode";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
app.use(express.static(join(__dirname, "public")));
app.get("/host", (_req, res) => res.sendFile(join(__dirname, "public", "host.html")));

// ── Content ──────────────────────────────────────────────────────────────────
const load = (f) => JSON.parse(readFileSync(join(__dirname, "data", f), "utf8"));
const DECKS = load("decks.json").decks;
const FILLGAP = load("fillgap.json");
const IMPOSTER = load("imposter.json");
const FINGER = load("finger.json");

// ── Helpers ──────────────────────────────────────────────────────────────────
const PHASES = { LOBBY: "LOBBY", WRITE: "WRITE", VOTE: "VOTE", JUDGE: "JUDGE", REVEAL: "REVEAL", GAMEOVER: "GAMEOVER" };
const rooms = new Map();

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const filterSpicy = (items, spicy) => (spicy ? items : items.filter((i) => !i.nsfw));
const activePlayers = (room) => [...room.players.values()].filter((p) => p.connected);
const scoreboard = (room) =>
  activePlayers(room).map((p) => ({ id: p.id, name: p.name, score: p.score })).sort((a, b) => b.score - a.score);

function makeCode() {
  const chars = "BCDFGHJKLMNPQRSTVWXYZ";
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

// ── Game modes ───────────────────────────────────────────────────────────────
// Each mode is a self-contained object with the same lifecycle hooks. The socket
// handlers and render loop stay generic — adding a mode means adding one object.
//
//   meta:        id, name, tagline, minPlayers, writeTarget (where WRITE leads)
//   buildPool:   (re)fill the content queue for a fresh game
//   beginRound:  pick this round's content, set room.phase + per-round state
//   writeComplete / voteComplete: completion predicates for auto-advance
//   buildVote:   assemble votable options when entering VOTE
//   score:       mutate player scores, return the reveal payload for the screen
//   hostView / playerView: phase-specific payloads (public screen / private phone)

const MODES = {
  // ── BLUFF (Balderdash) ─────────────────────────────────────────────────────
  bluff: {
    id: "bluff",
    name: "Bluff",
    tagline: "Balderdash. Invent a fake definition for an obscure Aussie word. Fool the room, spot the truth.",
    minPlayers: 2,
    needsDecks: true,
    writeTarget: PHASES.VOTE,
    scoring: { guessedTruth: 3, fooledSomeone: 2 },

    buildPool(room) {
      const chosen = DECKS.filter((d) => room.settings.deckIds.includes(d.id));
      room.pool = shuffle(chosen.flatMap((d) => d.cards));
    },
    beginRound(room) {
      if (!room.pool?.length) this.buildPool(room);
      room.current = room.pool.pop() || { term: "Servo", answer: "A service / petrol station." };
      room.phase = PHASES.WRITE;
    },
    writeComplete(room) {
      const p = activePlayers(room);
      return p.length > 0 && p.every((x) => room.submissions.has(x.id));
    },
    buildVote(room) {
      const opts = [...room.submissions.entries()].map(([authorId, text], i) => ({ id: "o" + i, text, authorId }));
      opts.push({ id: "truth", text: room.current.answer, authorId: null });
      room.options = shuffle(opts);
      room.phase = PHASES.VOTE;
    },
    voteComplete(room) {
      const voters = activePlayers(room).filter((p) => room.options.some((o) => o.authorId !== p.id));
      return voters.length > 0 && voters.every((p) => room.votes.has(p.id));
    },
    score(room) {
      const S = this.scoring;
      for (const [voterId, optionId] of room.votes) {
        const opt = room.options.find((o) => o.id === optionId);
        if (!opt) continue;
        if (opt.authorId === null) { const v = room.players.get(voterId); if (v) v.score += S.guessedTruth; }
        else { const a = room.players.get(opt.authorId); if (a) a.score += S.fooledSomeone; }
      }
      return {
        kind: "bluff",
        term: room.current.term,
        options: room.options.map((o) => ({
          text: o.text,
          isTruth: o.authorId === null,
          authorName: o.authorId ? room.players.get(o.authorId)?.name ?? "(left)" : null,
          voters: [...room.votes.entries()].filter(([, oid]) => oid === o.id).map(([vid]) => room.players.get(vid)?.name ?? "(left)"),
        })),
      };
    },
    hostView(room) {
      if (room.phase === PHASES.WRITE)
        return { term: room.current.term, submitted: names(room, [...room.submissions.keys()]), waitingOn: waiting(room, (p) => !room.submissions.has(p.id)) };
      return { term: room.current.term, options: room.options.map((o) => ({ text: o.text })), voted: names(room, [...room.votes.keys()]), waitingOn: waiting(room, (p) => !room.votes.has(p.id)) };
    },
    playerView(room, s) {
      if (room.phase === PHASES.WRITE) return { term: room.current.term, done: room.submissions.has(s.id), instruction: "Make up a definition for" };
      const options = room.options.filter((o) => o.authorId !== s.id).map((o) => ({ id: o.id, text: o.text }));
      return { term: room.current.term, options, done: room.votes.has(s.id), isAuthorOnly: options.length === 0, instruction: "Which is the REAL meaning of" };
    },
  },

  // ── FILL THE GAP (Cards Against Humanity) ───────────────────────────────────
  fillgap: {
    id: "fillgap",
    name: "Fill the Gap",
    tagline: FILLGAP.tagline,
    minPlayers: 3,
    writeTarget: PHASES.JUDGE,

    buildPool(room) { room.pool = shuffle(filterSpicy(FILLGAP.prompts, room.settings.spicy)); },
    beginRound(room) {
      if (!room.pool?.length) this.buildPool(room);
      room.prompt = (room.pool.pop() || { text: "The most Aussie thing ever: ___." }).text;
      // Rotate the Card Czar through the players who were present at kickoff.
      const order = room.order.filter((id) => room.players.get(id)?.connected);
      room.czarId = order.length ? order[(room.round - 1) % order.length] : activePlayers(room)[0]?.id;
      room.judgePick = null;
      room.phase = PHASES.WRITE;
    },
    writeComplete(room) {
      const subs = activePlayers(room).filter((p) => p.id !== room.czarId);
      return subs.length > 0 && subs.every((p) => room.submissions.has(p.id));
    },
    buildVote(room) {
      room.options = shuffle([...room.submissions.entries()].map(([authorId, text], i) => ({ id: "o" + i, text, authorId })));
      room.phase = PHASES.JUDGE;
    },
    forceJudge(room) { if (!room.judgePick && room.options.length) room.judgePick = pick(room.options).id; },
    score(room) {
      const win = room.options.find((o) => o.id === room.judgePick);
      if (win) { const a = room.players.get(win.authorId); if (a) a.score += 1; }
      return {
        kind: "fillgap",
        prompt: room.prompt,
        czarName: room.players.get(room.czarId)?.name ?? "(left)",
        options: room.options.map((o) => ({ text: o.text, authorName: room.players.get(o.authorId)?.name ?? "(left)", won: o.id === room.judgePick })),
      };
    },
    hostView(room) {
      const base = { prompt: room.prompt, czarName: room.players.get(room.czarId)?.name ?? "(left)" };
      if (room.phase === PHASES.WRITE)
        return { ...base, submitted: names(room, [...room.submissions.keys()]), waitingOn: waiting(room, (p) => p.id !== room.czarId && !room.submissions.has(p.id)) };
      return { ...base, judging: true, options: room.options.map((o) => ({ text: o.text })) };
    },
    playerView(room, s) {
      const isCzar = s.id === room.czarId;
      if (room.phase === PHASES.WRITE)
        return isCzar
          ? { role: "czar", prompt: room.prompt, czarWaiting: true }
          : { prompt: room.prompt, done: room.submissions.has(s.id), instruction: "Fill the gap. Make it filthy." };
      // JUDGE
      return isCzar
        ? { role: "czar", prompt: room.prompt, options: room.options.map((o) => ({ id: o.id, text: o.text })), done: !!room.judgePick }
        : { prompt: room.prompt, czarPicking: true, czarName: room.players.get(room.czarId)?.name ?? "the judge" };
    },
  },

  // ── ODD ONE OUT (Spyfall / The Chameleon) ──────────────────────────────────
  imposter: {
    id: "imposter",
    name: "Odd One Out",
    tagline: IMPOSTER.tagline,
    minPlayers: 3,
    writeTarget: PHASES.VOTE,
    scoring: { caughtMole: 2, moleSurvives: 5 },

    buildPool(room) { room.pool = shuffle(filterSpicy(IMPOSTER.categories, room.settings.spicy)); },
    beginRound(room) {
      if (!room.pool?.length) this.buildPool(room);
      const cat = room.pool.pop() || { category: "Aussie Stuff", words: ["Vegemite"] };
      room.category = cat.category;
      room.secret = pick(cat.words);
      room.moleId = pick(activePlayers(room)).id;
      room.phase = PHASES.WRITE;
    },
    writeComplete(room) {
      const p = activePlayers(room);
      return p.length > 0 && p.every((x) => room.submissions.has(x.id));
    },
    buildVote(room) {
      room.options = activePlayers(room).map((p) => ({ id: p.id, name: p.name })); // vote a PERSON
      room.phase = PHASES.VOTE;
    },
    voteComplete(room) {
      const p = activePlayers(room);
      return p.length > 0 && p.every((x) => room.votes.has(x.id));
    },
    score(room) {
      const S = this.scoring;
      const tally = {};
      for (const [, target] of room.votes) tally[target] = (tally[target] || 0) + 1;
      const max = Math.max(0, ...Object.values(tally));
      const mostVoted = Object.keys(tally).filter((id) => tally[id] === max);
      const caught = mostVoted.includes(room.moleId);
      if (caught) {
        for (const [voterId, target] of room.votes) if (target === room.moleId) { const v = room.players.get(voterId); if (v) v.score += S.caughtMole; }
      } else {
        const mole = room.players.get(room.moleId); if (mole) mole.score += S.moleSurvives;
      }
      return {
        kind: "imposter",
        category: room.category,
        word: room.secret,
        moleName: room.players.get(room.moleId)?.name ?? "(left)",
        caught,
        clues: activePlayers(room).map((p) => ({ name: p.name, clue: room.submissions.get(p.id) || "—", isMole: p.id === room.moleId })),
        tally: Object.entries(tally).map(([id, v]) => ({ name: room.players.get(id)?.name ?? "(left)", votes: v })).sort((a, b) => b.votes - a.votes),
      };
    },
    hostView(room) {
      if (room.phase === PHASES.WRITE)
        return { category: room.category, submitted: names(room, [...room.submissions.keys()]), waitingOn: waiting(room, (p) => !room.submissions.has(p.id)) };
      return {
        category: room.category,
        clues: activePlayers(room).map((p) => ({ name: p.name, clue: room.submissions.get(p.id) || "—" })),
        voted: names(room, [...room.votes.keys()]),
        waitingOn: waiting(room, (p) => !room.votes.has(p.id)),
      };
    },
    playerView(room, s) {
      const isMole = s.id === room.moleId;
      if (room.phase === PHASES.WRITE)
        return isMole
          ? { role: "mole", category: room.category, done: room.submissions.has(s.id), instruction: "You're the MOLE. Blend in." }
          : { role: "agent", category: room.category, word: room.secret, done: room.submissions.has(s.id), instruction: "Give a one-word clue for" };
      return {
        category: room.category,
        clues: activePlayers(room).map((p) => ({ name: p.name, clue: room.submissions.get(p.id) || "—" })),
        options: activePlayers(room).filter((p) => p.id !== s.id).map((p) => ({ id: p.id, text: p.name })),
        done: room.votes.has(s.id),
        instruction: "Who's the Mole?",
      };
    },
  },

  // ── POINT THE FINGER (Most Likely To) ──────────────────────────────────────
  finger: {
    id: "finger",
    name: "Point the Finger",
    tagline: FINGER.tagline,
    minPlayers: 3,
    writeTarget: PHASES.VOTE,

    buildPool(room) { room.pool = shuffle(filterSpicy(FINGER.prompts, room.settings.spicy)); },
    beginRound(room) {
      if (!room.pool?.length) this.buildPool(room);
      room.prompt = (room.pool.pop() || { text: "Who's most likely to cause chaos?" }).text;
      room.options = activePlayers(room).map((p) => ({ id: p.id, name: p.name }));
      room.phase = PHASES.VOTE; // no WRITE phase — straight to the vote
    },
    voteComplete(room) {
      const p = activePlayers(room);
      return p.length > 0 && p.every((x) => room.votes.has(x.id));
    },
    score(room) {
      const tally = {};
      for (const [, target] of room.votes) tally[target] = (tally[target] || 0) + 1;
      const max = Math.max(0, ...Object.values(tally));
      const crowned = Object.keys(tally).filter((id) => tally[id] === max);
      // Reward reading the room: if you voted for a (the) most-fingered player, +1.
      for (const [voterId, target] of room.votes) if (crowned.includes(target)) { const v = room.players.get(voterId); if (v) v.score += 1; }
      return {
        kind: "finger",
        prompt: room.prompt,
        crowned: crowned.map((id) => room.players.get(id)?.name ?? "(left)"),
        tally: Object.entries(tally).map(([id, v]) => ({ name: room.players.get(id)?.name ?? "(left)", votes: v })).sort((a, b) => b.votes - a.votes),
      };
    },
    hostView(room) {
      return { prompt: room.prompt, voted: names(room, [...room.votes.keys()]), waitingOn: waiting(room, (p) => !room.votes.has(p.id)) };
    },
    playerView(room, s) {
      return {
        prompt: room.prompt,
        options: activePlayers(room).filter((p) => p.id !== s.id).map((p) => ({ id: p.id, text: p.name })),
        done: room.votes.has(s.id),
        instruction: "Point the finger",
      };
    },
  },
};

const names = (room, ids) => ids.map((id) => room.players.get(id)?.name).filter(Boolean);
const waiting = (room, pred) => activePlayers(room).filter(pred).map((p) => p.name);

// ── Room lifecycle ───────────────────────────────────────────────────────────
function newRoom(hostSocketId) {
  const code = makeCode();
  const room = {
    code,
    hostSocketId,
    phase: PHASES.LOBBY,
    players: new Map(),
    settings: { mode: "bluff", rounds: 5, spicy: false, deckIds: DECKS.filter((d) => !d.nsfw).map((d) => d.id) },
    round: 0,
    order: [],
    pool: [],
    submissions: new Map(),
    votes: new Map(),
    options: [],
  };
  rooms.set(code, room);
  return room;
}

function startGame(room) {
  room.players.forEach((p) => (p.score = 0));
  room.order = activePlayers(room).map((p) => p.id);
  room.round = 0;
  room.pool = [];
  MODES[room.settings.mode].buildPool(room);
  nextRound(room);
}
function nextRound(room) {
  room.round += 1;
  room.submissions = new Map();
  room.votes = new Map();
  room.options = [];
  MODES[room.settings.mode].beginRound(room);
  pushAll(room);
}
function endOrNext(room) {
  if (room.round >= room.settings.rounds) { room.phase = PHASES.GAMEOVER; pushAll(room); }
  else nextRound(room);
}
function advanceFromWrite(room) {
  const m = MODES[room.settings.mode];
  m.buildVote(room); // sets phase to VOTE or JUDGE
  pushAll(room);
}
function goReveal(room) {
  room.lastReveal = MODES[room.settings.mode].score(room);
  room.phase = PHASES.REVEAL;
  pushAll(room);
}

// ── Broadcasting ─────────────────────────────────────────────────────────────
function lobbyState(room) {
  return {
    code: room.code,
    phase: room.phase,
    mode: room.settings.mode,
    players: activePlayers(room).map((p) => ({ id: p.id, name: p.name, score: p.score })),
    settings: room.settings,
    round: room.round,
    totalRounds: room.settings.rounds,
    modes: Object.values(MODES).map((m) => ({ id: m.id, name: m.name, tagline: m.tagline, minPlayers: m.minPlayers, needsDecks: !!m.needsDecks })),
    decks: DECKS.map((d) => ({ id: d.id, name: d.name, tagline: d.tagline, nsfw: d.nsfw, count: d.cards.length })),
  };
}
function pushHost(room) {
  const base = lobbyState(room);
  const m = MODES[room.settings.mode];
  let extra = {};
  if ([PHASES.WRITE, PHASES.VOTE, PHASES.JUDGE].includes(room.phase)) extra = m.hostView(room);
  else if (room.phase === PHASES.REVEAL) extra = { reveal: room.lastReveal, scores: scoreboard(room) };
  else if (room.phase === PHASES.GAMEOVER) extra = { scores: scoreboard(room) };
  io.to("host:" + room.code).emit("host:state", { ...base, ...extra });
}
function pushPlayer(room, pid) {
  const s = room.players.get(pid);
  if (!s) return;
  const view = { phase: room.phase, code: room.code, mode: room.settings.mode, you: { name: s.name, score: s.score } };
  const m = MODES[room.settings.mode];
  if ([PHASES.WRITE, PHASES.VOTE, PHASES.JUDGE].includes(room.phase)) Object.assign(view, m.playerView(room, s));
  else if (room.phase === PHASES.REVEAL || room.phase === PHASES.GAMEOVER) view.scores = scoreboard(room);
  io.to(s.id).emit("player:state", view);
}
const pushAll = (room) => { pushHost(room); activePlayers(room).forEach((p) => pushPlayer(room, p.id)); };

// ── Sockets ──────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  socket.on("host:create", async () => {
    const room = newRoom(socket.id);
    socket.join("host:" + room.code);
    socket.data = { role: "host", code: room.code };
    const joinUrl = `${publicBase(socket)}/?code=${room.code}`;
    let qr = null;
    try { qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 320 }); } catch {}
    socket.emit("host:created", { code: room.code, joinUrl, qr });
    pushHost(room);
  });

  socket.on("host:settings", (s) => {
    const room = rooms.get(socket.data?.code);
    if (!room || socket.id !== room.hostSocketId || room.phase !== PHASES.LOBBY) return;
    if (s.mode && MODES[s.mode]) room.settings.mode = s.mode;
    if (typeof s.spicy === "boolean") room.settings.spicy = s.spicy;
    if (Array.isArray(s.deckIds) && s.deckIds.length) room.settings.deckIds = s.deckIds;
    if (Number.isInteger(s.rounds)) room.settings.rounds = Math.max(1, Math.min(20, s.rounds));
    pushHost(room);
  });

  socket.on("host:start", () => {
    const room = rooms.get(socket.data?.code);
    if (!room || socket.id !== room.hostSocketId) return;
    const need = MODES[room.settings.mode].minPlayers;
    if (activePlayers(room).length < need) return socket.emit("host:error", `Need at least ${need} players for this one, ya drongo.`);
    startGame(room);
  });

  socket.on("host:next", () => {
    const room = rooms.get(socket.data?.code);
    if (!room || socket.id !== room.hostSocketId) return;
    if (room.phase === PHASES.WRITE) advanceFromWrite(room);
    else if (room.phase === PHASES.VOTE) goReveal(room);
    else if (room.phase === PHASES.JUDGE) { MODES[room.settings.mode].forceJudge?.(room); goReveal(room); }
    else if (room.phase === PHASES.REVEAL) endOrNext(room);
  });

  socket.on("host:again", () => {
    const room = rooms.get(socket.data?.code);
    if (!room || socket.id !== room.hostSocketId) return;
    room.phase = PHASES.LOBBY;
    room.round = 0;
    pushAll(room);
  });

  // ── Players ────────────────────────────────────────────────────────────────
  socket.on("player:join", ({ code, name }) => {
    code = (code || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return socket.emit("player:error", "No room with that code. Check the screen.");
    name = (name || "").trim().slice(0, 20) || "Mystery Guest";
    if (activePlayers(room).some((p) => p.name.toLowerCase() === name.toLowerCase())) return socket.emit("player:error", "That name's taken. Be original.");
    socket.join("players:" + code);
    socket.data = { role: "player", code };
    room.players.set(socket.id, { id: socket.id, name, score: 0, connected: true });
    socket.emit("player:joined", { code, name });
    pushHost(room);
    pushPlayer(room, socket.id);
  });

  socket.on("player:submit", ({ text }) => {
    const room = rooms.get(socket.data?.code);
    if (!room || room.phase !== PHASES.WRITE) return;
    if (room.settings.mode === "fillgap" && socket.id === room.czarId) return; // czar doesn't write
    text = (text || "").trim().slice(0, 140);
    if (!text) return;
    room.submissions.set(socket.id, text);
    pushPlayer(room, socket.id);
    pushHost(room);
    if (MODES[room.settings.mode].writeComplete(room)) advanceFromWrite(room);
  });

  socket.on("player:vote", ({ optionId }) => {
    const room = rooms.get(socket.data?.code);
    if (!room || room.phase !== PHASES.VOTE) return;
    const opt = room.options.find((o) => o.id === optionId);
    if (!opt) return;
    if (opt.authorId === socket.id) return; // bluff: can't vote your own fake
    if (opt.id === socket.id) return;        // imposter/finger: can't vote yourself
    room.votes.set(socket.id, optionId);
    pushPlayer(room, socket.id);
    pushHost(room);
    if (MODES[room.settings.mode].voteComplete(room)) goReveal(room);
  });

  socket.on("player:judge", ({ optionId }) => {
    const room = rooms.get(socket.data?.code);
    if (!room || room.phase !== PHASES.JUDGE || socket.id !== room.czarId) return;
    if (!room.options.some((o) => o.id === optionId)) return;
    room.judgePick = optionId;
    goReveal(room);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data?.code);
    if (!room) return;
    if (socket.data.role === "host") {
      io.to("players:" + room.code).emit("player:state", { phase: "DEAD" });
      rooms.delete(room.code);
      return;
    }
    const player = room.players.get(socket.id);
    if (!player) return;
    player.connected = false;
    pushHost(room);
    // Their leaving might be the last thing a phase was waiting on.
    const m = MODES[room.settings.mode];
    if (room.phase === PHASES.WRITE && m.writeComplete(room)) advanceFromWrite(room);
    else if (room.phase === PHASES.VOTE && m.voteComplete?.(room)) goReveal(room);
  });
});

// ── LAN helper ───────────────────────────────────────────────────────────────
function getLanIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) for (const net of nets[name] || []) if (net.family === "IPv4" && !net.internal) return net.address;
  return "localhost";
}
const getLanUrl = () => `http://${getLanIp()}:${PORT}`;

// The URL phones should join on. Deployed, this is the public host (e.g.
// https://app.onrender.com) derived from the host's own connection. On a LAN it
// resolves to the laptop's IP. We only fall back to the LAN IP when the host
// opened the screen via localhost, which a phone could never reach.
function publicBase(socket) {
  const h = socket.handshake.headers || {};
  const fwdHost = (h["x-forwarded-host"] || h.host || "").split(",")[0].trim();
  const proto = ((h["x-forwarded-proto"] || "").split(",")[0].trim()) || (socket.handshake.secure ? "https" : "http");
  if (!fwdHost || /^(localhost|127\.0\.0\.1)(:|$)/.test(fwdHost)) return getLanUrl();
  return `${proto}://${fwdHost}`;
}

httpServer.listen(PORT, () => {
  console.log(`\n  See You Next Tuesday is live.`);
  console.log(`  Host screen (laptop/iPad):  ${getLanUrl()}/host`);
  console.log(`  Players join at:            ${getLanUrl()}\n`);
});
