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

        if (msg.text?.startsWith("/")) {
            await command(bot)(msg);
        }

        const session = await usersession.findOne({ userid: msg.chat.id });

        if (session?.session === "chat" && !msg.text?.startsWith("/")) {
            await message(bot)(msg);
        }

        if (session?.session === "imagetool" && !msg.text?.startsWith("/")) {
            await Image(bot)(msg);
        }
    }

    return res.status(200).send("OK");
}