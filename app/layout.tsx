import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Image from 'next/image';
import Link from 'next/link';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'GooseGrade - UWaterloo Grade Calculator',
  description: 'Track your assignments and calculate your grades for University of Waterloo courses.',
  icons: {
    icon: [
      { url: '/logo.png', href: '/logo.png' },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-secondary/20">
          <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-40">
            <div className="container mx-auto p-4 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                <div className="relative w-8 h-8">
                  <Image 
                    src="/logo.png" 
                    alt="Logo" 
                    fill
                    className="object-contain"
                  />
                </div>
                <span className="text-xl font-bold text-foreground tracking-tight">
                  Goose<span className="text-primary">Grade</span>
                </span>
              </Link>
              
              <nav className="flex gap-4 text-sm font-medium text-muted-foreground">
                {/* Add nav links here later if needed */}
              </nav>
            </div>
          </header>
          
          <main className="flex-1 container mx-auto p-4 md:p-8 animate-in fade-in duration-500">
            {children}
          </main>
          
          <footer className="border-t bg-background/50">
            <div className="container mx-auto p-6 text-center text-muted-foreground text-sm">
              <p>Not affiliated with University of Waterloo.</p>
              <p className="mt-1">Built with 🦢 by students.</p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
