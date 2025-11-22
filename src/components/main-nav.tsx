"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const menuItems = [
  {
    href: "/movies/library",
    label: "Movies",
  },
  {
    href: "/television/library",
    label: "Shows",
  },
  {
    href: "/collections",
    label: "Collections",
  },
];

export function MainNav() {
  const pathname = usePathname();

  return (
    // Note: visibility is now controlled by the parent wrapper in AppHeader (`hidden lg:flex`)
    <nav className="flex items-center space-x-6 text-sm font-medium">
      {menuItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "transition-colors hover:text-primary",
            pathname === item.href
              ? "text-primary font-semibold"
              : "text-muted-foreground"
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
