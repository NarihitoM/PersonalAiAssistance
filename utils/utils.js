import telegramifyMarkdown from "telegramify-markdown";
import userquery from "../model/userquery.js";

export const IMAGE_COOLDOWN_MS = 60 * 60 * 1000;

export async function withPhotoAction(bot, chatid, options, task) {
    await bot.sendChatAction(chatid, "upload_photo", options);
    const interval = setInterval(() => bot.sendChatAction(chatid, "upload_photo", options), 4000);
    try {
        return await task();
    } finally {
        clearInterval(interval);
    }
}

export async function checkImageCooldown(chatid) {
    const user = await userquery.findOne({ userid: chatid });
    const last = user?.lastImageGeneratedAt;
    if (last && Date.now() - last.getTime() < IMAGE_COOLDOWN_MS) {
        const remainingMin = Math.ceil((IMAGE_COOLDOWN_MS - (Date.now() - last.getTime())) / 60000);
        return { allowed: false, remainingMin };
    }
    return { allowed: true };
}

export async function sendBotMessage(bot, chatid, text, options = {}) {
    await bot.sendChatAction(chatid, "typing", options);
    const sendOptions = { ...options };
    try {
        await bot.sendMessage(chatid, telegramifyMarkdown(text, "remove"), { ...sendOptions, parse_mode: "MarkdownV2" });
    } catch (err) {
        console.log("sendBotMessage parse failed, falling back to plain text:", err.message);
        await bot.sendMessage(chatid, text, sendOptions);
    }
}
