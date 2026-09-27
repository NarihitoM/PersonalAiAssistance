import { configDotenv } from "dotenv";
import { createbot } from "../src/config/botconfig.js";
import { message } from "../src/controllers/messagecontroller.js";
import usersession from "../src/models/usersession.js";
import processedMessage from "../src/models/processedMessage.js";
import { markOwnerActive, isOwnerActive } from "../src/services/rediscache.js";

configDotenv();

const token = process.env.TOKEN;
let botInstance = null;

function toEditedMessage(body) {
    const edited = body.edited_message || body.edited_business_message;
    if (!edited?.text) return null;
    return {
        ...edited,
        text: `[Activity: the user edited one of their earlier messages. The new version is:] ${edited.text}`,
        dedupSuffix: `:edit:${edited.edit_date}`
    };
}

function toReactionMessage(reaction) {
    if (!reaction?.user || reaction.user.is_bot || !reaction.new_reaction?.length) return null;
    const emojis = reaction.new_reaction
        .map(r => r.type === "emoji" ? r.emoji : r.type === "paid" ? "a paid star" : "a custom emoji")
        .join(" ");
    return {
        message_id: reaction.message_id,
        chat: reaction.chat,
        from: reaction.user,
        date: reaction.date,
        text: `[Activity: the user reacted ${emojis} to one of your earlier messages. Reply with one short, natural sentence that fits the reaction and the conversation. Only if you already responded to a reaction right before this, reply with exactly NO_REPLY instead.]`,
        dedupSuffix: `:reaction:${reaction.date}`
    };
}

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(200).send("Bot running ✅");

    if (!botInstance) botInstance = await createbot(token);
    const bot = botInstance;

    const msg = req.body.message || req.body.business_message || toEditedMessage(req.body) || toReactionMessage(req.body.message_reaction);

    if (msg) {
        const chatid = msg.chat.id;

        if (msg.from.id === Number(process.env.CHATID) && msg.business_connection_id) {
            await markOwnerActive(chatid);
            return res.status(200).send("Ok")
        }

        const businessConnectionId = msg.business_connection_id;
        if (businessConnectionId && await isOwnerActive(chatid)) {
            console.log(`Owner active in chat ${chatid}, skipping AI auto-reply`);
            return res.status(200).send("OK");
        }
        const dedupKey = `${chatid}:${msg.message_id}${msg.dedupSuffix || ""}`;
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

        const command = msg.text?.split(/[\s@]/)[0];
        if (command === "/start") {
            await sendReply(chatid, "Hello! This is Narihito's Personal AI Assistant. You can start messaging.");
            return res.status(200).send("OK");
        }
        if (command === "/owner") {
            await sendReply(chatid, "Created by Narihito (Hein Htet Aung)");
            return res.status(200).send("OK");
        }


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