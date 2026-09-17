import { config } from "dotenv";
config();

export const MONGO_URI = process.env.URI;
