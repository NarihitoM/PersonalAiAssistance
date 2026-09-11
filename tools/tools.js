export const tools = [
    {
        type: "function",
        function: {
            name: "create_file",
            description: "Create a text, html, or pdf file for the user and send it as a document",
            parameters: {
                type: "object",
                properties: {
                    message: { type: "string", description: "Message to send along with the file" },
                    filename: { type: "string" },
                    filetype: { type: "string", enum: ["text", "html", "pdf"] },
                    filecontent: { type: "string", description: "Full file content. If a video transcript, include timestamps and an overall summary." }
                },
                required: ["message", "filename", "filetype", "filecontent"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "create_voice",
            description: "Generate a spoken voice message for the user",
            parameters: {
                type: "object",
                properties: {
                    message: { type: "string", description: "Message to send along with the audio" },
                    audioname: { type: "string" },
                    audiocontent: { type: "string", description: "Speech content including tone expressions like [cheerful], [whisper], [excited], etc." }
                },
                required: ["message", "audioname", "audiocontent"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "generate_image",
            description: "Generate an image for the user",
            parameters: {
                type: "object",
                properties: {
                    message: { type: "string", description: "Message to send along with the image" },
                    prompt: { type: "string", description: "Detailed image generation prompt" }
                },
                required: ["message", "prompt"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "web_search",
            description: "Search the web for current or up-to-date information",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "The search query" }
                },
                required: ["query"]
            }
        }
    }
];
