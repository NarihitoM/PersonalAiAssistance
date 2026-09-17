import { configDotenv } from "dotenv";
import { createbot } from "../src/config/botconfig.js";
import { message } from "../src/controllers/messagecontroller.js";
import usersession from "../src/models/usersession.js";
import processedMessage from "../src/models/processedMessage.js";

configDotenv();

const token = process.env.TOKEN;
let botInstance = null;

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(200).send("Bot running ✅");

    if (!botInstance) botInstance = await createbot(token);
    const bot = botInstance;

    const msg = req.body.message || req.body.business_message;

    if (msg) {
        if (msg.from.id === Number(process.env.CHATID) && msg.business_connection_id) {
            return res.status(200).send("Ok")
        }

        const chatid = msg.chat.id;
        const businessConnectionId = req.body.business_message?.business_connection_id;
        const dedupKey = `${chatid}:${msg.message_id}`;
        try {
            await processedMessage.create({ key: dedupKey, chatId: String(chatid), messageId: msg.message_id });
        } catch (err) {
            if (err.code === 11000) {
                console.log(`Duplicate message ${dedupKey} skipped`);
                return res.status(200).send("OK");
            }
            console.error("dedup check failed:", err.message);
        }

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
            try {
                await message(bot)(msg, businessConnectionId);
            } catch (err) {
                console.error("message handler failed:", err);
                try { await processedMessage.deleteOne({ key: dedupKey }); } catch {}
                throw err;
            }
        }
    }

    return res.status(200).send("OK");
}