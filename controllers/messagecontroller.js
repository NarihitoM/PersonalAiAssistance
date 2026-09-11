import { groq, analyzeImage, generateImage } from "../config/aiservice.js";
import telegramifyMarkdown from "telegramify-markdown";
import mammoth from "mammoth";
import { systemprompt, systempromptforimage } from "../prompt/systemprompt.js";
import userquery from "../model/userquery.js";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import path from "path";
import os from "os";
import https from "https";
import fs from "fs";
import supabase from "../config/supabaseservice.js";
import axios from "axios";
import PDFParser from "pdf2json";
import PDFDocument from "pdfkit";
import streamBuffers from "stream-buffers";

//Model
const model = "openai/gpt-oss-120b"
const modelaudio = "canopylabs/orpheus-v1-english"
const transcriptmodel = "whisper-large-v3-turbo"

ffmpeg.setFfmpegPath(ffmpegPath);

//Image generation cooldown
const IMAGE_COOLDOWN_MS = 60 * 60 * 1000;

async function withPhotoAction(bot, chatid, options, task) {
    await bot.sendChatAction(chatid, "upload_photo", options);
    const interval = setInterval(() => bot.sendChatAction(chatid, "upload_photo", options), 4000);

    try {
        return await task();
    } finally {
        clearInterval(interval);
    }
}

async function checkImageCooldown(chatid) {
    const user = await userquery.findOne({ userid: chatid });
    const last = user?.lastImageGeneratedAt;

    if (last && Date.now() - last.getTime() < IMAGE_COOLDOWN_MS) {
        const remainingMin = Math.ceil((IMAGE_COOLDOWN_MS - (Date.now() - last.getTime())) / 60000);
        return { allowed: false, remainingMin };
    }

    return { allowed: true };
}

//Styling
async function sendBotMessage(bot, chatid, text, options = {}) {
    await bot.sendChatAction(chatid, "typing", options);
    const sendOptions = { ...options };

    try {
        await bot.sendMessage(chatid, telegramifyMarkdown(text, "remove"), { ...sendOptions, parse_mode: "MarkdownV2" });
    } catch (err) {
        console.log("sendBotMessage parse failed, falling back to plain text:", err.message);
        await bot.sendMessage(chatid, text, sendOptions);
    }
}

