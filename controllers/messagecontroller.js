import { groq } from "../config/aiservice.js";
import { systemprompt, systempromptforimage } from "../prompt/systemprompt.js";
import userquery from "../model/userquery.js";

const model = "moonshotai/kimi-k2-instruct-0905"
const imagemodel = "meta-llama/llama-4-maverick-17b-128e-instruct"
const transcriptmodel = "whisper-large-v3-turbo"

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



export const message = (bot) => async (msg) => {
    const chatid = msg.chat.id;
    console.log(msg);

    //Message route
    if (msg.text) {
        const message = `text : ${msg.text}`;

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
    //Voiceroute
    else if (msg.voice) {
        const fileid = msg.voice.file_id;
        const filelink = await bot.getFileLink(fileid);

        bot.sendChatAction(chatid, 'upload_audio')

        const transcription = await groq.audio.transcriptions.create({
            model: transcriptmodel,
            prompt: "Please reply only in english. with correct grammar and vocabulary.",
            language: "en",
            url: filelink
        })

        const transcripttext = `Voice : ${transcription.text}`;

        bot.sendChatAction(chatid, "typing");
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