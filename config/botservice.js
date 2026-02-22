/* import TelegramBot from "node-telegram-bot-api";

export const createbot = (token) => {
    return new TelegramBot(token, { polling : false});
} */

import TelegramBot from "node-telegram-bot-api";
import { message } from "../controllers/messagecontroller.js";
import { command } from "../controllers/commandcontroller.js";
import { mongoconnect } from "./mongoservice.js";

let botInstance = null;

export const createbot = async (token) => {
    if (botInstance) return botInstance;

    await mongoconnect();

    const bot = new TelegramBot(token, {
        polling: false
    });

    bot.on("message", message(bot));
    bot.onText(/\//, command(bot));

    botInstance = bot;
    return botInstance;
};