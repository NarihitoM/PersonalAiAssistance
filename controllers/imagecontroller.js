import { GeminiImage } from "../config/aiservice.js";

export const Image = (bot) => async (msg) => {
    const chatid = msg.chat.id;
    console.log(msg);

    try {
        if (msg.photo) {
            const fileid = msg.photo[msg.photo.length - 1].file_id;
            const filelink = bot.getFileLink(fileid);
            const captionmsg = msg.caption ? `Prompt : ${msg.caption}` : "Recreate this image with better styling.";

            const model = GeminiImage.getGenerativeModel({
                model: "gemini-3.1-pro-preview",
                tools: [{ urlContext: {} }]
            })

            const prompt = `Image url : ${filelink} , ${captionmsg}`;
            await bot.sendChatAction(chatid, "upload_photo");

            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
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

            const imageBytes = result.response.candidates[0].content.parts[0].inlineData.data;
            const buffer = Buffer.from(imageBytes, "base64");

            await bot.sendPhoto(chatid, buffer);
        }
        else {
            await bot.sendMessage(chatid, "Sorry text is not allowed here. Go To Chatmode by making the command /exit");
        }
    }
    catch (err) {
        await bot.sendMessage(chatid, "It seems something went wrong");
    }
}