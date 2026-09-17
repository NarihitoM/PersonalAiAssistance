import { groq, modelaudio, transcriptmodel, chatCompletion } from "./aiservice.js";
import { webSearch, webScrape, webCrawl, webMap, youtubeSearch, youtubeTranscript } from "./firecrawlservice.js";
import { generateImage, editImage } from "./imageservice.js";
import { analyzeImage, assertPublicHttpsUrl } from "./geminiservice.js";
import { systempromptforimage } from "../prompts/systemprompt.js";
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
import { withPhotoAction, withTypingAction, withChatAction, checkImageCooldown, sendBotMessage } from "../utils/utils.js";

ffmpeg.setFfmpegPath(ffmpegPath);

const MAX_TOOL_DEPTH = 5;



export async function handleAIResponse(bot, chatid, options, response, messages, depth = 0) {
    if (depth > MAX_TOOL_DEPTH) {
        console.log(`handleAIResponse max depth ${MAX_TOOL_DEPTH} reached, stopping`);
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
        const cleanCaption = String(args.message || "").replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim();
        const speech = await withChatAction(bot, chatid, "upload_voice", options, () => groq.audio.speech.create({
            model: modelaudio,
            voice: "hannah",
            input: args.audiocontent,
            response_format: "wav"
        }));

        const buffer = Buffer.from(await speech.arrayBuffer());

        await bot.sendAudio(chatid, buffer, {
            ...options,
            caption: cleanCaption,
            title: args.audioname,
            performer: "Narihito Assistant"
        });

        await userquery.findOneAndUpdate({ userid: chatid }, {
            $push: { messages: { role: "assistant", content: cleanCaption } }
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
                $push: { messages: { role: "assistant", content: args.message } }
            }, { upsert: true });
        } catch (err) {
            console.log("Image generation failed:", err.message);
            await sendBotMessage(bot, chatid, "Something went wrong. Please try again.", options);
            await userquery.findOneAndUpdate({ userid: chatid }, {
                $push: { messages: { role: "assistant", content: "Something went wrong. Please try again." } }
            }, { upsert: true });
        }
        return;
    }

    if (toolCall.function.name === "edit_image") {
        const cooldown = await checkImageCooldown(chatid);
        if (!cooldown.allowed) {
            await bot.sendMessage(chatid, `Please wait ${cooldown.remainingMin} more minute(s) before editing another image.`, options);
            return;
        }

        try {
            const image = await withPhotoAction(bot, chatid, options, () => editImage(args.image_url, args.prompt, { timeoutMs: 60000 }));

            await userquery.findOneAndUpdate({ userid: chatid }, { lastImageGeneratedAt: new Date() });

            await bot.sendPhoto(chatid, image, {
                ...options,
                caption: args.message
            });

            await userquery.findOneAndUpdate({ userid: chatid }, {
                $push: { messages: { role: "assistant", content: args.message } }
            }, { upsert: true });
        } catch (err) {
            console.log("Image edit failed:", err.message);
            await sendBotMessage(bot, chatid, "Something went wrong. Please try again.", options);
            await userquery.findOneAndUpdate({ userid: chatid }, {
                $push: { messages: { role: "assistant", content: "Something went wrong. Please try again." } }
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
            await sendBotMessage(bot, chatid, "Something went wrong. Please try again.", options);
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
            await sendBotMessage(bot, chatid, "Something went wrong. Please try again.", options);
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
            await sendBotMessage(bot, chatid, "Something went wrong. Please try again.", options);
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
            await sendBotMessage(bot, chatid, "Something went wrong. Please try again.", options);
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
                $push: { messages: { role: "assistant", content: args.message || `Poll: ${args.question}` } }
            }, { upsert: true });
        } catch (err) {
            console.log("Create poll failed:", err.message);
            await sendBotMessage(bot, chatid, "Something went wrong. Please try again.", options);
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
                $push: { messages: { role: "assistant", content: args.message || `Location: ${args.title || `${args.latitude},${args.longitude}`}` } }
            }, { upsert: true });
        } catch (err) {
            console.log("Send location failed:", err.message);
            await sendBotMessage(bot, chatid, "Something went wrong. Please try again.", options);
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

    if (toolCall.function.name === "youtube_search") {
        let results;
        try {
            results = await withTypingAction(bot, chatid, options, () => youtubeSearch(args.query, { limit: args.limit }));
        } catch (err) {
            console.log("YouTube search failed:", err.message);
            await sendBotMessage(bot, chatid, "Something went wrong. Please try again.", options);
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
            await sendBotMessage(bot, chatid, "Something went wrong. Please try again.", options);
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
            await sendBotMessage(bot, chatid, "Something went wrong. Please try again.", options);
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
            await sendBotMessage(bot, chatid, "Something went wrong. Please try again.", options);
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
            await sendBotMessage(bot, chatid, "Something went wrong. Please try again.", options);
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
