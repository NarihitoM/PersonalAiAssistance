import { Gemini } from "../config/aiservice.js";

const model = "veo-3.1-generate-preview";

export const Video = (bot) => async (msg, businessConnectionId) => {
    const chatid = msg.chat.id;
    const options = {};
    if (businessConnectionId) {
        options.business_connection_id = businessConnectionId;
    }
    console.log(msg);
    try {
        if (msg.text) {
            await bot.sendChatAction(chatid, "typing", options);
            const message = msg.text;
            let result = await Gemini.models.generateVideos({
                model: model,
                source: {
                    prompt: `${message}. Generate Only 1 seconds video.`
                },
                config: {
                    numberOfVideos: 1,
                    resolution: "720p"
                }
            })

            while (!result.done) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                result = await Gemini.operations.getVideosOperation({
                    operation: result
                })
            }

            await bot.sendChatAction(chatid, "upload_video", options);
            const Videodata = result.response.generatedVideos[0].video;
            const buffer = Videodata.videoBytes;

            await bot.sendVideo(chatid, buffer, { ...options,
                caption: "Here is the video you requested!"
            }, {
                filename: 'video.mp4',
                contentType: 'video/mp4'
            });

            await Gemini.files.delete({
                name: Videodata
            })
        }
        else {
            await bot.sendMessage(chatid, "Sorry this function is not supported yet.", options);
        }
    }
    catch (err) {
        console.log(err);
        await bot.sendMessage(chatid, "It seems something went wrong", options);
    }
}