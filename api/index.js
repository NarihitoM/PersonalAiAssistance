import { configDotenv } from "dotenv";
import { createbot } from "../config/botservice.js";
import { message } from "../controllers/messagecontroller.js";
import { command } from "../controllers/commandcontroller.js";

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
        } else {
            await message(bot)(msg);
        }
    }

    return res.status(200).send("OK");
}