import { config } from "dotenv";
config();
import TelegramBot from "node-telegram-bot-api";
import { mongoconnect } from "./mongo.js";

export const BOT_TOKEN = process.env.TOKEN;
export const CHAT_ID = process.env.CHATID;

let botInstance = null;

export const createbot = async (token) => {
    if (botInstance) return botInstance;
    await mongoconnect();
    const bot = new TelegramBot(token, { polling: false });
    botInstance = bot;
    return botInstance;
};
