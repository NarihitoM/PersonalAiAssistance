export const tools = [
    {
        type: "function",
        function: {
            name: "create_file",
            description: "Create a file for the user and send it as a document. Supports text-based formats and pdf",
            parameters: {
                type: "object",
                properties: {
                    message: { type: "string", description: "Message to send along with the file" },
                    filename: { type: "string", description: "Filename with extension, e.g. report.pdf, data.csv, script.js" },
                    filetype: { type: "string", enum: ["text", "html", "pdf", "csv", "json", "markdown", "js", "css", "py", "xml", "yaml", "sql", "txt"] },
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
    },
    {
        type: "function",
        function: {
            name: "create_poll",
            description: "Create a Telegram poll in the chat. Use when user asks to create a poll, vote, or survey",
            parameters: {
                type: "object",
                properties: {
                    question: { type: "string", description: "Poll question" },
                    options: { type: "array", items: { type: "string" }, description: "Poll options, 2-10 items" },
                    is_anonymous: { type: "boolean", description: "Anonymous poll, default true" },
                    allows_multiple_answers: { type: "boolean", description: "Allow multiple answers, default false" },
                    message: { type: "string", description: "Message to send along with the poll" }
                },
                required: ["question", "options"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "schedule_reminder",
            description: "Schedule a reminder message to be sent later in this chat. Use when user asks to remind them about something",
            parameters: {
                type: "object",
                properties: {
                    reminder_text: { type: "string", description: "Reminder content to send later" },
                    delay_minutes: { type: "integer", description: "Delay in minutes (1-1440, max 24h)" },
                    message: { type: "string", description: "Confirmation message to send immediately" }
                },
                required: ["reminder_text", "delay_minutes"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "send_location",
            description: "Send a location/venue on the map. ALWAYS use this tool when you have latitude/longitude coordinates to share - never just write coordinates as text. Use when user asks for a location, coordinates, address, or you need to share any place on the map",
            parameters: {
                type: "object",
                properties: {
                    latitude: { type: "number", description: "Latitude" },
                    longitude: { type: "number", description: "Longitude" },
                    title: { type: "string", description: "Venue title, e.g. Malaysia Central Point" },
                    address: { type: "string", description: "Venue address, optional" },
                    message: { type: "string", description: "Message to send along with location - will be sent before the map" }
                },
                required: ["latitude", "longitude"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "youtube_search",
            description: "Search YouTube videos. Use when user asks to find YouTube videos",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "YouTube search query" },
                    limit: { type: "integer", description: "Max results (1-10, default 5)" }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "youtube_transcript",
            description: "Get transcript/text from a YouTube video. Use when user provides a YouTube URL or video ID and asks for transcript, summary, or content",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "YouTube URL or 11-char video ID" }
                },
                required: ["url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "analyze_image",
            description: "Analyze an image at a public URL using Gemini vision. Use when user sends an image, provides an image URL, or asks to describe/answer about an image. Returns detailed visual description.",
            parameters: {
                type: "object",
                properties: {
                    image_url: { type: "string", description: "Publicly accessible image URL to analyze (Telegram file link or any https URL)" },
                    prompt: { type: "string", description: "Optional question or instruction about what to focus on in the image" }
                },
                required: ["image_url"]
            }
        }
    }
];
