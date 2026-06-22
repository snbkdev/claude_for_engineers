// Load .env into process.env for server-side code (e.g. RESEND_API_KEY,
// EMAIL_FROM, APP_URL). Vite only exposes VITE_-prefixed vars to the client; the
// SSR server reads process.env, so we populate it here at dev/build startup.
import "dotenv/config";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
});
