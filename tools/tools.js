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
            description: "Generate an image from a text prompt via UnoRouter flux-2-klein-4b:free. Use when user asks to create, draw, or generate an image. 1 hour cooldown per user.",
            parameters: {
                type: "object",
                properties: {
                    message: { type: "string", description: "Caption/message to send along with the image" },
                    prompt: { type: "string", description: "Detailed image generation prompt, be specific about style, composition, and details" }
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
    },
    {
        type: "function",
        function: {
            name: "web_scrape",
            description: "Scrape and extract content from a specific URL. Use when user provides a URL or asks to fetch/read content from a webpage",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "The URL to scrape and extract content from" },
                    onlyMainContent: { type: "boolean", description: "Extract only main content, default true" },
                    formats: { type: "array", items: { type: "string", enum: ["markdown", "html", "rawHtml", "links", "summary"] }, description: "Content formats to return, default markdown" }
                },
                required: ["url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "web_crawl",
            description: "Crawl a website starting from a URL to discover and scrape multiple pages at once",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "Root URL to start crawling from" },
                    limit: { type: "integer", description: "Max number of pages to crawl (1-20, default 10)" },
                    maxDiscoveryDepth: { type: "integer", description: "Max crawl depth (1-3, default 2)" }
                },
                required: ["url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "web_map",
            description: "Discover all URLs on a website (sitemap-aware) without scraping content",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "Root URL to map/discover links from" },
                    limit: { type: "integer", description: "Max number of URLs to discover (default 20)" }
                },
                required: ["url"]
            }
        }
    }
];
