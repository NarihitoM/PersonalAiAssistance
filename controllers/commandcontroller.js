
//Command

export const command = (bot) => async (msg) => {
    const chatid = msg.chat.id;
    const message = msg.text;
    console.log(message);

    if (message === "/start") {
        await bot.sendMessage(chatid, "You can now get started! This is your personal ai assistance that can help you with anything. Develop By Narihito")
    }
    else if (message === "/feature") {
        await bot.sentMessage(chatid, "This Assistance can chat,read file,analyse image,transcript video,record voice,create file,hear your voice,etc")
    }
}