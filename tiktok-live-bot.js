// ============================================================
// EMPIRE TIKTOK LIVE BOT — v1.0
// Stack: tiktok-live-connector + OpenAI GPT-4o + Slack
// Host:  Render (persistent background worker)
// Run:   node tiktok-live-bot.js
// ============================================================

import { WebcastPushConnection } from "tiktok-live-connector";
import OpenAI from "openai";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const TIKTOK_USERNAME     = process.env.TIKTOK_USERNAME;
const OPENAI_API_KEY      = process.env.OPENAI_API_KEY;
const SLACK_WEBHOOK_OPS   = process.env.SLACK_WEBHOOK_OPS;
const SLACK_WEBHOOK_LOGS  = process.env.SLACK_WEBHOOK_LOGS;
const STREAM_PRODUCT_LINK = process.env.STREAM_PRODUCT_LINK || "[YOUR PRODUCT LINK]";
const EMAIL_LIST_LINK     = process.env.EMAIL_LIST_LINK     || "[YOUR EMAIL LIST LINK]";
const COMMUNITY_LINK      = process.env.COMMUNITY_LINK      || "[YOUR COMMUNITY LINK]";

if (!TIKTOK_USERNAME || !OPENAI_API_KEY || !SLACK_WEBHOOK_OPS) {
  console.error("Missing required env vars.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const tiktok = new WebcastPushConnection(TIKTOK_USERNAME, {
  processInitialData: false,
  enableExtendedGiftInfo: true,
  enableWebsocketUpgrade: true,
  requestPollingIntervalMs: 2000,
});

let stats = { messages:0, gifts:0, follows:0, shares:0, viewers:0, startTime:Date.now(), topQuestions:[] };

const CTA_TRIGGERS  = ["link","buy","get it","where","how much","price","join","purchase","how do i","how to"];
const Q_TRIGGERS    = ["?","what is","who is","when","which","why","how","can you","do you","is this","are you"];
const HYPE_TRIGGERS = ["let's go","goat","facts","period","lowkey","ngl","no cap"];

async function postSlack(url, payload) {
  try {
    await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
  } catch(e) { console.error("Slack error:",e.message); }
}

async function generateResponse(username, comment, type="chat") {
  const sys = `You are EmpireAI for Devin's TikTok LIVE. Max 180 chars. Hype, direct, genuine. Product: ${STREAM_PRODUCT_LINK} List: ${EMAIL_LIST_LINK} Community: ${COMMUNITY_LINK}. Output reply ONLY.`;
  const usr = type==="gift" ? `${username} sent a gift! Hype shoutout.` : type==="follow" ? `${username} just followed! Quick welcome.` : `${username} said: "${comment}" Reply as Devin.`;
  const r = await openai.chat.completions.create({ model:"gpt-4o", messages:[{role:"system",content:sys},{role:"user",content:usr}], max_tokens:80, temperature:0.85 });
  return r.choices[0].message.content.trim();
}

function isHighPriority(c) {
  const l = c.toLowerCase();
  return CTA_TRIGGERS.some(k=>l.includes(k)) || Q_TRIGGERS.some(k=>l.includes(k));
}

function buildAlert(username, comment, reply, isQ) {
  return { blocks:[
    { type:"section", text:{ type:"mrkdwn", text:`${isQ?"❓":"💬"} *@${username}* in TikTok LIVE:\n> _"${comment}"_` } },
    { type:"section", text:{ type:"mrkdwn", text:`🤖 *Suggested Reply:*\n\`\`\`${reply}\`\`\`` } },
    { type:"context", elements:[{ type:"mrkdwn", text:`Copy into TikTok chat | ${new Date().toLocaleTimeString()}` }] },
    { type:"divider" }
  ]};
}

