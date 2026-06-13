import TelegramBot from "node-telegram-bot-api";
import { mongoconnect } from "../config/mongoservice.js";

let botInstance = null;

export const createbot = async (token) => {
    if (botInstance) return botInstance;

    await mongoconnect();

    const bot = new TelegramBot(token, { polling: false });

    botInstance = bot;
    return botInstance;
};