import { GeminiImage } from "../config/aiservice.js";

export const Image = (bot) => async (msg) => {
    const chatid = msg.chat.id;

    if (msg.photo) {
        const fileid = msg.photo[msg.photo.length - 1].file_id;
        const filelink = bot.getFileLink(fileid);
        const captionmsg = msg.caption ? `Prompt : ${msg.caption}` : "Recreate this image with better styling.";

        const model = GeminiImage.getGenerativeModel({
            model: "gemini-3.1-pro-preview",
            tools: [{ urlContext: {} }]
        })

        const prompt = `Image url : ${filelink} , ${captionmsg}`;

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            safetySettings : [
                {
                    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
            ],
            generationConfig: {
                responseModalities: ["IMAGE", "TEXT"]
            }
        });

        const imageBytes = result.response.candidates[0].content.parts[0].inlineData.data;
        const buffer = Buffer.from(imageBytes, "base64");

        await bot.sendPhoto(chatid, buffer);
    }
    else {
        await bot.sendMessage(chatid, "Sorry text is not allowed here. Go To Chatmode by making the command /exit");
    }
}