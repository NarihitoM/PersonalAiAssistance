import { groq, modelaudio, transcriptmodel } from "../services/groqservice.js";
import { chatCompletion } from "../services/xkiroservice.js";
import { webSearch, webScrape, webCrawl, webMap, youtubeSearch, youtubeTranscript } from "../services/firecrawlservice.js";
import { generateImage } from "../services/unoservice.js";
import { analyzeImage, analyzeImageBuffer, assertPublicHttpsUrl } from "../services/geminiservice.js";
import mammoth from "mammoth";
import { systemprompt, systempromptforimage } from "../prompts/systemprompt.js";
import { tools } from "../tools/tools.js";
import userquery from "../models/userquery.js";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import path from "path";
import os from "os";
import https from "https";
import fs from "fs";
import PDFDocument from "pdfkit";
import streamBuffers from "stream-buffers";
import { withPhotoAction, withTypingAction, withChatAction, checkImageCooldown, sendBotMessage, getPdfTextFromUrl } from "../utils/utils.js";

ffmpeg.setFfmpegPath(ffmpegPath);

const MAX_TOOL_DEPTH = 5;

const ALLOWED_REACTIONS = ["👍", "👎", "❤", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "🤬", "😢", "🎉", "🤩", "🤮", "💩", "🙏", "👌", "🕊", "🤡", "🥱", "🥴", "😍", "🐳", "🌚", "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "💔", "🤨", "😐", "🍓", "🍾", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "👀", "🎃", "🙈", "😇", "😨", "🤝", "🤗", "🎅", "🎄", "☃", "💅", "🤪", "🗿", "🆒", "💘", "🙉", "🦄", "😘", "💊", "🙊", "😎", "👾", "🤷", "😡"];

function normalizeReactionEmoji(emoji) {
    const stripped = String(emoji || "").replace(/️/g, "");
    const match = ALLOWED_REACTIONS.find(r => r.replace(/️/g, "") === stripped);
    return match || "👍";
}

async function handleAIResponse(bot, chatid, options, response, messages, depth = 0) {
    if (depth > MAX_TOOL_DEPTH) {
        console.log(`handleAIResponse max depth ${MAX_TOOL_DEPTH} reached, stopping`);
        await sendBotMessage(bot, chatid, "Sorry, I got stuck in a loop. Please try again with a simpler request.", options);
        return;
    }
    const responseMessage = response.choices[0].message;
    const toolCall = responseMessage.tool_calls?.[0];

    if (!toolCall) {
        let aimessage = responseMessage.content;
        if (!aimessage || !String(aimessage).trim()) {
            console.log("handleAIResponse: empty content, raw response:", JSON.stringify(responseMessage).slice(0, 2000));
            aimessage = responseMessage.content || "";
            if (!String(aimessage).trim() && responseMessage.tool_calls) {
                aimessage = "I found some results but couldn't format them. Please try again or ask more specifically.";
            } else if (!String(aimessage).trim()) {
                aimessage = "Sorry, I couldn't generate a response. Please try again.";
            }
        }

        await userquery.findOneAndUpdate({
            userid: chatid
        }, {
            $push: {
                messages: {
                    role: "assistant",
                    content: aimessage
                }
            }
        }, {
            upsert: true
        });

        await sendBotMessage(bot, chatid, aimessage, options);
        return;
    }

    const args = JSON.parse(toolCall.function.arguments);

    if (toolCall.function.name === "create_voice") {
        const speech = await withChatAction(bot, chatid, "upload_voice", options, () => groq.audio.speech.create({
            model: modelaudio,
            voice: "hannah",
            input: args.audiocontent,
            response_format: "wav"
        }));

        const buffer = Buffer.from(await speech.arrayBuffer());

        await bot.sendAudio(chatid, buffer, {
            ...options,
            caption: args.message,
            title: args.audioname,
            performer: "Narihito Assistant"
        });

        await userquery.findOneAndUpdate({ userid: chatid }, {
            $push: { messages: { role: "assistant", content: `Voice sent: ${args.audioname} | ${args.message} | Content: ${args.audiocontent.slice(0, 500)}` } }
        }, { upsert: true });

        return;
    }

    if (toolCall.function.name === "generate_image") {
        const cooldown = await checkImageCooldown(chatid);
        if (!cooldown.allowed) {
            await bot.sendMessage(chatid, `Please wait ${cooldown.remainingMin} more minute(s) before generating another image.`, options);
            return;
        }

        try {
            const image = await withPhotoAction(bot, chatid, options, () => generateImage(args.prompt, { timeoutMs: 60000 }));

            await userquery.findOneAndUpdate({ userid: chatid }, { lastImageGeneratedAt: new Date() });

            await bot.sendPhoto(chatid, image, {
                ...options,
                caption: args.message
            });

            await userquery.findOneAndUpdate({ userid: chatid }, {
                $push: { messages: { role: "assistant", content: `Image generated: ${args.prompt} | Caption: ${args.message}` } }
            }, { upsert: true });
        } catch (err) {
            const isTimeout = err.name === "AbortError" || /aborted|timeout/i.test(err.message || "");
            console.log("Image generation failed:", err.message);
            await bot.sendMessage(chatid, isTimeout ? "Image generation timed out. Please try again with a simpler prompt." : "Sorry, image generation failed. Please try again.", options);
            await userquery.findOneAndUpdate({ userid: chatid }, {
                $push: { messages: { role: "assistant", content: `Image generation failed: ${err.message}` } }
            }, { upsert: true });
        }
        return;
    }

    if (toolCall.function.name === "web_search") {
        let results;
        try {
            results = await withTypingAction(bot, chatid, options, () => webSearch(args.query));
        } catch (err) {
            console.log("Web search failed:", err.message);
            await bot.sendMessage(chatid, "Sorry, web search failed. Please try again.", options);
            return;
        }

        const followUp = await withTypingAction(bot, chatid, options, () => chatCompletion({
            tools,
            tool_choice: "auto",
            messages: [
                ...messages,
                responseMessage,
                { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(results) }
            ]
        }));

        return handleAIResponse(bot, chatid, options, followUp, messages, depth + 1);
    }

    if (toolCall.function.name === "web_scrape") {
        let results;
        try {
            results = await withTypingAction(bot, chatid, options, () => webScrape(args.url, { onlyMainContent: args.onlyMainContent, formats: args.formats }));
        } catch (err) {
            console.log("Web scrape failed:", err.message);
            await bot.sendMessage(chatid, "Sorry, web scrape failed. Please try again. " + err.message, options);
            return;
        }

        const followUp = await withTypingAction(bot, chatid, options, () => chatCompletion({
            tools,
            tool_choice: "auto",
            messages: [
                ...messages,
                responseMessage,
                { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(results) }
            ]
        }));

        return handleAIResponse(bot, chatid, options, followUp, messages, depth + 1);
    }

    if (toolCall.function.name === "web_crawl") {
        let results;
        try {
            results = await withTypingAction(bot, chatid, options, () => webCrawl(args.url, { limit: args.limit, maxDiscoveryDepth: args.maxDiscoveryDepth }));
        } catch (err) {
            console.log("Web crawl failed:", err.message);
            await bot.sendMessage(chatid, "Sorry, web crawl failed. Please try again. " + err.message, options);
            return;
        }

        const followUp = await withTypingAction(bot, chatid, options, () => chatCompletion({
            tools,
            tool_choice: "auto",
            messages: [
                ...messages,
                responseMessage,
                { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(results) }
            ]
        }));

        return handleAIResponse(bot, chatid, options, followUp, messages, depth + 1);
    }

    if (toolCall.function.name === "web_map") {
        let results;
        try {
            results = await withTypingAction(bot, chatid, options, () => webMap(args.url, { limit: args.limit }));
        } catch (err) {
            console.log("Web map failed:", err.message);
            await bot.sendMessage(chatid, "Sorry, web map failed. Please try again. " + err.message, options);
            return;
        }

        const followUp = await withTypingAction(bot, chatid, options, () => chatCompletion({
            tools,
            tool_choice: "auto",
            messages: [
                ...messages,
                responseMessage,
                { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(results) }
            ]
        }));

        return handleAIResponse(bot, chatid, options, followUp, messages, depth + 1);
    }

    if (toolCall.function.name === "create_poll") {
        try {
            const opts = args.options?.slice(0, 10) || [];
            if (opts.length < 2) throw new Error("Poll needs at least 2 options");

            if (args.message) await sendBotMessage(bot, chatid, args.message, options);

            await bot.sendPoll(chatid, args.question, opts, {
                ...options,
                is_anonymous: args.is_anonymous ?? true,
                allows_multiple_answers: args.allows_multiple_answers ?? false
            });

            await userquery.findOneAndUpdate({ userid: chatid }, {
                $push: { messages: { role: "assistant", content: `Poll created: ${args.question} | Options: ${opts.join(", ")}${args.message ? ` | Message: ${args.message}` : ""}` } }
            }, { upsert: true });
        } catch (err) {
            console.log("Create poll failed:", err.message);
            await bot.sendMessage(chatid, "Sorry, failed to create poll: " + err.message, options);
        }
        return;
    }

    if (toolCall.function.name === "schedule_reminder") {
        try {
            const delayMs = Math.min(Math.max(args.delay_minutes, 1), 1440) * 60 * 1000;

            await bot.sendMessage(chatid, args.message || `Reminder set for ${args.delay_minutes} minute(s) from now.`, options);

            setTimeout(async () => {
                try {
                    await bot.sendMessage(chatid, `Reminder: ${args.reminder_text}`, options);
                } catch (e) {
                    console.log("Reminder send failed:", e.message);
                }
            }, delayMs);

            await userquery.findOneAndUpdate({ userid: chatid }, {
                $push: { messages: { role: "assistant", content: args.message || `Reminder set: ${args.reminder_text} in ${args.delay_minutes}m` } }
            }, { upsert: true });
        } catch (err) {
            console.log("Schedule reminder failed:", err.message);
            await bot.sendMessage(chatid, "Sorry, failed to set reminder: " + err.message, options);
        }
        return;
    }

    if (toolCall.function.name === "send_location") {
        try {
            if (args.message) await sendBotMessage(bot, chatid, args.message, options);

            if (args.title || args.address) {
                await bot.sendVenue(chatid, args.latitude, args.longitude, args.title || "Location", args.address || "", options);
            } else {
                await bot.sendLocation(chatid, args.latitude, args.longitude, options);
            }

            await userquery.findOneAndUpdate({ userid: chatid }, {
                $push: { messages: { role: "assistant", content: `Location sent: ${args.latitude},${args.longitude}${args.title ? ` | ${args.title}` : ""}${args.address ? ` | ${args.address}` : ""}${args.message ? ` | ${args.message}` : ""}` } }
            }, { upsert: true });
        } catch (err) {
            console.log("Send location failed:", err.message);
            await bot.sendMessage(chatid, "Sorry, failed to send location: " + err.message, options);
        }
        return;
    }

    if (toolCall.function.name === "reply_to_message") {
        await sendBotMessage(bot, chatid, args.message, {
            ...options,
            reply_to_message_id: options.incomingMessageId
        });

        await userquery.findOneAndUpdate({
            userid: chatid
        }, {
            $push: {
                messages: {
                    role: "assistant",
                    content: args.message
                }
            }
        }, {
            upsert: true
        });
        return;
    }

    if (toolCall.function.name === "react_to_message") {
        try {
            if (options.incomingMessageId && !options.business_connection_id) {
                await bot.setMessageReaction(chatid, options.incomingMessageId, {
                    reaction: [{ type: "emoji", emoji: normalizeReactionEmoji(args.emoji) }]
                });
            }

            if (args.message) await sendBotMessage(bot, chatid, args.message, options);

            await userquery.findOneAndUpdate({ userid: chatid }, {
                $push: { messages: { role: "assistant", content: `Reacted with ${args.emoji}${args.message ? ` | ${args.message}` : ""}` } }
            }, { upsert: true });
        } catch (err) {
            console.log("React to message failed:", err.message);
        }
        return;
    }

    if (toolCall.function.name === "youtube_search") {
        let results;
        try {
            results = await withTypingAction(bot, chatid, options, () => youtubeSearch(args.query, { limit: args.limit }));
        } catch (err) {
            console.log("YouTube search failed:", err.message);
            await bot.sendMessage(chatid, "Sorry, YouTube search failed: " + err.message, options);
            return;
        }
        const followUp = await withTypingAction(bot, chatid, options, () => chatCompletion({
            tools,
            tool_choice: "auto",
            messages: [...messages, responseMessage, { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(results) }]
        }));
        return handleAIResponse(bot, chatid, options, followUp, messages, depth + 1);
    }

    if (toolCall.function.name === "youtube_transcript") {
        let results;
        try {
            results = await withTypingAction(bot, chatid, options, () => youtubeTranscript(args.url));
        } catch (err) {
            console.log("YouTube transcript failed:", err.message);
            await bot.sendMessage(chatid, "Sorry, YouTube transcript failed: " + err.message, options);
            return;
        }
        const followUp = await withTypingAction(bot, chatid, options, () => chatCompletion({
            tools,
            tool_choice: "auto",
            messages: [...messages, responseMessage, { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(results) }]
        }));
        return handleAIResponse(bot, chatid, options, followUp, messages, depth + 1);
    }

    if (toolCall.function.name === "analyze_image") {
        let results;
        try {
            results = await withTypingAction(bot, chatid, options, () => analyzeImage(systempromptforimage, args.image_url, args.prompt || ""));
        } catch (err) {
            console.log("Analyze image failed:", err.message);
            await bot.sendMessage(chatid, "Sorry, image analysis failed: " + err.message, options);
            return;
        }
        const followUp = await withTypingAction(bot, chatid, options, () => chatCompletion({
            tools,
            tool_choice: "auto",
            messages: [...messages, responseMessage, { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ analysis: results, image_url: args.image_url }) }]
        }));
        return handleAIResponse(bot, chatid, options, followUp, messages, depth + 1);
    }

    if (toolCall.function.name === "transcribe_audio") {
        let results;
        try {
            results = await withTypingAction(bot, chatid, options, async () => {
                await assertPublicHttpsUrl(args.audio_url);
                const tr = await groq.audio.transcriptions.create({
                    model: transcriptmodel,
                    url: args.audio_url,
                    prompt: args.prompt || undefined,
                    language: "en"
                });
                return tr.text || tr;
            });
        } catch (err) {
            console.log("Transcribe audio failed:", err.message);
            await bot.sendMessage(chatid, "Sorry, audio transcription failed: " + err.message, options);
            return;
        }
        const followUp = await withTypingAction(bot, chatid, options, () => chatCompletion({
            tools,
            tool_choice: "auto",
            messages: [...messages, responseMessage, { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ transcript: results, audio_url: args.audio_url }) }]
        }));
        return handleAIResponse(bot, chatid, options, followUp, messages, depth + 1);
    }

    if (toolCall.function.name === "transcribe_video") {
        let results;
        try {
            results = await withTypingAction(bot, chatid, options, async () => {
                await assertPublicHttpsUrl(args.video_url);
                const tmpVideoPath = path.join(os.tmpdir(), `${Date.now()}-toolvideo.mp4`);
                const tmpAudioPath = path.join(os.tmpdir(), `${Date.now()}-toolvideo.mp3`);
                await new Promise((resolve, reject) => {
                    const file = fs.createWriteStream(tmpVideoPath);
                    const req = https.get(args.video_url, (res) => {
                        if (res.statusCode >= 300 && res.statusCode < 400) {
                            req.destroy();
                            reject(new Error("redirects not allowed"));
                            return;
                        }
                        if (res.statusCode !== 200) {
                            req.destroy();
                            reject(new Error(`bad status ${res.statusCode}`));
                            return;
                        }
                        res.pipe(file);
                        file.on("finish", resolve);
                        file.on("error", reject);
                    }).on("error", reject);
                });
                await new Promise((resolve, reject) => {
                    ffmpeg(tmpVideoPath).noVideo().audioCodec("libmp3lame").audioBitrate(128).format("mp3").save(tmpAudioPath).on("end", resolve).on("error", reject);
                });
                const transcript = await groq.audio.transcriptions.create({
                    model: transcriptmodel,
                    file: fs.createReadStream(tmpAudioPath),
                    language: "en",
                    response_format: "verbose_json",
                    timestamp_granularities: ["word", "segment"]
                });
                fs.unlink(tmpVideoPath, () => {});
                fs.unlink(tmpAudioPath, () => {});
                return transcript.segments || transcript;
            });
        } catch (err) {
            console.log("Transcribe video failed:", err.message);
            await bot.sendMessage(chatid, "Sorry, video transcription failed: " + err.message, options);
            return;
        }
        const followUp = await withTypingAction(bot, chatid, options, () => chatCompletion({
            tools,
            tool_choice: "auto",
            messages: [...messages, responseMessage, { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ transcript: results, video_url: args.video_url, caption: args.caption || "" }) }]
        }));
        return handleAIResponse(bot, chatid, options, followUp, messages, depth + 1);
    }

    // create_file
    await withChatAction(bot, chatid, "upload_document", options, async () => {
        await userquery.findOneAndUpdate({
            userid: chatid
        }, {
            $push: {
                messages: {
                    role: "assistant",
                    content: args.message
                }
            }
        }, {
            upsert: true
        });

        const tempDir = os.tmpdir();
        const filename = path.join(tempDir, args.filename);

        if (args.filetype === "pdf") {
            const pdfDoc = new PDFDocument({ margin: 50 });
            const writableStream = new streamBuffers.WritableStreamBuffer();

            pdfDoc.pipe(writableStream);

            pdfDoc.font("Helvetica")
                .fontSize(12)
                .text(args.filecontent, {
                    align: "left"
                });

            pdfDoc.end();

            await new Promise(resolve =>
                writableStream.on("close", resolve)
            );

            const buffer = writableStream.getContents();

            await bot.sendDocument(chatid, buffer, {
                ...options,
                title: args.filename,
                caption: args.message
            });
        } else {
            fs.writeFileSync(filename, args.filecontent, "utf-8");

            await bot.sendDocument(chatid, filename, {
                ...options,
                caption: args.message
            });
        }
    });
    return;
}

