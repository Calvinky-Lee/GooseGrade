'use client';

import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function Home() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const router = useRouter();

  useEffect(() => {
    const search = async () => {
      if (query.length < 2) {
        setResults([]);
        return;
      }

      const { data } = await supabase
        .from('courses')
        .select('code, name, term')
        .ilike('code', `%${query}%`)
        .limit(5);

      setResults(data || []);
    };

    const timer = setTimeout(search, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="flex flex-col items-center justify-center py-12 md:py-20">
      
      {/* Logo Section */}
      <div className="mb-8 relative w-40 h-40 md:w-52 md:h-52">
        <Image 
          src="/logo.png" 
          alt="GooseGrade Logo" 
          fill
          className="object-contain"
          priority
        />
      </div>

      <h1 className="text-4xl md:text-6xl font-bold text-center mb-6">
        <span className="text-primary">GooseGrade</span>
      </h1>
      
      <p className="text-muted-foreground text-lg mb-10 text-center max-w-2xl px-4">
        The smartest grade calculator for UWaterloo students. <br/>
        Find your course, track your marks, and pass with confidence.
      </p>

      <div className="w-full max-w-md relative px-4">
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 to-primary/40 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground h-5 w-5" />
            <input
              type="text"
              className="w-full pl-12 pr-4 py-4 rounded-lg border bg-background shadow-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none text-lg placeholder:text-muted-foreground/70"
              placeholder="Search course (e.g., CS 135)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {results.length > 0 && (
          <div className="absolute w-[calc(100%-2rem)] left-4 right-4 mt-2 bg-card border rounded-lg shadow-xl z-50 overflow-hidden ring-1 ring-black/5">
            {results.map((course) => (
              <button
                key={`${course.code}-${course.term}`}
                className="w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors flex flex-col border-b last:border-0"
                onClick={() => router.push(`/course/${course.code}`)}
              >
                <div className="flex justify-between items-baseline">
                  <span className="font-bold text-foreground">{course.code}</span>
                  <span className="text-xs text-primary font-medium bg-primary/10 px-2 py-0.5 rounded-full">
                    {course.term}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground truncate mt-1">{course.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
