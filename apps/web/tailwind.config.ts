/**
 * Copyright (c) 2025 GooseGrade
 * All rights reserved.
 */

import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    // Workspace packages can carry class names too (e.g. shared UI added later).
    "../../packages/*/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require("tailwindcss-animate"),
  ],
}

export default config
