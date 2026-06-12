import { configDotenv } from "dotenv";
import { createbot } from "../config/botservice.js";
import { message } from "../controllers/messagecontroller.js";
import { command } from "../controllers/commandcontroller.js";
import { Video } from "../controllers/videocontroller.js";
import { Image } from "../controllers/imagecontroller.js";
import usersession from "../model/usersession.js";

configDotenv();

const token = process.env.TOKEN;
let botInstance = null;

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(200).send("Bot running ✅");

    if (!botInstance) botInstance = await createbot(token);
    const bot = botInstance;

    const msg = req.body.message || req.body.business_message;

    if (msg) {
        const chatid = msg.chat.id;
        const businessConnectionId = req.body.business_message?.business_connection_id;

        const sendReply = async (targetId, text) => {
            const options = {};
            if (businessConnectionId) {
                options.business_connection_id = businessConnectionId;
            }
            return await bot.sendMessage(targetId, text, options);
        };

        if (msg.text === "/start") {
            await usersession.findOneAndUpdate(
                { userid: chatid },
                { $set: { session: "chat" } },
                { upsert: true, new: true }
            );
            await sendReply(chatid, "You can now get started! Develop By Narihito");
            return res.status(200).send("OK");
        }

        if (msg.text === "/feature") {
            await sendReply(chatid, "This Assistance can chat, read files, analyse image, create image, analyse file, create file, create voice, listen to voice , etc..");
            return res.status(200).send("OK");
        }

        let session;
        try {
            session = await usersession.findOne({ userid: chatid });
            if (!session) {
                await sendReply(chatid, "You have no session. Press /start to get started.");
                return res.status(200).send("OK");
            }
        } catch (err) {
            console.error(err);
            return res.status(200).send("OK");
        }

        if (msg.text?.startsWith("/")) {
            await command(bot)(msg);
        }
        else if (session.session === "chat") {
            await message(bot)(msg);
        }
        else if (session.session === "imagetool") {
            await Image(bot)(msg);
        }
        else if (session.session === "video") {
            await Video(bot)(msg);
        }
    }

    return res.status(200).send("OK");
}