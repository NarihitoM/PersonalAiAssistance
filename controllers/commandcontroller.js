export const command = (bot) => (msg) => {
    const chatid = msg.chat.id;
    const message = msg.text;
    console.log(message);

    if(message === "/start"){
        bot.sendMessage(chatid, "You can now get started! This is your personal ai assistance that can help you with anything. Develop By Narihito")
    }
    
}