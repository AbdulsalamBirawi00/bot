const { Telegraf } = require("telegraf");
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL = process.env.API_URL;

if (!BOT_TOKEN || !API_URL) {
  console.error("❌ BOT_TOKEN أو API_URL مفقود!");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// روابط Reel مؤقتة
const reels = {};

async function fetchWithRetry(url, retries = 3, delay = 1000, type = "json") {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios({
        url,
        method: "GET",
        responseType: type === "stream" ? "stream" : "json",
        timeout: 10000,
      });
      return response.data;
    } catch (err) {
      console.error(`Attempt ${attempt} failed:`, err.message);
      if (attempt === retries) throw err;
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}

// أوامر البوت
bot.start((ctx) =>
  ctx.reply("مرحبًا! أرسل لي رابط Reel من Instagram لتحميله كفيديو أو صوت.")
);

bot.on("text", async (ctx) => {
  const url = ctx.message.text.trim();
  if (!url.includes("instagram.com"))
    return ctx.reply("⚠️ الرابط غير صالح. أرسل رابط Reel صالح من Instagram.");

  const key = Math.random().toString(36).substring(2, 10);
  reels[key] = { url, expires: Date.now() + 5 * 60 * 1000 };

  ctx.reply("هل تريد تنزيله كـ فيديو أو صوت؟", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🎥 فيديو", callback_data: `video|${key}` },
          { text: "🎵 صوت", callback_data: `audio|${key}` },
        ],
      ],
    },
  });
});

bot.on("callback_query", async (ctx) => {
  const [type, key] = ctx.callbackQuery.data.split("|");
  const reel = reels[key];
  if (!reel || reel.expires < Date.now())
    return ctx.reply("⚠️ الرابط غير موجود أو انتهت صلاحيته.");

  await ctx.answerCbQuery();
  const url = reel.url;

  try {
    if (type === "video") {
      const data = await fetchWithRetry(
        `${API_URL}/api/reel?url=${encodeURIComponent(url)}`
      );
      await ctx.replyWithVideo({ url: data.videoUrl });
    } else if (type === "audio") {
      const response = await fetchWithRetry(
        `${API_URL}/api/reel?url=${encodeURIComponent(url)}&type=audio`,
        3,
        1000,
        "stream"
      );
      const tempPath = path.join(__dirname, `temp_audio_${key}.mp3`);
      const writer = fs.createWriteStream(tempPath);
      response.pipe(writer);
      writer.on("finish", async () => {
        await ctx.replyWithAudio({ source: tempPath });
        fs.unlinkSync(tempPath);
      });
      writer.on("error", (err) => {
        console.error(err);
        ctx.reply("❌ حدث خطأ أثناء تحميل الصوت.");
      });
    }
  } catch (err) {
    console.error(err);
    ctx.reply("❌ فشل في جلب الوسائط.");
  }
});

// إعداد الـ Webhook
app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));

bot.telegram.setWebhook(`${process.env.RENDER_EXTERNAL_URL}/bot${BOT_TOKEN}`);

app.get("/", (req, res) => res.send("✅ Bot is running via Webhook!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
