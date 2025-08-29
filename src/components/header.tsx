"use client"

import { Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { useSearch } from "@/hooks/use-search";
import { Button } from "./ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

export function Header() {
  const { searchTerm, setSearchTerm } = useSearch();

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur-sm md:px-6">
      <div className="md:hidden">
        <SidebarTrigger />
      </div>
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search movies and TV shows..."
          className="w-full rounded-lg bg-background pl-8 md:w-[300px] lg:w-[400px]"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      <div className="ml-auto">
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