//SUPER MESSAGE
const MAX_AI_RETRIES = 3;

export const message = (bot) => async (msg, businessConnectionId, attempt = 1) => {
    const chatid = msg.chat.id;
    console.log(msg);

    const options = {};
    if (businessConnectionId) {
        options.business_connection_id = businessConnectionId;
    }
    options.incomingMessageId = msg.message_id;


    //Message route
    try {
        if (msg.text) {

            const message = `text : ${msg.text}`;

            if (attempt === 1) await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "user",
                        content: message
                    }
                }
            }, {
                upsert: true
            });

            const historymessage = await userquery.findOne({ userid: chatid });

                const messages = [
                    {
                        role: "system",
                        content: systemprompt
                    },
                    ...historymessage.messages.slice(-6).map((element) => (
                        {
                            role: element.role,
                            content: element.content
                        }
                    ))
                ];

            const response = await withTypingAction(bot, chatid, options, () => chatCompletion({
                tools,
                tool_choice: "auto",
                messages
            }));
            await handleAIResponse(bot, chatid, options, response, messages);
        }
        //Photo route - tool-driven via analyze_image
        else if (msg.photo) {
            const fileid = msg.photo[msg.photo.length - 1].file_id;
            const filelink = await bot.getFileLink(fileid);
            const captionmsg = msg.caption ? `Caption : ${msg.caption}` : "";
            const imageMessage = `User sent an image at URL: ${filelink} ${captionmsg} - Call analyze_image with image_url to inspect it before answering.`;

            if (attempt === 1) await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "user",
                        content: imageMessage
                    }
                }
            }, {
                upsert: true
            });

            const historymessage = await userquery.findOne({ userid: chatid });

                const messages = [
                    {
                        role: "system",
                        content: systemprompt
                    },
                    ...historymessage.messages.slice(-6).map((element) => (
                        {
                            role: element.role,
                            content: element.content
                        }
                    ))
                ];

            const response2 = await withTypingAction(bot, chatid, options, () => chatCompletion({
                tools,
                tool_choice: "auto",
                messages
            }));

            await handleAIResponse(bot, chatid, options, response2, messages);
        }
        else if (msg.animation) {
            const fileid = msg.animation.file_id;
            const filelink = await bot.getFileLink(fileid);

            await bot.sendChatAction(chatid, "typing", options);

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

            const aimessage = imagetext;
            const gifanalyse = `Gif : ${aimessage}`;

            if (attempt === 1) await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "user",
                        content: gifanalyse
                    }
                }
            }, {
                upsert: true
            });

            const historymessage = await userquery.findOne({ userid: chatid });

                const messages = [
                    {
                        role: "system",
                        content: systemprompt
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
        else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith("video/")) {
            const fileid = msg.document.file_id;
            const filelink = await bot.getFileLink(fileid);
            const gifanalyse = `Gif : The user sent a video file clip.`;

            if (attempt === 1) await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "user",
                        content: gifanalyse
                    }
                }
            }, {
                upsert: true
            });

            const historymessage = await userquery.findOne({ userid: chatid });

                const messages = [
                    {
                        role: "system",
                        content: systemprompt
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
        else if (msg.sticker) {
            const fileid = msg.sticker.file_id;
            const filelink = await bot.getFileLink(fileid);

            if (msg.sticker.is_video || msg.sticker.is_animated) {
                const stickerEmoji = msg.sticker.emoji || "🫧";
                const aimessage = `The user sent an animated/video sticker showing the emoji: "${stickerEmoji}".`;
                const gifanalyse = `Gif : ${aimessage}`;

                if (attempt === 1) await userquery.findOneAndUpdate({
                    userid: chatid
                }, {
                    $push: {
                        messages: {
                            role: "user",
                            content: gifanalyse
                        }
                    }
                }, {
                    upsert: true
                });

                const historymessage = await userquery.findOne({ userid: chatid });

                    const messages = [
                        {
                            role: "system",
                            content: systemprompt
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
            } else {
                const imageMessage = `User sent a sticker image at URL: ${filelink} Emoji: ${msg.sticker.emoji || "🫧"} - Call analyze_image with image_url to inspect it before answering.`;

                if (attempt === 1) await userquery.findOneAndUpdate({
                    userid: chatid
                }, {
                    $push: {
                        messages: {
                            role: "user",
                            content: imageMessage
                        }
                    }
                }, {
                    upsert: true
                });

                const historymessage = await userquery.findOne({ userid: chatid });

                    const messages = [
                        {
                            role: "system",
                            content: systemprompt
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
        }
        //Voiceroute - tool-driven via transcribe_audio
        else if (msg.voice) {
            const fileid = msg.voice.file_id;
            const filelink = await bot.getFileLink(fileid);
            const voiceMessage = `User sent a voice message at URL: ${filelink} - Call transcribe_audio with audio_url to transcribe it before answering.`;

            if (attempt === 1) await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "user",
                        content: voiceMessage
                    }
                }
            }, {
                upsert: true
            });

            const historymessage = await userquery.findOne({ userid: chatid });

                const messages = [
                    {
                        role: "system",
                        content: systemprompt
                    },
                    ...historymessage.messages.slice(-6).map((element) => (
                        {
                            role: element.role,
                            content: element.content
                        }
                    ))
                ];

            const response = await withTypingAction(bot, chatid, options, () => chatCompletion({
                tools,
                tool_choice: "auto",
                messages
            }));

            await handleAIResponse(bot, chatid, options, response, messages);
        }
        //Video Transcript - tool-driven via transcribe_video
        else if (msg.video) {
            const fileid = msg.video.file_id;
            const filelink = await bot.getFileLink(fileid);
            const captiontext = msg.caption ? `Caption : ${msg.caption}` : "";
            const videoMessage = `User sent a video at URL: ${filelink} ${captiontext} - Call transcribe_video with video_url to transcribe it before answering.`;

            if (attempt === 1) await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "user",
                        content: videoMessage
                    }
                }
            }, {
                upsert: true
            });

            const historymessage = await userquery.findOne({ userid: chatid });
            const messages = [
                    {
                        role: "system",
                        content: systemprompt
                    },
                    ...historymessage.messages.slice(-6).map((element) => (
                        {
                            role: element.role,
                            content: element.content
                        }
                    ))
                ];

            const response = await withTypingAction(bot, chatid, options, () => chatCompletion({
                tools,
                tool_choice: "auto",
                messages
            }));

            await handleAIResponse(bot, chatid, options, response, messages);
        }
        //File route
        else if (msg.document) {
            const fileid = msg.document.file_id;
            const filelink = await bot.getFileLink(fileid);
            const filecontent = await fetch(filelink);
            const filebuffer = await filecontent.arrayBuffer();
            await bot.sendChatAction(chatid, "typing", options);
            const captiontext = msg.caption ? `text : ${msg.caption}` : "text : Please analyse this file";

            //Txt file route
            if (msg.document.mime_type === "text/plain") {

                const data = await filecontent.text();

                const textfiledata = `File(txt) : ${data}`;

                if (attempt === 1) await userquery.findOneAndUpdate({
                    userid: chatid
                }, {
                    $push: {
                        messages: {
                            role: "user",
                            content: `${textfiledata},${captiontext}`
                        }
                    }
                }, {
                    upsert: true
                });

                const historymessage = await userquery.findOne({ userid: chatid })

                const messages = [
                        {
                            role: "system",
                            content: systemprompt
                        },
                        ...historymessage.messages.slice(-6).map((element) => (
                            {
                                role: element.role,
                                content: element.content
                            }
                        ))
                    ];

                const response = await withTypingAction(bot, chatid, options, () => chatCompletion({
                tools,
                tool_choice: "auto",
                messages
            }));

                await handleAIResponse(bot, chatid, options, response, messages);
            }
            //PDF file route
            else if (msg.document.mime_type === "application/pdf") {

                const pdfText = await getPdfTextFromUrl(filelink);

                const pdffiledata = `PDF : ${pdfText}`;

                if (attempt === 1) await userquery.findOneAndUpdate({
                    userid: chatid
                }, {
                    $push: {
                        messages: {
                            role: "user",
                            content: `${pdffiledata},${captiontext}`
                        }
                    }
                }, {
                    upsert: true
                });

                const historymessage = await userquery.findOne({ userid: chatid })

                const messages = [
                        {
                            role: "system",
                            content: systemprompt
                        },
                        ...historymessage.messages.slice(-6).map((element) => (
                            {
                                role: element.role,
                                content: element.content
                            }
                        ))
                    ];

                const response = await withTypingAction(bot, chatid, options, () => chatCompletion({
                tools,
                tool_choice: "auto",
                messages
            }));

                await handleAIResponse(bot, chatid, options, response, messages);
            }
            //DOCX File route
            else if (msg.document.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
                const buffer = await Buffer.from(filebuffer);
                const result = await mammoth.extractRawText({ buffer: buffer });
                const docxfiledata = `DOCX : ${result.value}`;
                if (attempt === 1) await userquery.findOneAndUpdate({
                    userid: chatid
                }, {
                    $push: {
                        messages: {
                            role: "user",
                            content: `${docxfiledata},${captiontext}`
                        }
                    }
                }, {
                    upsert: true
                });

                const historymessage = await userquery.findOne({ userid: chatid })

                const messages = [
                        {
                            role: "system",
                            content: systemprompt
                        },
                        ...historymessage.messages.slice(-6).map((element) => (
                            {
                                role: element.role,
                                content: element.content
                            }
                        ))
                    ];

                const response = await withTypingAction(bot, chatid, options, () => chatCompletion({
                tools,
                tool_choice: "auto",
                messages
            }));

                await handleAIResponse(bot, chatid, options, response, messages);
            }
            else if (msg.document.mime_type === "image/png" || msg.document.mime_type === "image/jpeg") {
                const imageMessage = `User sent an image document at URL: ${filelink} ${captiontext} - Call analyze_image with image_url to inspect it before answering.`;

                if (attempt === 1) await userquery.findOneAndUpdate({
                    userid: chatid
                }, {
                    $push: {
                        messages: {
                            role: "user",
                            content: imageMessage
                        }
                    }
                }, {
                    upsert: true
                });

                const historymessage = await userquery.findOne({ userid: chatid });

                    const messages = [
                        {
                            role: "system",
                            content: systemprompt
                        },
                        ...historymessage.messages.slice(-6).map((element) => (
                            {
                                role: element.role,
                                content: element.content
                            }
                        ))
                    ];

                const response2 = await withTypingAction(bot, chatid, options, () => chatCompletion({
                tools,
                tool_choice: "auto",
                messages
            }));

                await handleAIResponse(bot, chatid, options, response2, messages);
            }
        }
        else if (msg.audio) {
            const fileid = msg.audio.file_id;
            const filelink = await bot.getFileLink(fileid);
            const audioMessage = `User sent an audio file at URL: ${filelink} Title: ${msg.audio.title || ""} Performer: ${msg.audio.performer || ""} - Call transcribe_audio with audio_url to transcribe it before answering.`;

            if (attempt === 1) await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "user",
                        content: audioMessage
                    }
                }
            }, {
                upsert: true
            });

            const historymessage = await userquery.findOne({ userid: chatid });
            const messages = [
                    {
                        role: "system",
                        content: systemprompt
                    },
                    ...historymessage.messages.slice(-6).map((element) => (
                        {
                            role: element.role,
                            content: element.content
                        }
                    ))
                ];

            const response = await withTypingAction(bot, chatid, options, () => chatCompletion({
                tools,
                tool_choice: "auto",
                messages
            }));
            await handleAIResponse(bot, chatid, options, response, messages);
        }
    } catch (err) {
        console.log(err);

        const networkCodes = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"];
        const isNetworkError = networkCodes.includes(err.code) || /network|fetch failed|ENOTFOUND|ETIMEDOUT/i.test(err.message || "");

        if (isNetworkError) {
            await sendBotMessage(bot, chatid, "Something went wrong. please try again.", options);
        } else if (attempt < MAX_AI_RETRIES) {
            console.log(`AI output error, retrying (${attempt}/${MAX_AI_RETRIES})`);
            await message(bot)(msg, businessConnectionId, attempt + 1);
        } else {
            console.log(`AI output failed after ${MAX_AI_RETRIES} attempts, giving up silently`);
            await sendBotMessage(bot, chatid, "Something went wrong. please try again.", options);
        }
    }
}
