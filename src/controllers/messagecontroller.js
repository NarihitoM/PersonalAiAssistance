import { chatCompletion } from "../services/aiservice.js";
import { analyzeImageBuffer } from "../services/geminiservice.js";
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
import { withTypingAction, sendBotMessage, getPdfTextFromUrl } from "../utils/utils.js";

ffmpeg.setFfmpegPath(ffmpegPath);

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
                        content: getSystemPrompt()
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
                        content: getSystemPrompt()
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
                        content: getSystemPrompt()
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
                        content: getSystemPrompt()
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
                            content: getSystemPrompt()
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
                            content: getSystemPrompt()
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
                            content: getSystemPrompt()
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
                            content: getSystemPrompt()
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
                        content: getSystemPrompt()
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
