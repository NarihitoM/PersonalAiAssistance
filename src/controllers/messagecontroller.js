import { chatCompletion } from "../services/aiservice.js";
import { analyzeImage, analyzeImageBuffer } from "../services/geminiservice.js";
import { handleAIResponse } from "../services/messageservice.js";
import mammoth from "mammoth";
import { systempromptforimage, getSystemPrompt } from "../prompts/systemprompt.js";
import { tools } from "../tools/tools.js";
import userquery from "../models/userquery.js";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import path from "path";
import os from "os";
import https from "https";
import fs from "fs";
import { withTypingAction, sendBotMessage, getPdfTextFromUrl, fileRef } from "../utils/utils.js";

ffmpeg.setFfmpegPath(ffmpegPath);

//SUPER MESSAGE
const MAX_AI_RETRIES = 3;

function describeReply(msg) {
    const r = msg.reply_to_message;
    if (!r) return "";
    const who = r.from?.is_bot ? "your earlier message" : "an earlier message";
    const quote = msg.quote?.text ? ` The user highlighted this part: "${msg.quote.text}".` : "";
    const text = r.text || r.caption;
    if (r.document) return ` [Replying to ${who} with the file "${r.document.file_name}"${text ? `, caption: "${text.slice(0, 500)}"` : ""} - if user asks to change this file, call edit_file.${quote}]`;
    if (text) return ` [Replying to ${who}: "${text.slice(0, 1500)}".${quote}]`;
    const kind = r.voice ? "voice message" : r.audio ? "audio file" : r.video ? "video" : r.sticker ? `sticker ${r.sticker.emoji || ""}` : r.poll ? `poll "${r.poll.question}"` : r.location ? "location" : "message";
    return ` [Replying to ${who}: a ${kind}.${quote}]`;
}

async function describeImage(bot, fileId, caption, label, preAnalyze) {
    const ref = fileRef(fileId);
    if (preAnalyze) {
        try {
            const analysis = await analyzeImage(systempromptforimage, await bot.getFileLink(fileId), caption);
            return `${label} at URL: ${ref} ${caption} - This image is already analyzed, do not call analyze_image for it. What the image shows: ${analysis}`;
        } catch (err) {
            console.log("Image pre-analysis failed:", err.message);
        }
    }
    return `${label} at URL: ${ref} ${caption} - Call analyze_image with image_url to inspect it before answering.`;
}

async function describeAnimation(bot, msg, options) {
    const filelink = await bot.getFileLink(msg.animation.file_id);

    await bot.sendChatAction(msg.chat.id, "typing", options);

    const tmpAnimationPath = path.join(os.tmpdir(), `${Date.now()}-anim.mp4`);
    const tmpScreenshotDir = os.tmpdir();
    const screenshotName = `ss-anim-${Date.now()}.jpg`;
    const tmpScreenshotPath = path.join(tmpScreenshotDir, screenshotName);

    await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(tmpAnimationPath);
        https.get(filelink, (res) => {
            res.pipe(file);
            file.on("finish", resolve);
            file.on("error", reject);
        }).on("error", reject);
    });

    await new Promise((resolve, reject) => {
        ffmpeg(tmpAnimationPath)
            .screenshots({
                count: 1,
                timemarks: ["0"],
                filename: screenshotName,
                folder: tmpScreenshotDir
            })
            .on("end", resolve)
            .on("error", reject);
    });

    const screenshotBuffer = fs.readFileSync(tmpScreenshotPath);
    const imagetext = await analyzeImageBuffer(systempromptforimage, screenshotBuffer, "", "image/jpeg");
    fs.unlink(tmpScreenshotPath, () => {});

    return { content: `Gif : ${imagetext}` };
}

async function describeDocument(bot, msg, options, preAnalyze) {
    const { mime_type: mime, file_id: fileid, file_name: filename } = msg.document;
    const filelink = await bot.getFileLink(fileid);
    await bot.sendChatAction(msg.chat.id, "typing", options);
    const captiontext = msg.caption ? `text : ${msg.caption}` : "text : Please analyse this file";

    if (mime === "text/plain") {
        const data = Buffer.from(await (await fetch(filelink)).arrayBuffer()).toString("utf-8");
        return {
            content: `File(txt) : ${data},${captiontext}`,
            lastFile: { filename: filename || "file.txt", filetype: "txt", filecontent: data }
        };
    }
    if (mime === "application/pdf") {
        const pdfText = await getPdfTextFromUrl(filelink);
        return {
            content: `PDF : ${pdfText},${captiontext}`,
            lastFile: { filename: filename || "file.pdf", filetype: "pdf", filecontent: pdfText }
        };
    }
    if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        const buffer = Buffer.from(await (await fetch(filelink)).arrayBuffer());
        const result = await mammoth.extractRawText({ buffer });
        return { content: `DOCX : ${result.value},${captiontext}` };
    }
    if (mime === "image/png" || mime === "image/jpeg") {
        return { content: await describeImage(bot, fileid, captiontext, "User sent an image document", preAnalyze) };
    }
    return null;
}

