import { groq } from "../config/aiservice.js";
import { systemprompt, systempromptforimage } from "../prompt/systemprompt.js";

const model = "moonshotai/kimi-k2-instruct-0905"
const imagemodel = "meta-llama/llama-4-maverick-17b-128e-instruct"


export const message = (bot) => async (msg) => {
    const chatid = msg.chat.id;
    console.log(msg.text);
    await bot.sendMessage(chatid,"Hello");
    /*Message route
    if (msg.text) {
        const message = `text : ${msg.text}`;
        bot.sendChatAction(chatid, "typing");
        const response = await groq.chat.completions.create({
            model: model,
            messages: [
                {
                    role: "system",
                    content: systemprompt
                },
                {
                    role: "user",
                    content: message
                }
            ]
        });
        const aimessage = response.choices[0].message.content;
        bot.sendMessage(chatid, aimessage);
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

        const response2 = await groq.chat.completions.create({
            model: model,
            messages: [
                {
                    role: "system",
                    content: systemprompt
                },
                {
                    role: "user",
                    content: `${aimessage1},${captionmsg}`
                }
            ]
        });

        const aimessage2 = response2.choices[0].message.content;

        bot.sendMessage(chatid,aimessage2);
    }*/

}