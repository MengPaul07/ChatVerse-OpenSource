export type SiteMode = "full" | "showcase" | "portal";

export type SiteModeDomainPolicy = SiteMode | "configurable";

const DEFAULT_MODE: SiteMode = import.meta.env.VITE_SITE_MODE === "portal"
  ? "portal"
  : import.meta.env.VITE_SITE_MODE === "showcase"
    ? "showcase"
    : "full";

export function readSiteMode(): SiteMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  const domainPolicy = getSiteModeDomainPolicy(window.location?.hostname);
  if (domainPolicy === "portal" || (domainPolicy === "configurable" && DEFAULT_MODE === "portal")) return "portal";
  if (DEFAULT_MODE === "showcase") return "showcase";
  return domainPolicy === "full" ? "full" : DEFAULT_MODE;
}

/** The root portal is fixed; product mode is controlled by the server/build configuration. */
export function getSiteModeDomainPolicy(hostname?: string): SiteModeDomainPolicy {
  const normalized = hostname?.trim().toLowerCase().replace(/\.$/, "") ?? "";
  if (normalized === "chatverse.fun" || normalized === "www.chatverse.fun") return "portal";
  if (normalized === "world.chatverse.fun") return "full";
  return "configurable";
}

export function useSiteMode(): SiteMode {
  return readSiteMode();
}