async function describeMessage(bot, msg, options, { preAnalyze = false } = {}) {
    if (msg.text) {
        let replyImageUrl = "";
        if (msg.reply_to_message?.photo) {
            replyImageUrl = fileRef(msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1].file_id);
        } else if (msg.reply_to_message?.document?.mime_type?.startsWith("image/")) {
            replyImageUrl = fileRef(msg.reply_to_message.document.file_id);
        }
        const replyPart = replyImageUrl
            ? ` [Replying to image at URL: ${replyImageUrl} - if user asks to edit this image, call edit_image with this image_url]`
            : describeReply(msg);
        const youtubeLink = msg.text.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)[\w-]{11}\S*/)?.[0];
        const youtubePart = youtubeLink ? ` [YouTube video link detected: ${youtubeLink} - call youtube_transcript with this url to get its content before answering]` : "";
        return { content: `text : ${msg.text}${replyPart}${youtubePart}` };
    }

    if (msg.photo) {
        const captionmsg = msg.caption ? `Caption : ${msg.caption}` : "";
        return { content: await describeImage(bot, msg.photo[msg.photo.length - 1].file_id, captionmsg, "User sent an image", preAnalyze) };
    }

    if (msg.animation) return describeAnimation(bot, msg, options);

    if (msg.document?.mime_type?.startsWith("video/")) {
        return { content: "Gif : The user sent a video file clip." };
    }

    if (msg.sticker) {
        const emoji = msg.sticker.emoji || "🫧";
        if (msg.sticker.is_video || msg.sticker.is_animated) {
            return { content: `Gif : The user sent an animated/video sticker showing the emoji: "${emoji}".` };
        }
        return { content: `User sent a sticker image at URL: ${fileRef(msg.sticker.file_id)} Emoji: ${emoji} - Call analyze_image with image_url to inspect it before answering.` };
    }

    if (msg.voice) {
        return { content: `User sent a voice message at URL: ${fileRef(msg.voice.file_id)} - Call transcribe_audio with audio_url to transcribe it before answering.` };
    }

    if (msg.video) {
        if (msg.video.file_size > 5 * 1024 * 1024) {
            return { reject: "This video is larger than 5MB. Please reduce the video size and send it again." };
        }
        const captiontext = msg.caption ? `Caption : ${msg.caption}` : "";
        return { content: `User sent a video at URL: ${fileRef(msg.video.file_id)} ${captiontext} - Call transcribe_video with video_url to transcribe it before answering.` };
    }

    if (msg.document) return describeDocument(bot, msg, options, preAnalyze);

    if (msg.audio) {
        return { content: `User sent an audio file at URL: ${fileRef(msg.audio.file_id)} Title: ${msg.audio.title || ""} Performer: ${msg.audio.performer || ""} - Call transcribe_audio with audio_url to transcribe it before answering.` };
    }

    return null;
}

async function askAI(bot, chatid, options, content, lastFile, attempt) {
    if (attempt === 1) await userquery.findOneAndUpdate({
        userid: chatid
    }, {
        $push: { messages: { role: "user", content } },
        ...(lastFile ? { $set: { lastFile } } : {})
    }, {
        upsert: true
    });

    const historymessage = await userquery.findOne({ userid: chatid });

    const messages = [
        {
            role: "system",
            content: getSystemPrompt()
        },
        ...historymessage.messages.slice(-6).map((element) => ({
            role: element.role,
            content: element.content
        }))
    ];

    const response = await withTypingAction(bot, chatid, options, () => chatCompletion({
        tools,
        tool_choice: "auto",
        messages
    }));

    await handleAIResponse(bot, chatid, options, response, messages);
}

async function handleFailure(bot, chatid, options, err, attempt, retry) {
    console.log(err);

    const networkCodes = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"];
    const isNetworkError = networkCodes.includes(err.code) || /network|fetch failed|ENOTFOUND|ETIMEDOUT/i.test(err.message || "");

    if (isNetworkError) {
        await sendBotMessage(bot, chatid, "Something went wrong. please try again.", options);
    } else if (attempt < MAX_AI_RETRIES) {
        console.log(`AI output error, retrying (${attempt}/${MAX_AI_RETRIES})`);
        await retry();
    } else {
        console.log(`AI output failed after ${MAX_AI_RETRIES} attempts, giving up silently`);
        await sendBotMessage(bot, chatid, "Something went wrong. please try again.", options);
    }
}

function buildOptions(msg, businessConnectionId) {
    const options = {};
    if (businessConnectionId) {
        options.business_connection_id = businessConnectionId;
    }
    options.incomingMessageId = msg.message_id;
    return options;
}

export const message = (bot) => async (msg, businessConnectionId, attempt = 1) => {
    const chatid = msg.chat.id;
    console.log(msg);
    const options = buildOptions(msg, businessConnectionId);

    try {
        const item = await describeMessage(bot, msg, options);
        if (!item) return;
        if (item.reject) {
            await sendBotMessage(bot, chatid, item.reject, options);
            return;
        }
        await askAI(bot, chatid, options, item.content, item.lastFile, attempt);
    } catch (err) {
        await handleFailure(bot, chatid, options, err, attempt, () => message(bot)(msg, businessConnectionId, attempt + 1));
    }
};

export const messageBatch = (bot) => async (msgs, businessConnectionId, attempt = 1) => {
    const chatid = msgs[0].chat.id;
    console.log(`Album of ${msgs.length} items`, msgs.map(m => m.message_id));
    const options = buildOptions(msgs[0], businessConnectionId);

    try {
        const items = await withTypingAction(bot, chatid, options, () =>
            Promise.all(msgs.map(m => describeMessage(bot, m, options, { preAnalyze: true })))
        );

        const parts = [];
        let lastFile;
        items.forEach((item, i) => {
            if (!item) return;
            if (item.reject) {
                parts.push(`Item ${i + 1} was skipped: ${item.reject}`);
                return;
            }
            parts.push(`Item ${i + 1}: ${item.content}`);
            if (item.lastFile) lastFile = item.lastFile;
        });
        if (!parts.length) return;

        const content = `The user sent ${msgs.length} items together in one album. Consider all of them together and reply once.\n\n${parts.join("\n\n")}`;
        await askAI(bot, chatid, options, content, lastFile, attempt);
    } catch (err) {
        await handleFailure(bot, chatid, options, err, attempt, () => messageBatch(bot)(msgs, businessConnectionId, attempt + 1));
    }
};
