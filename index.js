const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const CLIENT_ID = process.env.OSU_CLIENT_ID;
const CLIENT_SECRET = process.env.OSU_CLIENT_SECRET;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const res = await fetch("https://osu.ppy.sh/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "client_credentials", scope: "public" }),
  });
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

app.get("/user/:username", async (req, res) => {
  try {
    const token = await getToken();
    const r = await fetch(`https://osu.ppy.sh/api/v2/users/${encodeURIComponent(req.params.username)}/osu`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/scores/:userId", async (req, res) => {
  try {
    const token = await getToken();
    const r = await fetch(`https://osu.ppy.sh/api/v2/users/${req.params.userId}/scores/best?limit=100&mode=osu`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/analyze", async (req, res) => {
  try {
    const { userData, topPlays } = req.body;
    const stats = userData.statistics;
    const plays = topPlays.slice(0, 25).map((p, i) =>
      `#${i+1}. "${p.beatmapset?.title}" | ${p.beatmap?.difficulty_rating}★ | ${Math.round(p.pp)}pp | ${(p.accuracy*100).toFixed(2)}% | Grade: ${p.rank} | Combo: ${p.max_combo}/${p.beatmap?.max_combo} | Mods: ${p.mods.join(",") || "NM"}`
    ).join("\n");

    const prompt = `You are an expert osu! standard mode coach. Analyze this player thoroughly.

PLAYER: ${userData.username}
Global Rank: #${stats?.global_rank?.toLocaleString()}
PP: ${stats?.pp?.toFixed(0)}
Accuracy: ${stats?.hit_accuracy?.toFixed(2)}%
Play Count: ${stats?.play_count?.toLocaleString()}

TOP 25 PLAYS:
${plays}

Respond ONLY with valid JSON, no markdown:
{"summary":"3 sentence summary","currentPP":${stats?.pp?.toFixed(0)},"ppTarget":0,"rankTarget":0,"playstyle":"string","weaknesses":[{"area":"string","detail":"string"},{"area":"string","detail":"string"},{"area":"string","detail":"string"}],"strengths":[{"area":"string","detail":"string"},{"area":"string","detail":"string"}],"roadmap":[{"phase":"Phase 1","title":"string","duration":"string","focus":"string","mapTypes":["string"],"starRange":"string","expectedPP":"string","tips":["string","string","string"]},{"phase":"Phase 2","title":"string","duration":"string","focus":"string","mapTypes":["string"],"starRange":"string","expectedPP":"string","tips":["string","string","string"]},{"phase":"Phase 3","title":"string","duration":"string","focus":"string","mapTypes":["string"],"starRange":"string","expectedPP":"string","tips":["string","string","string"]}],"modSuggestions":["string","string","string"],"dailyRoutine":["string","string","string","string"],"mapRecommendations":["string","string","string"]}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    const text = data.content.map(b => b.text || "").join("");
    res.json(JSON.parse(text.replace(/```json|```/g, "").trim()));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/health", (_, res) => res.json({ status: "ok" }));

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>osu! PP Optimizer</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { min-height: 100vh; background: #0d0d12; color: #e8e0ff; font-family: 'Courier New', monospace; padding: 40px 20px; }
.grid-bg { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-image: linear-gradient(rgba(255,102,170,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,102,170,0.03) 1px, transparent 1px); background-size: 40px 40px; pointer-events: none; z-index: 0; }
.container { position: relative; z-index: 1; max-width: 860px; margin: 0 auto; }
.header { text-align: center; margin-bottom: 48px; }
.subtitle { font-size: 11px; letter-spacing: 6px; color: #ff66aa; text-transform: uppercase; margin-bottom: 12px; }
h1 { font-size: clamp(32px,6vw,56px); font-weight: 900; font-family: Georgia,serif; background: linear-gradient(135deg,#ff66aa 0%,#cc44ff 50%,#66aaff 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; line-height: 1.1; }
.tagline { color: #6b6880; font-size: 13px; margin-top: 8px; }
.input-row { display: flex; gap: 12px; max-width: 500px; margin: 0 auto 40px; }
input { flex: 1; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,102,170,0.3); border-radius: 4px; padding: 12px 16px; color: #e8e0ff; font-size: 14px; font-family: 'Courier New',monospace; outline: none; }
button.analyze { background: linear-gradient(135deg,#ff66aa,#cc44ff); border: none; border-radius: 4px; padding: 12px 24px; color: #fff; font-family: 'Courier New',monospace; font-size: 13px; font-weight: 700; cursor: pointer; letter-spacing: 2px; text-transform: uppercase; white-space: nowrap; }
button.analyze:disabled { background: rgba(255,102,170,0.2); cursor: not-allowed; }
.loader { text-align: center; padding: 40px; }
.spinner { width: 40px; height: 40px; border: 2px solid rgba(255,102,170,0.2); border-top: 2px solid #ff66aa; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
@keyframes spin { to { transform: rotate(360deg); } }
.stage { color: #ff66aa; font-size: 12px; letter-spacing: 3px; }
.error { background: rgba(255,80,80,0.1); border: 1px solid rgba(255,80,80,0.3); border-radius: 4px; padding: 16px; color: #ff8080; font-size: 13px; text-align: center; }
.hidden { display: none; }
@keyframes fadeIn { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
.results { animation: fadeIn 0.5s ease; }
.card { background: rgba(255,102,170,0.05); border: 1px solid rgba(255,102,170,0.2); border-radius: 8px; padding: 24px 28px; margin-bottom: 24px; display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
.avatar { width: 64px; height: 64px; border-radius: 4px; border: 2px solid rgba(255,102,170,0.4); }
.player-info { flex: 1; min-width: 200px; }
.player-name { font-size: 20px; font-weight: 700; color: #ff66aa; font-family: Georgia,serif; }
.badge { font-size: 11px; color: #6b6880; background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 3px; margin-left: 8px; }
.pstats { font-size: 12px; color: #6b6880; margin-top: 4px; }
.psummary { font-size: 12px; color: #9988bb; margin-top: 8px; line-height: 1.6; }
.targets { display: flex; flex-direction: column; gap: 8px; }
.tbox { border-radius: 4px; padding: 10px 16px; text-align: center; }
.tlabel { font-size: 10px; letter-spacing: 2px; }
.tvalue { font-size: 24px; font-weight: 900; font-family: Georgia,serif; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
.panel { border-radius: 8px; padding: 20px; }
.ptitle { font-size: 10px; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 14px; }
.pitem { margin-bottom: 10px; }
.pititle { font-size: 12px; font-weight: 700; }
.pidetail { font-size: 11px; color: #7a7490; line-height: 1.5; }
.slabel { font-size: 10px; letter-spacing: 4px; color: #cc44ff; margin-bottom: 16px; text-transform: uppercase; }
.ptabs { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.ptab { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 8px 16px; color: #6b6880; font-family: 'Courier New',monospace; font-size: 11px; font-weight: 700; cursor: pointer; letter-spacing: 1px; }
.ptab.a0 { background: #ff6b6b; border-color: #ff6b6b; color: #0d0d12; }
.ptab.a1 { background: #ffd93d; border-color: #ffd93d; color: #0d0d12; }
.ptab.a2 { background: #6bcb77; border-color: #6bcb77; color: #0d0d12; }
.pcard { background: rgba(13,13,18,0.8); border-radius: 8px; padding: 24px; }
.pheader { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
.phtitle { font-size: 18px; font-weight: 700; font-family: Georgia,serif; }
.phmeta { font-size: 11px; color: #6b6880; margin-top: 4px; }
.ppbadge { border-radius: 4px; padding: 6px 14px; font-size: 12px; font-weight: 700; }
.focusline { font-size: 12px; color: #9988bb; margin-bottom: 16px; }
.tags { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.tag { border-radius: 3px; padding: 4px 10px; font-size: 11px; }
.tip { display: flex; gap: 8px; margin-bottom: 6px; }
.tiptext { font-size: 11px; color: #7a7490; line-height: 1.5; }
.grid-3 { display: grid; grid-template-columns: repeat(auto-fit,minmax(200px,1fr)); gap: 16px; margin-bottom: 24px; }
.li { display: flex; gap: 8px; margin-bottom: 8px; }
.litext { font-size: 11px; color: #7a7490; line-height: 1.5; }
.ptoggle { width: 100%; padding: 14px 20px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; color: #6b6880; font-family: 'Courier New',monospace; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; cursor: pointer; display: flex; justify-content: space-between; }
.plist { border: 1px solid rgba(255,255,255,0.07); border-top: none; border-radius: 0 0 8px 8px; }
.prow { padding: 10px 20px; border-top: 1px solid rgba(255,255,255,0.04); display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.sublabel { font-size: 10px; letter-spacing: 2px; color: #4a4460; margin: 12px 0 8px; }
</style>
</head>
<body>
<div class="grid-bg"></div>
<div class="container">
  <div class="header">
    <div class="subtitle">osu! performance optimizer</div>
    <h1>RANK UP.</h1>
    <p class="tagline">Enter any osu! username. Get a personalized PP grind roadmap.</p>
  </div>
  <div class="input-row">
    <input type="text" id="u" placeholder="osu! username..." />
    <button class="analyze" id="btn" onclick="analyze()">Analyze</button>
  </div>
  <div id="loader" class="loader hidden"><div class="spinner"></div><div class="stage" id="stage"></div></div>
  <div id="err" class="error hidden"></div>
  <div id="results" class="results hidden"></div>
</div>
<script>
let plays=[], phase=0, result=null;
const C=["#ff6b6b","#ffd93d","#6bcb77"];
const setStage=t=>document.getElementById("stage").textContent=t;
const showLoader=s=>{document.getElementById("loader").classList.toggle("hidden",!s);document.getElementById("btn").disabled=s;document.getElementById("btn").textContent=s?"...":"Analyze";};
const showErr=m=>{const e=document.getElementById("err");e.textContent="⚠️ "+m;e.classList.remove("hidden");};
const hideErr=()=>document.getElementById("err").classList.add("hidden");

async function analyze(){
  const u=document.getElementById("u").value.trim();
  if(!u)return;
  showLoader(true);hideErr();document.getElementById("results").classList.add("hidden");
  try{
    setStage("Fetching profile...");
    const ur=await fetch("/user/"+encodeURIComponent(u));
    if(!ur.ok)throw new Error("User not found");
    const user=await ur.json();
    setStage("Loading top plays...");
    const pr=await fetch("/scores/"+user.id);
    if(!pr.ok)throw new Error("Could not fetch scores");
    plays=await pr.json();
    setStage("AI is analyzing your data...");
    const ar=await fetch("/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userData:user,topPlays:plays})});
    if(!ar.ok)throw new Error("Analysis failed");
    result=await ar.json();
    render(user,plays,result);
  }catch(e){showErr(e.message||"Something went wrong.");}
  finally{showLoader(false);}
}

function renderPhase(p,i){
  const c=C[i];
  return \`<div class="pcard" style="border:1px solid \${c}44;box-shadow:0 0 30px \${c}22">
    <div class="pheader"><div><div class="phtitle" style="color:\${c}">\${p.title}</div><div class="phmeta">\${p.duration} · \${p.starRange}</div></div>
    <div class="ppbadge" style="background:\${c}22;border:1px solid \${c}44;color:\${c}">\${p.expectedPP}</div></div>
    <div class="focusline"><span style="color:\${c}">Focus:</span> \${p.focus}</div>
    <div class="sublabel">MAP TYPES</div>
    <div class="tags">\${p.mapTypes.map(t=>\`<span class="tag" style="background:\${c}15;border:1px solid \${c}33;color:\${c}">\${t}</span>\`).join("")}</div>
    <div class="sublabel">TIPS</div>
    \${p.tips.map(t=>\`<div class="tip"><span style="color:\${c};font-size:11px">›</span><span class="tiptext">\${t}</span></div>\`).join("")}
  </div>\`;
}

function switchPhase(i){
  phase=i;
  document.querySelectorAll(".ptab").forEach((b,j)=>{b.className="ptab"+(j===i?" a"+i:"");});
  document.getElementById("pc").innerHTML=renderPhase(result.roadmap[i],i);
}

function togglePlays(){
  const l=document.getElementById("pl");const a=document.getElementById("pa");
  l.classList.toggle("hidden");a.textContent=l.classList.contains("hidden")?"▼":"▲";
}

function render(user,p,r){
  const s=user.statistics;
  document.getElementById("results").innerHTML=\`
  <div class="card">
    \${user.avatar_url?\`<img class="avatar" src="\${user.avatar_url}">\`:""}
    <div class="player-info">
      <div><span class="player-name">\${user.username}</span><span class="badge">\${r.playstyle}</span></div>
      <div class="pstats">#\${s?.global_rank?.toLocaleString()} global · \${s?.pp?.toFixed(0)}pp · \${s?.hit_accuracy?.toFixed(2)}% acc</div>
      <div class="psummary">\${r.summary}</div>
    </div>
    <div class="targets">
      <div class="tbox" style="background:rgba(204,68,255,0.1);border:1px solid rgba(204,68,255,0.3)"><div class="tlabel" style="color:#cc44ff">PP TARGET</div><div class="tvalue" style="color:#cc44ff">\${r.ppTarget?.toLocaleString()}</div></div>
      <div class="tbox" style="background:rgba(102,170,255,0.1);border:1px solid rgba(102,170,255,0.3)"><div class="tlabel" style="color:#66aaff">RANK TARGET</div><div class="tvalue" style="color:#66aaff">#\${r.rankTarget?.toLocaleString()}</div></div>
    </div>
  </div>
  <div class="grid-2">
    <div class="panel" style="background:rgba(107,203,119,0.05);border:1px solid rgba(107,203,119,0.2)"><div class="ptitle" style="color:#6bcb77">Strengths</div>\${r.strengths.map(s=>\`<div class="pitem"><div class="pititle" style="color:#6bcb77">\${s.area}</div><div class="pidetail">\${s.detail}</div></div>\`).join("")}</div>
    <div class="panel" style="background:rgba(255,107,107,0.05);border:1px solid rgba(255,107,107,0.2)"><div class="ptitle" style="color:#ff6b6b">Weaknesses</div>\${r.weaknesses.map(w=>\`<div class="pitem"><div class="pititle" style="color:#ff6b6b">\${w.area}</div><div class="pidetail">\${w.detail}</div></div>\`).join("")}</div>
  </div>
  <div style="margin-bottom:24px">
    <div class="slabel">— Grind Roadmap</div>
    <div class="ptabs">\${r.roadmap.map((p,i)=>\`<button class="ptab\${phase===i?" a"+i:""}" onclick="switchPhase(\${i})">\${p.phase}</button>\`).join("")}</div>
    <div id="pc">\${renderPhase(r.roadmap[phase],phase)}</div>
  </div>
  <div class="grid-3">
    <div class="panel" style="background:rgba(102,170,255,0.05);border:1px solid rgba(102,170,255,0.15)"><div class="ptitle" style="color:#66aaff">Mod Tips</div>\${r.modSuggestions.map(m=>\`<div class="li"><span style="color:#66aaff;font-size:11px">◆</span><span class="litext">\${m}</span></div>\`).join("")}</div>
    <div class="panel" style="background:rgba(255,217,61,0.05);border:1px solid rgba(255,217,61,0.15)"><div class="ptitle" style="color:#ffd93d">Daily Routine</div>\${r.dailyRoutine.map((item,i)=>\`<div class="li"><span style="color:#ffd93d;font-size:11px">\${i+1}.</span><span class="litext">\${item}</span></div>\`).join("")}</div>
    <div class="panel" style="background:rgba(107,203,119,0.05);border:1px solid rgba(107,203,119,0.15)"><div class="ptitle" style="color:#6bcb77">Map Recs</div>\${r.mapRecommendations.map(m=>\`<div class="li"><span style="color:#6bcb77;font-size:11px">▸</span><span class="litext">\${m}</span></div>\`).join("")}</div>
  </div>
  <button class="ptoggle" onclick="togglePlays()"><span>Top Plays (\${p.length})</span><span id="pa">▼</span></button>
  <div id="pl" class="plist hidden">\${p.slice(0,15).map((p,i)=>\`<div class="prow"><span style="color:#4a4460;font-size:11px;min-width:20px">#\${i+1}</span><span style="color:#9988bb;font-size:11px;flex:1;min-width:120px">\${p.beatmapset?.title}</span><span style="color:#ff66aa;font-size:11px;font-weight:700">\${Math.round(p.pp)}pp</span><span style="color:#6b6880;font-size:11px">\${p.beatmap?.difficulty_rating}★</span><span style="color:#6b6880;font-size:11px">\${(p.accuracy*100).toFixed(2)}%</span>\${p.mods.length>0?\`<span style="color:#ffd93d;font-size:10px">\${p.mods.join(",")}</span>\`:""}</div>\`).join("")}</div>\`;
  document.getElementById("results").classList.remove("hidden");
}
document.getElementById("u").addEventListener("keydown",e=>{if(e.key==="Enter")analyze();});
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
