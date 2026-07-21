#!/usr/bin/env node
// Mint a Chrome Web Store API refresh token via a local OAuth loopback flow.
//
// Prerequisites:
//   - A "Desktop app" OAuth client in a project with the Chrome Web Store API
//     enabled (see PUBLISH.md).
//   - CWS_CLIENT_ID and CWS_CLIENT_SECRET in the environment. The easiest way
//     is to source the decrypted publish secrets, e.g.:
//       set -a; eval "$(sops --decrypt --output-type dotenv .env.publish.enc)"; set +a
//     or simply: set -a; source .env.publish; set +a
//
// Usage:
//   node scripts/mint-cws-token.mjs
//
// A browser opens for consent — sign in as the account that owns the CWS
// listing. The refresh token is printed to stdout; store it as CWS_REFRESH_TOKEN.
import { exec } from "node:child_process";
import http from "node:http";
import { URL } from "node:url";

const CLIENT_ID = process.env.CWS_CLIENT_ID;
const CLIENT_SECRET = process.env.CWS_CLIENT_SECRET;
const PORT = Number(process.env.CWS_OAUTH_PORT || 8976);

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Error: CWS_CLIENT_ID and CWS_CLIENT_SECRET must be set in the environment.");
  process.exit(1);
}

const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  scope: SCOPE,
  access_type: "offline",
  prompt: "consent",
}).toString()}`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT_URI);
  const code = u.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("No code in redirect.");
    return;
  }
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }).toString(),
    });
    const data = await tokenRes.json();
    if (data.refresh_token) {
      console.log("\n=== CWS_REFRESH_TOKEN ===");
      console.log(data.refresh_token);
      console.log("=========================\n");
      res
        .writeHead(200, { "Content-Type": "text/plain" })
        .end("Refresh token minted. Return to the terminal — you can close this tab.");
    } else {
      console.error("No refresh_token in response:", JSON.stringify(data, null, 2));
      res.writeHead(500).end("No refresh_token returned. Check the terminal.");
    }
  } catch (e) {
    console.error("Token exchange failed:", e);
    res.writeHead(500).end("Token exchange failed. Check the terminal.");
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 300);
  }
});

server.listen(PORT, () => {
  console.log(`\nListening on ${REDIRECT_URI}`);
  console.log("Opening the consent screen — sign in as the CWS-owner account.");
  console.log("If the browser does not open, paste this URL manually:\n");
  console.log(`${authUrl}\n`);
  exec(`open "${authUrl}"`);
});
