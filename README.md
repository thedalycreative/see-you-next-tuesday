# See You Next Tuesday 🇦🇺

A filthy little Aussie party game. One big screen runs the show, everyone plays
privately on their phones. **Four game modes**, all with the same setup: laptop/iPad
on the table, mates on their phones.

> Currently a playtest build — try the modes, tell me which **slap** and which are
> **duds**, and we double down on what works.

## The modes

| Mode | Lifts from | What you do |
| --- | --- | --- |
| **Bluff** | Balderdash | Invent a fake definition for an obscure Aussie word. Fool the room, spot the real one. |
| **Fill the Gap** | Cards Against Humanity | Type the filthiest answer to a prompt. A rotating judge crowns a winner each round. |
| **Odd One Out** | Spyfall / The Chameleon | Everyone gets the same secret word — except the Mole. One clue each, then hunt the imposter. |
| **Point the Finger** | Most Likely To | "Who's most likely to ___?" Vote a mate. Read the room right and you score. |

Pick the mode on the host lobby. Each has its own player minimum (Bluff 2, the rest 3).

## How it works

- **Big screen** (laptop or iPad) = the public board: room code + QR, the word, the vote, the reveal, the scores.
- **Phones** = your private hand: write your bluff, cast your vote.
- Everything syncs in real time over your local wifi. No accounts, no app store, no internet required.

## Run it

```bash
npm install
npm start
```

Then:

1. On the **laptop/iPad**, open the **Host screen** URL printed in the terminal
   (e.g. `http://192.168.x.x:3000/host`). Leave it on the big screen.
2. Everyone else **scans the QR** (or types the 4-letter code at the root URL on their phone).
3. Host picks decks + number of rounds → **Start the carnage**.

> All devices must be on the **same wifi**. The terminal prints your LAN address automatically.

## Game settings (on the host lobby)

- **Mode** — tap to pick one of the four games.
- **Rounds** — `–` / `+`, 1 to 20.
- **Bluff only — Decks** (tap to toggle): Dinkum Dictionary, Is That A Real Town?, and
  After Dark (18+, off by default — for once Nan's gone to bed).
- **Other modes — Filth Level**: one toggle. *"Keeping it clean"* by default; tap to
  *"Send it 🔞"* and the 18+ prompts/categories unlock.

## Scoring

Each mode's economy lives in its own object in [`server.js`](server.js) (look for `scoring:`):

| Mode | Action | Points |
| --- | --- | --- |
| **Bluff** | Guess the real definition | **+3** |
| | Each player you fool | **+2** |
| **Fill the Gap** | Win the round (judge picks you) | **+1** |
| **Odd One Out** | Correctly finger the Mole | **+2** |
| | Mole survives the vote | **+5** |
| **Point the Finger** | You voted for the most-fingered mate | **+1** |

Want a different feel? Change those numbers — they're the whole tuning surface.

## Add your own content

Each mode reads its own data file. Add to any of them and restart:

| File | Mode | Shape |
| --- | --- | --- |
| [`data/decks.json`](data/decks.json) | Bluff | `{ "term": "Bingle", "answer": "A minor car accident." }` |
| [`data/fillgap.json`](data/fillgap.json) | Fill the Gap | `{ "text": "Nothing beats ___.", "nsfw": false }` |
| [`data/imposter.json`](data/imposter.json) | Odd One Out | `{ "category": "Aussie Snacks", "nsfw": false, "words": ["Tim Tam", ...] }` |
| [`data/finger.json`](data/finger.json) | Point the Finger | `{ "text": "Who's most likely to ___?", "nsfw": false }` |

Set `"nsfw": true` on any prompt/category and it only shows when **Send it** is on.
Build a "Footy Trip" or "Hens Night" set — go nuts.

## Adding a whole new mode

Modes are a registry in [`server.js`](server.js) — `const MODES = { ... }`. Each mode is one
object implementing the same hooks (`beginRound`, `writeComplete`, `buildVote`, `score`,
`hostView`, `playerView`). The socket handlers and both clients are generic, so a new mode
is a new object plus a render branch — no surgery on the core. *(This is how the Articulate /
Heads-Up verbal mode would slot in next.)*

## Tech

Node + Express + Socket.io. In-memory rooms (when the host closes the laptop, the party's over).
No build step, no framework — `public/` is plain HTML/CSS/JS so it's easy to hack on.

```
server.js            game brain: mode registry, phases, scoring, socket wiring
data/*.json          content, one file per mode
public/host.html     big-screen shell        → public/js/host.js
public/index.html    phone join screen        → public/js/player.js
public/css/style.css the whole look
```
