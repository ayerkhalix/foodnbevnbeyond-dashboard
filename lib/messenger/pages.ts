export const PAGES = [
  {
    id: "500981746436108",
    name: "The Moringa Tree Restaurant El Nido",
    short: "The Moringa Tree",
    color: "moringa",
    logo: "/logos/moringa%20tree.jpg",
  },
  {
    id: "651516738053247",
    name: "Sa Kurbada Hapag Karaenan",
    short: "Sa Kurbada",
    color: "kurbada",
    logo: "/logos/kurbada%20sa%20hapag%20karaenan.jpg",
  },
  {
    id: "109815532143585",
    name: "Coco Resto El Nido",
    short: "Coco Resto",
    color: "coco",
    logo: "/logos/coco%20resto.jpg",
  },
  {
    id: "103575287751558",
    name: "The LightHouse El Nido",
    short: "The LightHouse",
    color: "lighthouse",
    logo: "/logos/the%20lighthouse.jpg",
  },
] as const;

export function isAllowedPage(id: string) {
  return PAGES.some((page) => page.id === id);
}
export function pageFor(id: string) {
  return PAGES.find((page) => page.id === id);
}
