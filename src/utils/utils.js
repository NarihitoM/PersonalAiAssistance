import telegramifyMarkdown from "telegramify-markdown";
import userquery from "../models/userquery.js";
import axios from "axios";
import PDFParser from "pdf2json";

export const IMAGE_COOLDOWN_MS = 1 * 60 * 1000;

export const ALLOWED_REACTIONS = ["👍", "👎", "❤", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "🤬", "😢", "🎉", "🤩", "🤮", "💩", "🙏", "👌", "🕊", "🤡", "🥱", "🥴", "😍", "🐳", "🌚", "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "💔", "🤨", "😐", "🍓", "🍾", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "👀", "🎃", "🙈", "😇", "😨", "🤝", "🤗", "🎅", "🎄", "☃", "💅", "🤪", "🗿", "🆒", "💘", "🙉", "🦄", "😘", "💊", "🙊", "😎", "👾", "🤷", "😡"];

export function normalizeReactionEmoji(emoji) {
    const stripped = String(emoji || "").replace(/️/g, "");
    const match = ALLOWED_REACTIONS.find(r => r.replace(/️/g, "") === stripped);
    return match || "👍";
}

export async function withPhotoAction(bot, chatid, options, task) {
    try { await bot.sendChatAction(chatid, "upload_photo", options); } catch {}
    const interval = setInterval(() => { bot.sendChatAction(chatid, "upload_photo", options).catch(() => {}); }, 4000);
    try {
        return await task();
    } finally {
        clearInterval(interval);
    }
}

export async function withTypingAction(bot, chatid, options, task) {
    try { await bot.sendChatAction(chatid, "typing", options); } catch {}
    const interval = setInterval(() => { bot.sendChatAction(chatid, "typing", options).catch(() => {}); }, 4000);
    try {
        return await task();
    } finally {
        clearInterval(interval);
    }
}

export async function withChatAction(bot, chatid, action, options, task) {
    try { await bot.sendChatAction(chatid, action, options); } catch {}
    const interval = setInterval(() => { bot.sendChatAction(chatid, action, options).catch(() => {}); }, 4000);
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

const TELEGRAM_MESSAGE_LIMIT = 4096;

function splitMessage(text, limit = TELEGRAM_MESSAGE_LIMIT) {
    if (text.length <= limit) return [text];

    const chunks = [];
    let rest = text;
    while (rest.length > limit) {
        let splitAt = rest.lastIndexOf("\n", limit);
        if (splitAt < limit * 0.5) splitAt = rest.lastIndexOf(" ", limit);
        if (splitAt < limit * 0.5) splitAt = limit;
        chunks.push(rest.slice(0, splitAt));
        rest = rest.slice(splitAt).trimStart();
    }
    if (rest) chunks.push(rest);
    return chunks;
}

export async function sendBotMessage(bot, chatid, text, options = {}) {
    const safeText = text && String(text).trim() ? String(text) : "Sorry, I couldn't generate a response. Please try again.";
    await bot.sendChatAction(chatid, "typing", options);

    const chunks = splitMessage(safeText);
    for (let i = 0; i < chunks.length; i++) {
        const sendOptions = i === 0 ? { ...options } : { ...options, reply_to_message_id: undefined };
        try {
            await bot.sendMessage(chatid, telegramifyMarkdown(chunks[i], "remove"), { ...sendOptions, parse_mode: "MarkdownV2" });
        } catch (err) {
            console.log("sendBotMessage parse failed, falling back to plain text:", err.message);
            await bot.sendMessage(chatid, chunks[i], sendOptions);
        }
    }
}

export const getPdfTextFromUrl = async (fileUrl) => {
    const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
    const buffer = response.data;
    return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser();
        pdfParser.on("pdfParser_dataError", err => reject(err));
        pdfParser.on("pdfParser_dataReady", pdfData => {
            try {
                const text = pdfData.Pages
                    .map(page => page.Texts
                        .map(t => {
                            try {
                                return decodeURIComponent(t.R[0].T);
                            } catch {
                                return t.R[0].T;
                            }
                        })
                        .join(" "))
                    .join("\n");
                resolve(text);
            } catch (err) {
                reject(err);
            }
        });
        pdfParser.parseBuffer(buffer);
    });
};
