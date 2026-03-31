const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const CLIENT_ID = process.env.OSU_CLIENT_ID;
const CLIENT_SECRET = process.env.OSU_CLIENT_SECRET;

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const res = await fetch("https://osu.ppy.sh/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
      scope: "public",
    }),
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
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/scores/:userId", async (req, res) => {
  try {
    const token = await getToken();
    const r = await fetch(`https://osu.ppy.sh/api/v2/users/${req.params.userId}/scores/best?limit=100&mode=osu`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/health", (_, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
