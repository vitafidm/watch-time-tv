"use client"

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSearch } from "@/hooks/use-search";
import { Button } from "./ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { MainNav } from "./main-nav";
import { Logo } from "./logo";
import Link from "next/link";

export function Header() {
  const { searchTerm, setSearchTerm } = useSearch();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur-sm md:px-6">
      <Link href="/" className="mr-4 hidden md:flex">
        <Logo />
      </Link>
      
      <MainNav />

      <div className="ml-auto flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search..."
            className="w-full rounded-lg bg-background pl-8 md:w-[200px] lg:w-[300px]"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Button variant="ghost" size="icon" className="rounded-full">
            <Avatar>
              <AvatarImage src="https://picsum.photos/100" alt="User Avatar" />
              <AvatarFallback>U</AvatarFallback>
            </Avatar>
        </Button>
      </div>
    </header>
  );
}