//Decode PDF FIle(I ASK AI LOL)
const getPdfTextFromUrl = async (fileUrl) => {
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


//SUPER MESSAGE
const MAX_AI_RETRIES = 3;

export const message = (bot) => async (msg, businessConnectionId, attempt = 1) => {
    const chatid = msg.chat.id;
    console.log(msg);

    const options = {};
    if (businessConnectionId) {
        options.business_connection_id = businessConnectionId;
    }


    //Message route
    try {
        if (msg.text) {

            const message = `text : ${msg.text}`;

            await bot.sendChatAction(chatid, "typing", options);


            await userquery.findOneAndUpdate({
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
            await bot.sendChatAction(chatid, "typing", options);

            const response = await groq.chat.completions.create({
                model: model,
                messages: [
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
                ]
            });
            const aimessage = response.choices[0].message.content;
            //Fileroute
            if (aimessage.startsWith("{") && aimessage.endsWith("}")) {
                const fileroute = JSON.parse(aimessage);

                if (fileroute.type === "audio") {
                    await bot.sendChatAction(chatid, "upload_voice", options);

                    const response = await groq.audio.speech.create({
                        model: modelaudio,
                        voice: "hannah",

                        input: fileroute.audiocontent,
                        response_format: "wav"
                    });

                    const buffer = Buffer.from(await response.arrayBuffer());

                    await bot.sendAudio(chatid, buffer, {
                        ...options,
                        caption: fileroute.message,
                        title: fileroute.audioname,
                        performer: fileroute.performer
                    })
                }

                else if (fileroute.type === "image") {
                    const cooldown = await checkImageCooldown(chatid);
                    if (!cooldown.allowed) {
                        await bot.sendMessage(chatid, `Please wait ${cooldown.remainingMin} more minute(s) before generating another image.`, options);
                        return;
                    }

                    const image = await withPhotoAction(bot, chatid, options, () => generateImage(fileroute.prompt));

                    await userquery.findOneAndUpdate({ userid: chatid }, { lastImageGeneratedAt: new Date() });

                    await bot.sendPhoto(chatid, image, {
                        ...options,
                        caption: fileroute.message
                    });
                }

                else {
                    await bot.sendChatAction(chatid, "upload_document", options);

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
                    })

                    const tempDir = os.tmpdir();
                    const filename = path.join(tempDir, fileroute.filename);

                    if (fileroute.filetype === "pdf") {
                        const pdfDoc = new PDFDocument({ margin: 50 });
                        const writableStream = new streamBuffers.WritableStreamBuffer();

                        pdfDoc.pipe(writableStream);

                        pdfDoc.font("Helvetica")
                            .fontSize(12)
                            .text(fileroute.filecontent, {
                                align: "left"
                            });

                        pdfDoc.end();

                        await new Promise(resolve =>
                            writableStream.on("close", resolve)
                        );

                        const buffer = writableStream.getContents();

                        await bot.sendDocument(chatid, buffer, {
                            ...options,
                            title: fileroute.filename,
                            caption: fileroute.message
                        });
                    }
                    else {
                        fs.writeFileSync(filename, fileroute.filecontent, "utf-8");

                        await bot.sendDocument(chatid, filename, {
                            ...options,
                            caption: fileroute.message
                        });
                    }
                }
            }
            else {
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
            }
        }
        //Photo route
        else if (msg.photo) {
            const fileid = msg.photo[msg.photo.length - 1].file_id;
            const filelink = await bot.getFileLink(fileid);
            const captionmsg = msg.caption ? `Caption : ${msg.caption}` : "";

            await bot.sendChatAction(chatid, "upload_photo", options)

            const imagetext1 = await analyzeImage(systempromptforimage, filelink, captionmsg);

            const aimessage1 = `image : ${imagetext1}`;

            await bot.sendChatAction(chatid, "typing", options);


            await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "user",
                        content: `${aimessage1},${captionmsg}`
                    }
                }
            }, {
                upsert: true
            });

            const historymessage = await userquery.findOne({ userid: chatid });

            const response2 = await groq.chat.completions.create({
                model: model,
                messages: [
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
                ]
            });

            const aimessage2 = response2.choices[0].message.content;

            console.log(aimessage2);

            //File route
            if (aimessage2.startsWith("{") && aimessage2.endsWith("}")) {
                const fileroute = JSON.parse(aimessage2);

                if (fileroute.type === "audio") {
                    await bot.sendChatAction(chatid, "upload_voice", options);

                    const response = await groq.audio.speech.create({
                        model: modelaudio,
                        voice: "hannah",
                        input: fileroute.audiocontent,
                        response_format: "wav"
                    });

                    const buffer = Buffer.from(await response.arrayBuffer());

                    await bot.sendAudio(chatid, buffer, {
                        ...options,
                        caption: fileroute.message,
                        title: fileroute.audioname,
                        performer: fileroute.performer
                    })
                }

                else if (fileroute.type === "image") {
                    const cooldown = await checkImageCooldown(chatid);
                    if (!cooldown.allowed) {
                        await bot.sendMessage(chatid, `Please wait ${cooldown.remainingMin} more minute(s) before generating another image.`, options);
                        return;
                    }

                    const image = await withPhotoAction(bot, chatid, options, () => generateImage(fileroute.prompt));

                    await userquery.findOneAndUpdate({ userid: chatid }, { lastImageGeneratedAt: new Date() });

                    await bot.sendPhoto(chatid, image, {
                        ...options,
                        caption: fileroute.message
                    });
                }
                else {
                    await bot.sendChatAction(chatid, "upload_document", options);

                    await userquery.findOneAndUpdate({
                        userid: chatid
                    }, {
                        $push: {
                            messages: {
                                role: "assistant",
                                content: aimessage2
                            }
                        }
                    }, {
                        upsert: true
                    })

                    const tempDir = os.tmpdir();
                    const filename = path.join(tempDir, fileroute.filename);

                    if (fileroute.filetype === "pdf") {
                        const pdfDoc = new PDFDocument({ margin: 50 });
                        const writableStream = new streamBuffers.WritableStreamBuffer();

                        pdfDoc.pipe(writableStream);

                        pdfDoc.font("Helvetica")
                            .fontSize(12)
                            .text(fileroute.filecontent, {
                                align: "left"
                            });

                        pdfDoc.end();

                        await new Promise(resolve =>
                            writableStream.on("close", resolve)
                        );

                        const buffer = writableStream.getContents();

                        await bot.sendDocument(chatid, buffer, {
                            ...options,
                            title: fileroute.filename,
                            caption: fileroute.message
                        });
                    }
                    else {
                        fs.writeFileSync(filename, fileroute.filecontent, "utf-8");

                        await bot.sendDocument(chatid, filename, {
                            ...options,
                            caption: fileroute.message
                        });
                    }
                }
            }
            else {
                await userquery.findOneAndUpdate({
                    userid: chatid
                }, {
                    $push: {
                        messages: {
                            role: "assistant",
                            content: aimessage2
                        }
                    }
                }, {
                    upsert: true
                });

                await sendBotMessage(bot, chatid, aimessage2, options);
            }
        }
        else if (msg.animation) {
            const fileid = msg.animation.file_id;
            const filelink = await bot.getFileLink(fileid);

            await bot.sendChatAction(chatid, "upload_video", options);

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

            await bot.sendChatAction(chatid, "typing", options);

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

            const screenshotBuffer = fs.createReadStream(tmpScreenshotPath);
            const screenshotFilename = `SS-Anim-${Date.now()}.jpg`;

            const { error: ssError } = await supabase.storage
                .from("image-video")
                .upload(screenshotFilename, screenshotBuffer, {
                    upsert: true,
                    contentType: 'image/jpeg'
                });

            if (ssError) {
                console.log(ssError);
            }

            const { data: ssData } = await supabase.storage
                .from("image-video")
                .getPublicUrl(screenshotFilename);

            const finalScreenshotUrl = ssData.publicUrl;

            const imagetext = await analyzeImage(systempromptforimage, finalScreenshotUrl);

            const { error: removeError } = await supabase.storage
                .from("audio")
                .remove([screenshotFilename]);

            if (removeError) {
                console.log(removeError);
            }

            const aimessage = imagetext;
            const gifanalyse = `Gif : ${aimessage}`;

            await userquery.findOneAndUpdate({
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

            await bot.sendChatAction(chatid, "typing", options);

            const response = await groq.chat.completions.create({
                model: model,
                messages: [
                    {
                        role: "system",
                        content: systemprompt
                    },
                    ...historymessage.messages.slice(-6).map((element) => ({
                        role: element.role,
                        content: element.content
                    }))
                ]
            });

            const finalaireply = response.choices[0].message.content;

            await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "assistant",
                        content: finalaireply
                    }
                }
            }, {
                upsert: true
            });

            await sendBotMessage(bot, chatid, finalaireply, options);
        }
        else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith("video/")) {
            const fileid = msg.document.file_id;
            const filelink = await bot.getFileLink(fileid);
            const gifanalyse = `Gif : The user sent a video file clip.`;

            await userquery.findOneAndUpdate({
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

            await bot.sendChatAction(chatid, "typing", options);

            const response = await groq.chat.completions.create({
                model: model,
                messages: [
                    {
                        role: "system",
                        content: systemprompt
                    },
                    ...historymessage.messages.slice(-6).map((element) => ({
                        role: element.role,
                        content: element.content
                    }))
                ]
            });

            const finalaireply = response.choices[0].message.content;

            await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "assistant",
                        content: finalaireply
                    }
                }
            }, {
                upsert: true
            });

            await sendBotMessage(bot, chatid, finalaireply, options);
        }
        else if (msg.sticker) {
            const fileid = msg.sticker.file_id;
            const filelink = await bot.getFileLink(fileid);

            if (msg.sticker.is_video || msg.sticker.is_animated) {
                const stickerEmoji = msg.sticker.emoji || "🫧";
                const aimessage = `The user sent an animated/video sticker showing the emoji: "${stickerEmoji}".`;
                const gifanalyse = `Gif : ${aimessage}`;

                await userquery.findOneAndUpdate({
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

                await bot.sendChatAction(chatid, "typing", options);

                const response = await groq.chat.completions.create({
                    model: model,
                    messages: [
                        {
                            role: "system",
                            content: systemprompt
                        },
                        ...historymessage.messages.slice(-6).map((element) => ({
                            role: element.role,
                            content: element.content
                        }))
                    ]
                });

                const finalaireply = response.choices[0].message.content;

                await userquery.findOneAndUpdate({
                    userid: chatid
                }, {
                    $push: {
                        messages: {
                            role: "assistant",
                            content: finalaireply
                        }
                    }
                }, {
                    upsert: true
                });

                await sendBotMessage(bot, chatid, finalaireply, options);
            } else {
                await bot.sendChatAction(chatid, "upload_photo", options);
                const imagetext = await analyzeImage(systempromptforimage, filelink);

                const aimessage = imagetext;
                const gifanalyse = `Gif : ${aimessage}`;

                await userquery.findOneAndUpdate({
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

                await bot.sendChatAction(chatid, "typing", options);

                const response = await groq.chat.completions.create({
                    model: model,
                    messages: [
                        {
                            role: "system",
                            content: systemprompt
                        },
                        ...historymessage.messages.slice(-6).map((element) => ({
                            role: element.role,
                            content: element.content
                        }))
                    ]
                });

                const finalaireply = response.choices[0].message.content;

                await userquery.findOneAndUpdate({
                    userid: chatid
                }, {
                    $push: {
                        messages: {
                            role: "assistant",
                            content: finalaireply
                        }
                    }
                }, {
                    upsert: true
                });

                await sendBotMessage(bot, chatid, finalaireply, options);
            }
        }
        //Voiceroute
        else if (msg.voice) {
            const fileid = msg.voice.file_id;
            const filelink = await bot.getFileLink(fileid);

            await bot.sendChatAction(chatid, "upload_video", options)

            const transcription = await groq.audio.transcriptions.create({
                model: transcriptmodel,
                prompt: "Please reply only in english. with correct grammar and vocabulary.",
                language: "en",
                url: filelink
            })

            const transcripttext = `Voice : ${transcription.text}`;



            await bot.sendChatAction(chatid, "typing", options);

            await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "user",
                        content: transcripttext
                    }
                }
            }, {
                upsert: true
            });

            const historymessage = await userquery.findOne({ userid: chatid });

            const response = await groq.chat.completions.create({
                model: model,
                messages: [
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
                ]
            });

            const aimessage = response.choices[0].message.content;
            //File route
            if (aimessage.startsWith("{") && aimessage.endsWith("}")) {
                const fileroute = JSON.parse(aimessage);

                if (fileroute.type === "audio") {
                    await bot.sendChatAction(chatid, "upload_voice", options);

                    const response = await groq.audio.speech.create({
                        model: modelaudio,
                        voice: "hannah",

                        input: fileroute.audiocontent,
                        response_format: "wav"
                    });

                    const buffer = Buffer.from(await response.arrayBuffer());

                    await bot.sendAudio(chatid, buffer, {
                        ...options,
                        caption: fileroute.message,
                        title: fileroute.audioname,
                        performer: fileroute.performer
                    })
                }

                else if (fileroute.type === "image") {
                    const cooldown = await checkImageCooldown(chatid);
                    if (!cooldown.allowed) {
                        await bot.sendMessage(chatid, `Please wait ${cooldown.remainingMin} more minute(s) before generating another image.`, options);
                        return;
                    }

                    const image = await withPhotoAction(bot, chatid, options, () => generateImage(fileroute.prompt));

                    await userquery.findOneAndUpdate({ userid: chatid }, { lastImageGeneratedAt: new Date() });

                    await bot.sendPhoto(chatid, image, {
                        ...options,
                        caption: fileroute.message
                    });
                }
                else {
                    await bot.sendChatAction(chatid, "upload_document", options);

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
                    })

                    const tempDir = os.tmpdir();
                    const filename = path.join(tempDir, fileroute.filename);

                    if (fileroute.filetype === "pdf") {
                        const pdfDoc = new PDFDocument({ margin: 50 });
                        const writableStream = new streamBuffers.WritableStreamBuffer();

                        pdfDoc.pipe(writableStream);

                        pdfDoc.font("Helvetica")
                            .fontSize(12)
                            .text(fileroute.filecontent, {
                                align: "left"
                            });

                        pdfDoc.end();

                        await new Promise(resolve =>
                            writableStream.on("close", resolve)
                        );

                        const buffer = writableStream.getContents();

                        await bot.sendDocument(chatid, buffer, {
                            ...options,
                            title: fileroute.filename,
                            caption: fileroute.message
                        });
                    }
                    else {
                        fs.writeFileSync(filename, fileroute.filecontent, "utf-8");

                        await bot.sendDocument(chatid, filename, {
                            ...options,
                            caption: fileroute.message
                        });
                    }
                }
            }
            else {
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
            }
        }
        //Video Transcript
        else if (msg.video) {
            console.log(msg.caption);

            const fileid = msg.video.file_id;
            const filelink = await bot.getFileLink(fileid);

            await bot.sendChatAction(chatid, "upload_video", options);

            const tmpVideoPath = path.join(os.tmpdir(), `${Date.now()}.mp4`);
            const tmpAudioPath = path.join(os.tmpdir(), `${Date.now()}.mp3`);
            const audiofilename = `Audio-${Date.now()}.mp3`

            await bot.sendChatAction(chatid, "upload_video", options);

            //Read the buffer value from url
            await new Promise((resolve, reject) => {
                const file = fs.createWriteStream(tmpVideoPath);
                https.get(filelink, (res) => {
                    res.pipe(file);
                    file.on("finish", resolve);
                    file.on("error", reject);
                }).on("error", reject);
            });

            await bot.sendChatAction(chatid, "upload_video", options);

            //Put the content into audio path
            await new Promise((resolve, reject) => {
                ffmpeg(tmpVideoPath)
                    .noVideo()
                    .audioCodec("libmp3lame")
                    .audioBitrate(128)
                    .format("mp3")
                    .save(tmpAudioPath)
                    .on("end", resolve)
                    .on("error", reject);
            });

            //content to change buffer
            const audiobuffer = fs.createReadStream(tmpAudioPath);

            await bot.sendChatAction(chatid, "upload_video", options);

            const { error } = await supabase.storage.from("audio").upload(audiofilename, audiobuffer, {
                upsert: true
            })
            if (error) {
                console.log(error);
            }

            const { data } = await supabase.storage.from("audio").getPublicUrl(audiofilename);
            const finalaudiourl = data.publicUrl;



            await bot.sendChatAction(chatid, "upload_video", options);

            const transcript = await groq.audio.transcriptions.create({
                model: transcriptmodel,
                url: finalaudiourl,
                language: "en",
                response_format: "verbose_json",
                timestamp_granularities: ["word", "segment"]
            });


            const { error: err } = await supabase.storage.from("audio").remove(audiofilename);
            if (err) {
                console.log(err);
            }

            const datalist = `VideoTranscript : ${JSON.stringify(transcript.segments)}`;
            const captiontext = msg.caption ? `text : ${msg.caption}` : "text : Please transcript this";

            await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "user",
                        content: `${datalist},${captiontext}`
                    }
                }
            }, {
                upsert: true
            });

            const historymessage = await userquery.findOne({ userid: chatid });
            await bot.sendChatAction(chatid, "typing", options);

            const response = await groq.chat.completions.create({
                model: model,
                messages: [
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
                ]
            });

            const aimessage = response.choices[0].message.content;
            //Fileroute
            if (aimessage.startsWith("{") && aimessage.endsWith("}")) {
                const fileroute = JSON.parse(aimessage);

                if (fileroute.type === "audio") {
                    await bot.sendChatAction(chatid, "upload_voice", options);

                    const response = await groq.audio.speech.create({
                        model: modelaudio,
                        voice: "hannah",

                        input: fileroute.audiocontent,
                        response_format: "wav"
                    });

                    const buffer = Buffer.from(await response.arrayBuffer());

                    await bot.sendAudio(chatid, buffer, {
                        ...options,
                        caption: fileroute.message,
                        title: fileroute.audioname,
                        performer: fileroute.performer
                    })
                }

                else if (fileroute.type === "image") {
                    const cooldown = await checkImageCooldown(chatid);
                    if (!cooldown.allowed) {
                        await bot.sendMessage(chatid, `Please wait ${cooldown.remainingMin} more minute(s) before generating another image.`, options);
                        return;
                    }

                    const image = await withPhotoAction(bot, chatid, options, () => generateImage(fileroute.prompt));

                    await userquery.findOneAndUpdate({ userid: chatid }, { lastImageGeneratedAt: new Date() });

                    await bot.sendPhoto(chatid, image, {
                        ...options,
                        caption: fileroute.message
                    });
                }
                else {
                    await bot.sendChatAction(chatid, "upload_document", options);

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
                    })

                    const tempDir = os.tmpdir();
                    const filename = path.join(tempDir, fileroute.filename);

                    if (fileroute.filetype === "pdf") {
                        const pdfDoc = new PDFDocument({ margin: 50 });
                        const writableStream = new streamBuffers.WritableStreamBuffer();

                        pdfDoc.pipe(writableStream);

                        pdfDoc.font("Helvetica")
                            .fontSize(12)
                            .text(fileroute.filecontent, {
                                align: "left"
                            });

                        pdfDoc.end();

                        await new Promise(resolve =>
                            writableStream.on("close", resolve)
                        );

                        const buffer = writableStream.getContents();

                        await bot.sendDocument(chatid, buffer, {
                            ...options,
                            title: fileroute.filename,
                            caption: fileroute.message
                        });
                    }
                    else {
                        fs.writeFileSync(filename, fileroute.filecontent, "utf-8");

                        await bot.sendDocument(chatid, filename, {
                            ...options,
                            caption: fileroute.message
                        });
                    }
                }
            }
            else {
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
            }
        }
        //File route
        else if (msg.document) {
            const fileid = msg.document.file_id;
            const filelink = await bot.getFileLink(fileid);
            const filecontent = await fetch(filelink);
            const filebuffer = await filecontent.arrayBuffer();
            await bot.sendChatAction(chatid, "upload_document", options);
            const captiontext = msg.caption ? `text : ${msg.caption}` : "text : Please analyse this file";

            //Txt file route
            if (msg.document.mime_type === "text/plain") {

                const data = await filecontent.text();

                const textfiledata = `File(txt) : ${data}`;

                await userquery.findOneAndUpdate({
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

                await bot.sendChatAction(chatid, "typing", options);
                const response = await groq.chat.completions.create({
                    model: model,
                    messages: [
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
                    ]
                });

                const aimessage = response.choices[0].message.content;
                if (aimessage.startsWith("{") && aimessage.endsWith("}")) {
                    const fileroute = JSON.parse(aimessage);

                    if (fileroute.type === "audio") {
                        await bot.sendChatAction(chatid, "upload_voice", options);

                        const response = await groq.audio.speech.create({
                            model: modelaudio,
                            voice: "hannah",

                            input: fileroute.audiocontent,
                            response_format: "wav"
                        });

                        const buffer = Buffer.from(await response.arrayBuffer());

                        await bot.sendAudio(chatid, buffer, {
                            ...options,
                            caption: fileroute.message,
                            title: fileroute.audioname,
                            performer: fileroute.performer
                        })
                    }

                    else if (fileroute.type === "image") {
                        const cooldown = await checkImageCooldown(chatid);
                        if (!cooldown.allowed) {
                            await bot.sendMessage(chatid, `Please wait ${cooldown.remainingMin} more minute(s) before generating another image.`, options);
                            return;
                        }

                        const image = await withPhotoAction(bot, chatid, options, () => generateImage(fileroute.prompt));

                        await userquery.findOneAndUpdate({ userid: chatid }, { lastImageGeneratedAt: new Date() });

                        await bot.sendPhoto(chatid, image, {
                            ...options,
                            caption: fileroute.message
                        });
                    }
                    else {
                        await bot.sendChatAction(chatid, "upload_document", options);

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
                        })

                        const tempDir = os.tmpdir();
                        const filename = path.join(tempDir, fileroute.filename);

                        if (fileroute.filetype === "pdf") {
                            const pdfDoc = new PDFDocument({ margin: 50 });
                            const writableStream = new streamBuffers.WritableStreamBuffer();

                            pdfDoc.pipe(writableStream);

                            pdfDoc.font("Helvetica")
                                .fontSize(12)
                                .text(fileroute.filecontent, {
                                    align: "left"
                                });

                            pdfDoc.end();

                            await new Promise(resolve =>
                                writableStream.on("close", resolve)
                            );

                            const buffer = writableStream.getContents();

                            await bot.sendDocument(chatid, buffer, {
                                ...options,
                                title: fileroute.filename,
                                caption: fileroute.message
                            });
                        }
                        else {
                            fs.writeFileSync(filename, fileroute.filecontent, "utf-8");

                            await bot.sendDocument(chatid, filename, {
                                ...options,
                                caption: fileroute.message
                            });
                        }
                    }
                }
                else {
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
                }
            }
            //PDF file route
            else if (msg.document.mime_type === "application/pdf") {

                const pdfText = await getPdfTextFromUrl(filelink);

                const pdffiledata = `PDF : ${pdfText}`;

                await userquery.findOneAndUpdate({
                    userid: chatid
                }, {
                    $push: {
                        messages: {
                            role: "user",
                            content: `${pdffiledata},${captiontext},${RAGresult}`
                        }
                    }
                }, {
                    upsert: true
                });

                const historymessage = await userquery.findOne({ userid: chatid })

                await bot.sendChatAction(chatid, "typing", options);
                const response = await groq.chat.completions.create({
                    model: model,
                    messages: [
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
                    ]
                });

                const aimessage = response.choices[0].message.content;
                if (aimessage.startsWith("{") && aimessage.endsWith("}")) {
                    const fileroute = JSON.parse(aimessage);
                    if (fileroute.type === "audio") {
                        await bot.sendChatAction(chatid, "upload_voice", options);

                        const response = await groq.audio.speech.create({
                            model: modelaudio,
                            voice: "hannah",

                            input: fileroute.audiocontent,
                            response_format: "wav"
                        });

                        const buffer = Buffer.from(await response.arrayBuffer());

                        await bot.sendAudio(chatid, buffer, {
                            ...options,
                            caption: fileroute.message,
                            title: fileroute.audioname,
                            performer: fileroute.performer
                        })
                    }

                    else if (fileroute.type === "image") {
                        const cooldown = await checkImageCooldown(chatid);
                        if (!cooldown.allowed) {
                            await bot.sendMessage(chatid, `Please wait ${cooldown.remainingMin} more minute(s) before generating another image.`, options);
                            return;
                        }

                        const image = await withPhotoAction(bot, chatid, options, () => generateImage(fileroute.prompt));

                        await userquery.findOneAndUpdate({ userid: chatid }, { lastImageGeneratedAt: new Date() });

                        await bot.sendPhoto(chatid, image, {
                            ...options,
                            caption: fileroute.message
                        });
                    }
                    else {
                        await bot.sendChatAction(chatid, "upload_document", options);

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
                        })

                        const tempDir = os.tmpdir();
                        const filename = path.join(tempDir, fileroute.filename);

                        if (fileroute.filetype === "pdf") {
                            const pdfDoc = new PDFDocument({ margin: 50 });
                            const writableStream = new streamBuffers.WritableStreamBuffer();

                            pdfDoc.pipe(writableStream);

                            pdfDoc.font("Helvetica")
                                .fontSize(12)
                                .text(fileroute.filecontent, {
                                    align: "left"
                                });

                            pdfDoc.end();

                            await new Promise(resolve =>
                                writableStream.on("close", resolve)
                            );

                            const buffer = writableStream.getContents();

                            await bot.sendDocument(chatid, buffer, {
                                ...options,
                                title: fileroute.filename,
                                caption: fileroute.message
                            });
                        }
                        else {
                            fs.writeFileSync(filename, fileroute.filecontent, "utf-8");

                            await bot.sendDocument(chatid, filename, {
                                ...options,
                                caption: fileroute.message
                            });
                        }
                    }
                }
                else {
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
                }
            }
            //DOCX File route
            else if (msg.document.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
                const buffer = await Buffer.from(filebuffer);
                const result = await mammoth.extractRawText({ buffer: buffer });
                const docxfiledata = `DOCX : ${result.value}`;
                await userquery.findOneAndUpdate({
                    userid: chatid
                }, {
                    $push: {
                        messages: {
                            role: "user",
                            content: `${docxfiledata},${captiontext},${RAGresult}`
                        }
                    }
                }, {
                    upsert: true
                });

                const historymessage = await userquery.findOne({ userid: chatid })

                await bot.sendChatAction(chatid, "typing", options);
                const response = await groq.chat.completions.create({
                    model: model,
                    messages: [
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
                    ]
                });

                const aimessage = response.choices[0].message.content;
                if (aimessage.startsWith("{") && aimessage.endsWith("}")) {
                    const fileroute = JSON.parse(aimessage);
                    if (fileroute.type === "audio") {
                        await bot.sendChatAction(chatid, "upload_voice", options);

                        const response = await groq.audio.speech.create({
                            model: modelaudio,
                            voice: "hannah",

                            input: fileroute.audiocontent,
                            response_format: "wav"
                        });

                        const buffer = Buffer.from(await response.arrayBuffer());

                        await bot.sendAudio(chatid, buffer, {
                            ...options,
                            caption: fileroute.message,
                            title: fileroute.audioname,
                            performer: fileroute.performer
                        })
                    }

                    else if (fileroute.type === "image") {
                        const cooldown = await checkImageCooldown(chatid);
                        if (!cooldown.allowed) {
                            await bot.sendMessage(chatid, `Please wait ${cooldown.remainingMin} more minute(s) before generating another image.`, options);
                            return;
                        }

                        const image = await withPhotoAction(bot, chatid, options, () => generateImage(fileroute.prompt));

                        await userquery.findOneAndUpdate({ userid: chatid }, { lastImageGeneratedAt: new Date() });

                        await bot.sendPhoto(chatid, image, {
                            ...options,
                            caption: fileroute.message
                        });
                    }
                    else {
                        await bot.sendChatAction(chatid, "upload_document", options);

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
                        })

                        const tempDir = os.tmpdir();
                        const filename = path.join(tempDir, fileroute.filename);

                        if (fileroute.filetype === "pdf") {
                            const pdfDoc = new PDFDocument({ margin: 50 });
                            const writableStream = new streamBuffers.WritableStreamBuffer();

                            pdfDoc.pipe(writableStream);

                            pdfDoc.font("Helvetica")
                                .fontSize(12)
                                .text(fileroute.filecontent, {
                                    align: "left"
                                });

                            pdfDoc.end();

                            await new Promise(resolve =>
                                writableStream.on("close", resolve)
                            );

                            const buffer = writableStream.getContents();

                            await bot.sendDocument(chatid, buffer, {
                                ...options,
                                title: fileroute.filename,
                                caption: fileroute.message
                            });
                        }
                        else {
                            fs.writeFileSync(filename, fileroute.filecontent, "utf-8");

                            await bot.sendDocument(chatid, filename, {
                                ...options,
                                caption: fileroute.message
                            });
                        }
                    }
                }

                else {
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

                }
            }
            else if (msg.document.mime_type === "image/png" || msg.document.mime_type === "image/jpeg") {
                const imagetext1 = await analyzeImage(systempromptforimage, filelink, captiontext, msg.document.mime_type);

                const aimessage1 = `image : ${imagetext1}`;

                await bot.sendChatAction(chatid, "typing", options);

                await userquery.findOneAndUpdate({
                    userid: chatid
                }, {
                    $push: {
                        messages: {
                            role: "user",
                            content: `${aimessage1},${captiontext}`
                        }
                    }
                }, {
                    upsert: true
                });

                const historymessage = await userquery.findOne({ userid: chatid });

                const response2 = await groq.chat.completions.create({
                    model: model,
                    messages: [
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
                    ]
                });

                const aimessage2 = response2.choices[0].message.content;

                console.log(aimessage2);

                //File route
                if (aimessage2.startsWith("{") && aimessage2.endsWith("}")) {
                    const fileroute = JSON.parse(aimessage2);
                    if (fileroute.type === "audio") {
                        await bot.sendChatAction(chatid, "upload_voice", options);

                        const response = await groq.audio.speech.create({
                            model: modelaudio,
                            voice: "hannah",
                            input: fileroute.audiocontent,
                            response_format: "wav"
                        });

                        const buffer = Buffer.from(await response.arrayBuffer());

                        await bot.sendAudio(chatid, buffer, {
                            ...options,
                            caption: fileroute.message,
                            title: fileroute.audioname,
                            performer: fileroute.performer
                        })
                    }

                    else if (fileroute.type === "image") {
                        const cooldown = await checkImageCooldown(chatid);
                        if (!cooldown.allowed) {
                            await bot.sendMessage(chatid, `Please wait ${cooldown.remainingMin} more minute(s) before generating another image.`, options);
                            return;
                        }

                        const image = await withPhotoAction(bot, chatid, options, () => generateImage(fileroute.prompt));

                        await userquery.findOneAndUpdate({ userid: chatid }, { lastImageGeneratedAt: new Date() });

                        await bot.sendPhoto(chatid, image, {
                            ...options,
                            caption: fileroute.message
                        });
                    }
                    else {
                        await bot.sendChatAction(chatid, "upload_document", options);

                        await userquery.findOneAndUpdate({
                            userid: chatid
                        }, {
                            $push: {
                                messages: {
                                    role: "assistant",
                                    content: aimessage2
                                }
                            }
                        }, {
                            upsert: true
                        })

                        const tempDir = os.tmpdir();
                        const filename = path.join(tempDir, fileroute.filename);

                        if (fileroute.filetype === "pdf") {
                            const pdfDoc = new PDFDocument({ margin: 50 });
                            const writableStream = new streamBuffers.WritableStreamBuffer();

                            pdfDoc.pipe(writableStream);

                            pdfDoc.font("Helvetica")
                                .fontSize(12)
                                .text(fileroute.filecontent, {
                                    align: "left"
                                });

                            pdfDoc.end();

                            await new Promise(resolve =>
                                writableStream.on("close", resolve)
                            );

                            const buffer = writableStream.getContents();

                            await bot.sendDocument(chatid, buffer, {
                                ...options,
                                title: fileroute.filename,
                                caption: fileroute.message
                            });
                        }
                        else {
                            fs.writeFileSync(filename, fileroute.filecontent, "utf-8");

                            await bot.sendDocument(chatid, filename, {
                                ...options,
                                caption: fileroute.message
                            });
                        }
                    }
                }
                else {
                    await userquery.findOneAndUpdate({
                        userid: chatid
                    }, {
                        $push: {
                            messages: {
                                role: "assistant",
                                content: aimessage2
                            }
                        }
                    }, {
                        upsert: true
                    });

                    await sendBotMessage(bot, chatid, aimessage2, options);
                }
            }
        }
        else if (msg.audio) {
            const fileid = msg.audio.file_id;
            const filelink = await bot.getFileLink(fileid);

            await bot.sendChatAction(chatid, "upload_document", options);

            const result = await groq.audio.transcriptions.create({
                model: transcriptmodel,
                url: filelink
            });

            const audiotext = `Audio : ${result.text}`;


            await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "user",
                        content: audiotext
                    }
                }
            }, {
                upsert: true
            });

            const historymessage = await userquery.findOne({ userid: chatid });
            await bot.sendChatAction(chatid, "typing", options);

            const response = await groq.chat.completions.create({
                model: model,
                messages: [
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
                ]
            });
            const aimessage = response.choices[0].message.content;
            //Fileroute
            if (aimessage.startsWith("{") && aimessage.endsWith("}")) {
                const fileroute = JSON.parse(aimessage);
                if (fileroute.type === "audio") {
                    await bot.sendChatAction(chatid, "upload_voice", options);

                    const response = await groq.audio.speech.create({
                        model: modelaudio,
                        voice: "hannah",

                        input: fileroute.audiocontent,
                        response_format: "wav"
                    });

                    const buffer = Buffer.from(await response.arrayBuffer());

                    await bot.sendAudio(chatid, buffer, {
                        ...options,
                        caption: fileroute.message,
                        title: fileroute.audioname,
                        performer: fileroute.performer
                    })
                }

                else if (fileroute.type === "image") {
                    const cooldown = await checkImageCooldown(chatid);
                    if (!cooldown.allowed) {
                        await bot.sendMessage(chatid, `Please wait ${cooldown.remainingMin} more minute(s) before generating another image.`, options);
                        return;
                    }

                    const image = await withPhotoAction(bot, chatid, options, () => generateImage(fileroute.prompt));

                    await userquery.findOneAndUpdate({ userid: chatid }, { lastImageGeneratedAt: new Date() });

                    await bot.sendPhoto(chatid, image, {
                        ...options,
                        caption: fileroute.message
                    });
                }
                else {
                    await bot.sendChatAction(chatid, "upload_document", options);

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
                    })

                    const tempDir = os.tmpdir();
                    const filename = path.join(tempDir, fileroute.filename);

                    if (fileroute.filetype === "pdf") {
                        const pdfDoc = new PDFDocument({ margin: 50 });
                        const writableStream = new streamBuffers.WritableStreamBuffer();

                        pdfDoc.pipe(writableStream);

                        pdfDoc.font("Helvetica")
                            .fontSize(12)
                            .text(fileroute.filecontent, {
                                align: "left"
                            });

                        pdfDoc.end();

                        await new Promise(resolve =>
                            writableStream.on("close", resolve)
                        );

                        const buffer = writableStream.getContents();

                        await bot.sendDocument(chatid, buffer, {
                            ...options,
                            title: fileroute.filename,
                            caption: fileroute.message
                        });
                    }
                    else {
                        fs.writeFileSync(filename, fileroute.filecontent, "utf-8");

                        await bot.sendDocument(chatid, filename, {
                            ...options,
                            caption: fileroute.message
                        });
                    }
                }
            }
            else {
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
            }
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
