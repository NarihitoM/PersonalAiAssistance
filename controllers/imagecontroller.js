import { Gemini } from "../config/aiservice.js";

const model = "gemini-3-pro-image-preview"

export const Image = (bot) => async (msg) => {
    const chatid = msg.chat.id;
    console.log(msg);

    try {
        if (msg.text) {
            const message = msg.text;

            const result = await Gemini.models.generateContent({
                model: model,
                contents : message,
                safetySettings: [
                    {
                        category: "HARM_CATEGORY_HATE_SPEECH",
                        threshold: "BLOCK_NONE"
                    },
                    {
                        category: "HARM_CATEGORY_HARASSMENT",
                        threshold: "BLOCK_NONE"
                    },
                    {
                        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                        threshold: "BLOCK_NONE"
                    },
                    {
                        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        threshold: "BLOCK_NONE"
                    }
                ],
                generationConfig: {
                    responseModalities: ["IMAGE", "TEXT"]
                }
            });

            await bot.sendChatAction(chatid, "typing");

            if (result.candidates[0].finishReason === "SAFETY") {
                return bot.sendMessage(chatid, "This request was blocked by Google's core safety filters, bro.");
            }
            const imageBytes = result.candidates[0].content.parts[0].inlineData.data;

            const buffer = Buffer.from(imageBytes, "base64");

            await bot.sendPhoto(chatid, buffer, {
                caption: "Here is the image you requested!"
            });
        }
        else if (msg.photo) {
            const fileid = msg.photo[msg.photo.length - 1].file_id;
            const filelink = await bot.getFileLink(fileid);
            const captionmsg = msg.caption ? `Prompt : ${msg.caption}` : "Recreate this image with better styling.";

            const imageurl = await fetch(filelink);
            const imagebuffer = await imageurl.arrayBuffer();

            const base64Image = Buffer.from(imagebuffer).toString("base64");


            await bot.sendChatAction(chatid, "upload_photo");

            const result = await Gemini.models.generateContent({
                model: model,
                contents: [
                    {
                        text: captionmsg
                    },
                    {
                        inlineData: {
                            data: base64Image,
                            mimeType: "image/jpeg"
                        }
                    }
                ],

                safetySettings: [
                    {
                        category: "HARM_CATEGORY_HATE_SPEECH",
                        threshold: "BLOCK_NONE"
                    },
                    {
                        category: "HARM_CATEGORY_HARASSMENT",
                        threshold: "BLOCK_NONE"
                    },
                    {
                        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                        threshold: "BLOCK_NONE"
                    },
                    {
                        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        threshold: "BLOCK_NONE"
                    }
                ],
                generationConfig: {
                    responseModalities: ["IMAGE", "TEXT"]
                }
            });

            await bot.sendChatAction(chatid, "typing");

            if (result.candidates[0].finishReason === "SAFETY") {
                return bot.sendMessage(chatid, "This request was blocked by Google's core safety filters, bro.");
            }
            const imageBytes = result.candidates[0].content.parts[0].inlineData.data;

            const buffer = Buffer.from(imageBytes, "base64");

            await bot.sendPhoto(chatid, buffer, {
                caption: "Here is the image you requested!"
            });
        }
        else {
            await bot.sendMessage(chatid, "Sorry this function is not supported yet.");
        }
    }
    catch (err) {
        console.log(err);
        await bot.sendMessage(chatid, "It seems something went wrong");
    }
}