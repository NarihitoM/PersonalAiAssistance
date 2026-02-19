import TelegramBot from "node-telegram-bot-api";

export const createbot = (token) => {
    return new TelegramBot(token, { polling : true});
}