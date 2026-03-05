import { configDotenv } from "dotenv";
import { createbot } from "../config/botservice.js";
import { message } from "../controllers/messagecontroller.js";
import { command } from "../controllers/commandcontroller.js";
import usersession from "../model/usersession.js";
import { Image } from "../controllers/imagecontroller.js";

configDotenv();

const token = process.env.TOKEN;
let botInstance = null;

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(200).send("Bot running ✅");

    if (!botInstance) botInstance = await createbot(token);
    const bot = botInstance;

    if (req.body.message) {
        const msg = req.body.message;
        const chatid = msg.chat.id;

        if (msg.text === "/start") {
            await usersession.findOneAndUpdate({
                userid: chatid
            }, {
                $set: {
                    session: "chat"
                }
            }, {
                upsert: true
            });
            await bot.sendMessage(chatid, "You can now get started! This is your personal ai assistance that can help you with anything. Develop By Narihito")
        }
        else if (msg.text === "/feature") {
            await bot.sendMessage(chatid, "This Assistance can chat,read file,analyse image,transcript video,record voice,create file,hear your voice,etc")
        }

        try {
            const session = await usersession.findOne({ userid: msg.chat.id });
            if (!session) {
                await bot.sendMessage(chatid, "You have no session. Press /start to get started.")
                return;
            }
        }
        catch (err) {
            await bot.sendMessage(chatid, "You have no session. Press /start to get started.")
        }
        //Command route
        if (msg.text?.startsWith("/")) {
            await command(bot)(msg);
        }
        else if (session?.session === "chat" && !msg.text?.startsWith("/")) {
            await message(bot)(msg);
        }
        else if (session?.session === "imagetool" && !msg.text?.startsWith("/")) {
            await Image(bot)(msg);
        }
    }

    return res.status(200).send("OK");
}