"use client";

import React from "react";
import {
  Search,
  LogOut,
  Settings,
  LogIn,
  Film,
  Tv,
  Layers,
  Menu,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSearch } from "@/hooks/use-search";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { MainNav } from "./main-nav";
import { Logo } from "./logo";
import Link from "next/link";
import { useAuthUser } from "@/hooks/useAuthUser";
import SearchResultsPopover from "@/components/SearchResultsPopover";

export function AppHeader() {
  const { searchTerm, setSearchTerm } = useSearch();
  const { user } = useAuthUser();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur-sm md:px-6">
      

      {/* Tablet / Desktop: full wordmark logo */}
      <Link href="/" className="mr-4 flex items-center">
        <Logo />
      </Link>

      {/* Primary nav: only show on larger screens (desktop) */}
      <div className="hidden md:flex">
        <MainNav />
      </div>

      <div className="ml-auto flex items-center gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            id="global-nav-search"
            type="search"
            placeholder="Search..."
            className="w-full rounded-lg bg-background pl-8 md:w-[200px] lg:w-[300px]"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <SearchResultsPopover
          anchorId="global-nav-search"
          makeHref={({ id, kind }) =>
            kind === "movie" ? `/movies/${id}` : `/television/${id}`
          }
          onSelect={() => {
            // Optionally clear search on select:
            // setSearchTerm("");
          }}
        />

        {/* Hamburger menu replaces avatar */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full shrink-0"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">
            {user ? (
              <>
                <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/movies/library">
                    <Film className="mr-2 h-4 w-4" />
                    Movie Library
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/television/library">
                    <Tv className="mr-2 h-4 w-4" />
                    TV Library
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/collections">
                    <Layers className="mr-2 h-4 w-4" />
                    Collections
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/signout">
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign Out
                  </Link>
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem asChild>
                  <Link href="/signin">
                    <LogIn className="mr-2 h-4 w-4" />
                    Sign In
                  </Link>
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
