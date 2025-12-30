<!--
Copyright (c) 2025 GooseGrade
All rights reserved.
-->

# GooseGrade

A grade calculator for University of Waterloo courses. Enter your course code to see assessment weightings from your course outline and calculate your grades.

## Features

- Search for UWaterloo courses by code
- View assessment weightings from course outlines
- Calculate current grades based on entered marks
- Target grade calculator to determine required marks
- Support for multiple course sections

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Supabase account (for database)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables in `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   OPENAI_API_KEY=your_openai_api_key
   WATERLOO_SESSION_COOKIE=your_session_cookie (optional)
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run scrape` - Scrape a single course outline
- `npm run scrape-batch` - Scrape multiple course outlines
- `npm run add-course` - Add a course to the database
- `npm run fetch-courses` - Fetch course list from UWaterloo API

## License

Copyright (c) 2025 GooseGrade. All rights reserved.

