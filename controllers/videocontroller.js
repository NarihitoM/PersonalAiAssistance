import { Gemini } from "../config/aiservice.js";

const model = "veo-3.1-generate-preview";

export const Video = (bot) => async (msg) => {
    const chatid = msg.chat.id;
    console.log(msg);
    try {
        if (msg.text) {
            await bot.sendChatAction(chatid, "typing");
            const message = msg.text;
            const result = await Gemini.models.generateVideos({
                model : model,
                source : {
                    prompt : `${message}. Generate Only 4 seconds video.`
                },
                config : {
                    numberOfVideos : 1,
                    resolution : "720p"
                }
            })
            
            await bot.sendChatAction(chatid, "upload_video");
            const Videodata = result.response.generatedVideos[0].video;
            const buffer = Videodata.videoBytes;
            
            await bot.sendVideo(chatid, buffer, {
                caption : "Here is the video you requested!"
            })

            await Gemini.files.delete({
                name : Videodata
            })
        }
        else {
            await bot.sendMessage(chatid, "Sorry this function is not supported yet.");
        }
    }
    catch (err) {
        console.log(err);
        await bot.sendMessage(chatid, "It seems something went wrong");
    }

}