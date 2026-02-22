import { groq } from "../config/aiservice.js";
import mammoth from "mammoth";
import { RAGmodelprompt, systemprompt, systempromptforimage } from "../prompt/systemprompt.js";
import userquery from "../model/userquery.js";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import path from "path";
import os from "os";
import https from "https";
import fs from "fs";
import supabase from "../config/supabaseservice.js";


const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

//Model
const model = "moonshotai/kimi-k2-instruct-0905"
const modelRAG = "groq/compound"
const modelaudio = "canopylabs/orpheus-v1-english"
const imagemodel = "meta-llama/llama-4-maverick-17b-128e-instruct"
const transcriptmodel = "whisper-large-v3-turbo"

ffmpeg.setFfmpegPath(ffmpegPath);

//Styling
function escapeMarkdownSafe(text) {
    const parts = text.split(/```/);

    return parts
        .map((part, i) => {
            if (i % 2 === 0) {
                return part.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
            } else {
                return "```" + part + "```";
            }
        })
        .join("");
}

function detectFormat(text) {
    if (/```[\s\S]*```/.test(text)) return "MarkdownV2";
    if (/<\/?[a-z]+>/.test(text)) return "HTML";
    return "plain";
}

async function sendBotMessage(bot, chatid, text) {
    const format = detectFormat(text);

    if (format === "plain") {
        await bot.sendMessage(chatid, text);
    } else if (format === "MarkdownV2") {
        await bot.sendMessage(chatid, escapeMarkdownSafe(text), { parse_mode: "MarkdownV2" });
    } else if (format === "HTML") {
        await bot.sendMessage(chatid, text, { parse_mode: "HTML" });
    }
}

//SUPER MESSAGE
export const message = (bot) => async (msg) => {
    const chatid = msg.chat.id;
    console.log(msg);

    if (msg.text.startsWith("/")) {
        return;
    }

    try {
        //Message route
        if (msg.text) {

            const message = `text : ${msg.text}`;


            bot.sendChatAction(chatid, "typing");

            const RAGmodel = await groq.chat.completions.create({
                model: modelRAG,
                messages: [
                    {
                        role: "system",
                        content: RAGmodelprompt
                    },
                    {
                        role: "user",
                        content: message
                    }
                ]
            })

            const Result = RAGmodel.choices[0].message.content;
            const RAGresult = `Tool Calling : ${Result}`;

            await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "user",
                        content: `${RAGresult},${message}`
                    }
                }
            }, {
                upsert: true
            });

            const historymessage = await userquery.findOne({ userid: chatid });
            bot.sendChatAction(chatid, "typing");

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
                    bot.sendChatAction(chatid, "upload_document")

                    const response = await groq.audio.speech.create({
                        model: modelaudio,
                        voice: "hannah",

                        input: fileroute.audiocontent,
                        response_format: "wav"
                    });

                    const buffer = Buffer.from(await response.arrayBuffer());

                    bot.sendAudio(chatid, buffer, {
                        caption: fileroute.message,
                        title: fileroute.audioname,
                        performer: fileroute.performer
                    })
                }
                else {
                    bot.sendChatAction(chatid, "upload_document");

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

                    fs.writeFileSync(filename, fileroute.filecontent);

                    await bot.sendDocument(chatid, filename, {
                        caption: fileroute.message
                    });
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

                await sendBotMessage(bot, chatid, aimessage);
            }
        }
        //Photo route
        else if (msg.photo) {
            const fileid = msg.photo[msg.photo.length - 1].file_id;
            const filelink = await bot.getFileLink(fileid);
            const captionmsg = msg.caption ? `Caption : ${msg.caption}` : "";

            bot.sendChatAction(chatid, "upload_photo")

            const response1 = await groq.chat.completions.create({
                model: imagemodel,
                messages: [
                    {
                        role: "system",
                        content: systempromptforimage
                    },
                    {
                        role: "user",
                        "content": [
                            {
                                type: "text",
                                text: captionmsg
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: filelink
                                }
                            }
                        ]
                    }
                ]
            });

            const aimessage1 = `image : ${response1.choices[0].message.content}`;

            bot.sendChatAction(chatid, "typing");


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
                    bot.sendChatAction(chatid, "upload_document");

                    const response = await groq.audio.speech.create({
                        model: modelaudio,
                        voice: "hannah",
                        input: fileroute.audiocontent,
                        response_format: "wav"
                    });

                    const buffer = Buffer.from(await response.arrayBuffer());

                    bot.sendAudio(chatid, buffer, {
                        caption: fileroute.message,
                        title: fileroute.audioname,
                        performer: fileroute.performer
                    })
                }
                else {
                    bot.sendChatAction(chatid, "upload_document");

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

                    fs.writeFileSync(filename, fileroute.filecontent);

                    await bot.sendDocument(chatid, filename, {
                        caption: fileroute.message
                    });
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

                await sendBotMessage(bot, chatid, aimessage2);
            }
        }
        //Voiceroute
        else if (msg.voice) {
            const fileid = msg.voice.file_id;
            const filelink = await bot.getFileLink(fileid);

            bot.sendChatAction(chatid, 'upload_document')

            const transcription = await groq.audio.transcriptions.create({
                model: transcriptmodel,
                prompt: "Please reply only in english. with correct grammar and vocabulary.",
                language: "en",
                url: filelink
            })

            const transcripttext = `Voice : ${transcription.text}`;

            const RAGmodel = await groq.chat.completions.create({
                model: modelRAG,
                messages: [
                    {
                        role: "system",
                        content: RAGmodelprompt
                    },
                    {
                        role: "user",
                        content: transcripttext
                    }
                ]
            })

            const Result = RAGmodel.choices[0].message.content;
            const RAGresult = `Tool Calling : ${Result}`;

            bot.sendChatAction(chatid, "typing");

            await userquery.findOneAndUpdate({
                userid: chatid
            }, {
                $push: {
                    messages: {
                        role: "user",
                        content: `${transcripttext}, ${RAGresult}`
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
                    bot.sendChatAction(chatid, "upload_document");

                    const response = await groq.audio.speech.create({
                        model: modelaudio,
                        voice: "hannah",

                        input: fileroute.audiocontent,
                        response_format: "wav"
                    });

                    const buffer = Buffer.from(await response.arrayBuffer());

                    bot.sendAudio(chatid, buffer, {
                        caption: fileroute.message,
                        title: fileroute.audioname,
                        performer: fileroute.performer
                    })
                }
                else {
                    bot.sendChatAction(chatid, "upload_document");

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

                    fs.writeFileSync(filename, fileroute.filecontent);

                    await bot.sendDocument(chatid, filename, {
                        caption: fileroute.message
                    });
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
                await sendBotMessage(bot, chatid, aimessage);
            }
        }
        //Video Transcript
        else if (msg.video) {
            console.log(msg.caption);

            const fileid = msg.video.file_id;
            const filelink = await bot.getFileLink(fileid);

            bot.sendChatAction(chatid, "upload_video");
            const tmpVideoPath = path.join(os.tmpdir(), `${Date.now()}.mp4`);
            const tmpAudioPath = path.join(os.tmpdir(), `${Date.now()}.mp3`);
            const audiofilename = `Audio-${Date.now()}.mp3`

            bot.sendChatAction(chatid, "upload_video");

            await new Promise((resolve, reject) => {
                const file = fs.createWriteStream(tmpVideoPath);
                https.get(filelink, (res) => {
                    res.pipe(file);
                    file.on("finish", resolve);
                    file.on("error", reject);
                }).on("error", reject);
            });

            bot.sendChatAction(chatid, "upload_video");

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

            const audiobuffer = fs.createReadStream(tmpAudioPath);

            bot.sendChatAction(chatid, "upload_video");

            const { error } = await supabase.storage.from("audio").upload(audiofilename, audiobuffer, {
                upsert: true
            })
            if (error) {
                console.log(error);
            }

            const { data } = await supabase.storage.from("audio").getPublicUrl(audiofilename);
            const finalaudiourl = data.publicUrl;



            bot.sendChatAction(chatid, "upload_video");

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
            bot.sendChatAction(chatid, "typing");

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
                    bot.sendChatAction(chatid, "upload_document");

                    const response = await groq.audio.speech.create({
                        model: modelaudio,
                        voice: "hannah",

                        input: fileroute.audiocontent,
                        response_format: "wav"
                    });

                    const buffer = Buffer.from(await response.arrayBuffer());

                    bot.sendAudio(chatid, buffer, {
                        caption: fileroute.message,
                        title: fileroute.audioname,
                        performer: fileroute.performer
                    })
                }
                else {
                    bot.sendChatAction(chatid, "upload_document");

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

                    fs.writeFileSync(filename, fileroute.filecontent);

                    await bot.sendDocument(chatid, filename, {
                        caption: fileroute.message
                    });
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

                await sendBotMessage(bot, chatid, aimessage);
            }
        }
        //File route
        else if (msg.document) {
            const fileid = msg.document.file_id;
            const filelink = await bot.getFileLink(fileid);
            const filecontent = await fetch(filelink);
            const filebuffer = await filecontent.arrayBuffer();
            bot.sendChatAction(chatid, "upload_document");
            const captiontext = msg.caption ? `text : ${msg.caption}` : "text : Please analyse this file";


            const RAGmodel = await groq.chat.completions.create({
                model: modelRAG,
                messages: [
                    {
                        role: "system",
                        content: RAGmodelprompt
                    },
                    {
                        role: "user",
                        content: captiontext
                    }
                ]
            })

            const Result = RAGmodel.choices[0].message.content;
            const RAGresult = `Tool Calling : ${Result}`;

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
                            content: `${textfiledata},${captiontext},${RAGresult}`
                        }
                    }
                }, {
                    upsert: true
                });

                const historymessage = await userquery.findOne({ userid: chatid })

                bot.sendChatAction(chatid, "typing");
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
                        bot.sendChatAction(chatid, "upload_document");

                        const response = await groq.audio.speech.create({
                            model: modelaudio,
                            voice: "hannah",

                            input: fileroute.audiocontent,
                            response_format: "wav"
                        });

                        const buffer = Buffer.from(await response.arrayBuffer());

                        bot.sendAudio(chatid, buffer, {
                            caption: fileroute.message,
                            title: fileroute.audioname,
                            performer: fileroute.performer
                        })
                    }
                    else {
                        bot.sendChatAction(chatid, "upload_document");

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

                        fs.writeFileSync(filename, fileroute.filecontent);

                        await bot.sendDocument(chatid, filename, {
                            caption: fileroute.message
                        });
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

                    await sendBotMessage(bot, chatid, aimessage);
                }
            }
            //PDF file route
            else if (msg.document.mime_type === "application/pdf") {

                const resultpdf = await axios.get(filelink, { responseType: "arraybuffer" });
                const pdfData = await pdf(resultpdf.data); 

                const result = await pdfData.text;

                const pdffiledata = `PDF : ${result.text}`;

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

                bot.sendChatAction(chatid, "typing");
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
                        bot.sendChatAction(chatid, "upload_document");

                        const response = await groq.audio.speech.create({
                            model: modelaudio,
                            voice: "hannah",

                            input: fileroute.audiocontent,
                            response_format: "wav"
                        });

                        const buffer = Buffer.from(await response.arrayBuffer());

                        bot.sendAudio(chatid, buffer, {
                            caption: fileroute.message,
                            title: fileroute.audioname,
                            performer: fileroute.performer
                        })
                    }
                    else {
                        bot.sendChatAction(chatid, "upload_document");

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

                        fs.writeFileSync(filename, fileroute.filecontent);

                        await bot.sendDocument(chatid, filename, {
                            caption: fileroute.message
                        });
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

                    await sendBotMessage(bot, chatid, aimessage);
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

                bot.sendChatAction(chatid, "typing");
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
                        bot.sendChatAction(chatid, "upload_document");

                        const response = await groq.audio.speech.create({
                            model: modelaudio,
                            voice: "hannah",

                            input: fileroute.audiocontent,
                            response_format: "wav"
                        });

                        const buffer = Buffer.from(await response.arrayBuffer());

                        bot.sendAudio(chatid, buffer, {
                            caption: fileroute.message,
                            title: fileroute.audioname,
                            performer: fileroute.performer
                        })
                    }
                    else {
                        bot.sendChatAction(chatid, "upload_document");

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

                        fs.writeFileSync(filename, fileroute.filecontent);

                        await bot.sendDocument(chatid, filename, {
                            caption: fileroute.message
                        });
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

                    await sendBotMessage(bot, chatid, aimessage);
                }
            }
            else if (msg.document.mime_type === "image/png") {
                const response1 = await groq.chat.completions.create({
                    model: imagemodel,
                    messages: [
                        {
                            role: "system",
                            content: systempromptforimage
                        },
                        {
                            role: "user",
                            "content": [
                                {
                                    type: "text",
                                    text: captiontext
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: filelink
                                    }
                                }
                            ]
                        }
                    ]
                });

                const aimessage1 = `image : ${response1.choices[0].message.content}`;

                bot.sendChatAction(chatid, "typing");

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
                        bot.sendChatAction(chatid, "upload_document");

                        const response = await groq.audio.speech.create({
                            model: modelaudio,
                            voice: "hannah",
                            input: fileroute.audiocontent,
                            response_format: "wav"
                        });

                        const buffer = Buffer.from(await response.arrayBuffer());

                        bot.sendAudio(chatid, buffer, {
                            caption: fileroute.message,
                            title: fileroute.audioname,
                            performer: fileroute.performer
                        })
                    }
                    else {
                        bot.sendChatAction(chatid, "upload_document");

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

                        fs.writeFileSync(filename, fileroute.filecontent);

                        await bot.sendDocument(chatid, filename, {
                            caption: fileroute.message
                        });
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

                    await sendBotMessage(bot, chatid, aimessage2);
                }
            }
        }
    } catch (err) {
        console.log(err);
        await sendBotMessage(bot, chatid, "Something went wrong. please try again.")
    }
}