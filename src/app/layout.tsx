import type { Metadata } from 'next';
import { Toaster } from "@/components/ui/toaster";
import { WatchlistProvider } from '@/hooks/use-watchlist';
import { SearchProvider } from '@/hooks/use-search';
import { Header } from '@/components/header';
import { cn } from '@/lib/utils';
import './globals.css';

export const metadata: Metadata = {
  title: 'Private Cinema',
  description: 'Browse your self-hosted media library.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Exo+2:wght@700&family=Inter:wght@400;700&display=swap" rel="stylesheet" />
      </head>
      <body className={cn("font-body antialiased", "bg-background text-foreground")}>
        <Toaster />
        <SearchProvider>
          <WatchlistProvider>
            <div className="flex min-h-screen w-full flex-col">
              <Header />
              <main className="flex-1 p-4 sm:p-6">{children}</main>
            </div>
          </WatchlistProvider>
        </SearchProvider>
      </body>
    </html>
  );
}
