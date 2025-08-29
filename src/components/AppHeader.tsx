"use client"

import { Search, LogOut, Settings, LogIn } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSearch } from "@/hooks/use-search";
import { Button } from "./ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { MainNav } from "./main-nav";
import { Logo } from "./logo";
import Link from "next/link";
import { useAuthUser } from "@/hooks/useAuthUser";

export function AppHeader() {
  const { searchTerm, setSearchTerm } = useSearch();
  const { user } = useAuthUser();

  const userInitial = user?.email ? user.email.charAt(0).toUpperCase() : '?';

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

        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                    <Avatar>
                        {user && <AvatarImage src={`https://i.pravatar.cc/150?u=${user.uid}`} alt="User Avatar" />}
                        <AvatarFallback>{userInitial}</AvatarFallback>
                    </Avatar>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {user ? (
                    <>
                        <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                            <Link href="/settings"><Settings className="mr-2 h-4 w-4" />Settings</Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                             <Link href="/signout"><LogOut className="mr-2 h-4 w-4" />Sign Out</Link>
                        </DropdownMenuItem>
                    </>
                ) : (
                    <>
                        <DropdownMenuItem asChild>
                           <Link href="/signin"><LogIn className="mr-2 h-4 w-4" />Sign In</Link>
                        </DropdownMenuItem>
                         <DropdownMenuItem asChild>
                           <Link href="/signup">Sign Up</Link>
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>

      </div>
    </header>
  );
}
