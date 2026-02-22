import { configDotenv } from "dotenv";
import { createbot } from "../config/botservice.js";

configDotenv();

const token = process.env.TOKEN;

let botPromise;

export default async function handler(request, response) {
    try {
        if (request.method !== "POST") {
            return response.status(200).send("Telegram bot is running ✅");
        }

        if (!botPromise) {
            botPromise = createbot(token);
        }

        const bot = await botPromise;

        await bot.processUpdate(request.body);

        return response.status(200).send("OK");
    } catch (error) {
        console.error("Webhook error:", error);
        return response.status(500).send("Internal Server Error");
    }
}