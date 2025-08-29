import { Film } from "lucide-react";

export function Logo() {
  return (
    <div className="group flex items-center gap-2" aria-label="Private Cinema home">
      <div className="rounded-lg bg-primary p-2 text-primary-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
        <Film className="h-6 w-6" />
      </div>
      <span className="font-headline text-2xl font-bold tracking-tighter text-foreground">
        Private Cinema
      </span>
    </div>
  );
}
