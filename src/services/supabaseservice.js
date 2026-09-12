import { createClient } from "@supabase/supabase-js";
import { configDotenv } from "dotenv";

configDotenv();

const supabase = createClient(process.env.SUPAURL,process.env.SUPAKEY);

export default supabase;