export interface ShouldMarkEndedOptions {
  collector: string;
  status?: string | null;
  adsSeen: number;
  maxAds: number;
}

export function shouldMarkEnded({ collector, status, adsSeen, maxAds }: ShouldMarkEndedOptions): boolean {
  return collector === "scrapecreators" && (status ?? "ACTIVE").trim().toUpperCase() === "ACTIVE" && adsSeen < maxAds;
}
