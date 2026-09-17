import { config } from "dotenv";
config();
import { Firecrawl } from "firecrawl";

export const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL });
