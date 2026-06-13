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


        let session;
        try {
            session = await usersession.findOne({ userid: chatid });
            if (!session) {
                session = await usersession.findOneAndUpdate(
                    { userid: chatid },
                    { $set: { session: "chat" } },
                    { upsert: true, new: true }
                );
            }
        } catch (err) {
            console.error(err);
            return res.status(200).send("OK");
        }

        if (session.session === "chat") {
            await message(bot)(msg, businessConnectionId);
        }
    }

    return res.status(200).send("OK");
}