async function postSummary() {
  const mins = Math.round((Date.now()-stats.startTime)/60000);
  await postSlack(SLACK_WEBHOOK_LOGS, { blocks:[
    { type:"header", text:{ type:"plain_text", text:"📊 TikTok LIVE — 10-Min Summary" } },
    { type:"section", fields:[
      { type:"mrkdwn", text:`*⏱ Time:*\n${mins} min` },
      { type:"mrkdwn", text:`*👁 Viewers:*\n${stats.viewers}` },
      { type:"mrkdwn", text:`*💬 Messages:*\n${stats.messages}` },
      { type:"mrkdwn", text:`*🎁 Gifts:*\n${stats.gifts}` },
      { type:"mrkdwn", text:`*➕ Follows:*\n${stats.follows}` },
      { type:"mrkdwn", text:`*🔗 Shares:*\n${stats.shares}` }
    ]}
  ]});
  stats.messages = 0;
}

tiktok.on("chat", async (data) => {
  const { uniqueId:u, comment:c } = data;
  stats.messages++;
  if (!c || c.length < 3) return;
  console.log(`[CHAT] @${u}: ${c}`);
  if (isHighPriority(c)) {
    const reply = await generateResponse(u, c, "chat");
    const isQ = c.includes("?");
    if (isQ) stats.topQuestions.push({ u, q:c });
    await postSlack(SLACK_WEBHOOK_OPS, buildAlert(u, c, reply, isQ));
  } else if (HYPE_TRIGGERS.some(k=>c.toLowerCase().includes(k)) && Math.random()>0.7) {
    await postSlack(SLACK_WEBHOOK_OPS, { text:`🔥 *Hype!* @${u}: _"${c}"_` });
  }
});

tiktok.on("gift", async (data) => {
  if (data.giftType===1 && !data.repeatEnd) return;
  const { uniqueId:u, giftName:g, diamondCount:d, repeatCount:r } = data;
  stats.gifts++;
  console.log(`[GIFT] @${u} ${r||1}x ${g} (${d} diamonds)`);
  const reply = await generateResponse(u, null, "gift");
  await postSlack(SLACK_WEBHOOK_OPS, { text:`🎁 *@${u}* sent *${r||1}x ${g}* (${d} 💎)\n🤖 *Shoutout:* \`${reply}\`` });
});

tiktok.on("follow", async (data) => {
  stats.follows++;
  if (stats.follows % 5 === 0) {
    await postSlack(SLACK_WEBHOOK_LOGS, { text:`➕ *${stats.follows} new follows!* Latest: @${data.uniqueId}` });
  }
});

tiktok.on("share", async (data) => {
  stats.shares++;
  await postSlack(SLACK_WEBHOOK_OPS, { text:`🔗 *@${data.uniqueId}* shared the stream! Shoutout them live!` });
});

tiktok.on("viewerCount", (data) => { stats.viewers = data.viewerCount; });

tiktok.on("streamEnd", async () => {
  console.log("Stream ended.");
  await postSummary();
  await postSlack(SLACK_WEBHOOK_LOGS, { text:`🔴 *TikTok LIVE ended* for @${TIKTOK_USERNAME}. Final stats above.` });
  process.exit(0);
});

tiktok.on("error", (e) => console.error("TikTok error:", e));

tiktok.on("disconnected", async (reason) => {
  console.warn("Disconnected:", reason);
  await postSlack(SLACK_WEBHOOK_LOGS, { text:`⚠️ Bot disconnected: ${reason} — reconnecting in 30s...` });
  setTimeout(() => startBot(), 30000);
});

async function startBot() {
  try {
    console.log(`Connecting to @${TIKTOK_USERNAME}...`);
    const state = await tiktok.connect();
    console.log(`Connected! Room: ${state.roomId}`);
    await postSlack(SLACK_WEBHOOK_LOGS, { text:`⚡ *Empire TikTok Bot LIVE* — monitoring @${TIKTOK_USERNAME}` });
    setInterval(postSummary, 10 * 60 * 1000);
  } catch(err) {
    console.error("Connection failed:", err.message);
    await postSlack(SLACK_WEBHOOK_LOGS, { text:`🚨 *Bot failed to connect* for @${TIKTOK_USERNAME}: ${err.message}` });
    setTimeout(() => startBot(), 60000);
  }
}

startBot();
