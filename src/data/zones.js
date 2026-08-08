// Fixed zones from Situationsplan_v3 (Bjartmar och Hylta, bygglovshandling).
// Hotspot polygons are in the pixel space of assets/cluster.png (1320 × 1193).
// Rooms are user-owned and live in storage — never hardcode room geometry here.

export const ZONES = [
  {
    id: "befintlig",
    name: "Befintlig byggnad",
    status: "Ombyggnad",
    desc: "Befintligt enbostadshus som byggs om invändigt.",
  },
  {
    id: "tillbyggnad",
    name: "Tillbyggnad",
    status: "Nybyggnad",
    desc: "Ny tillbyggnad i väster (4010 × 7020 enligt situationsplan). Hörn 1 m från föreslagen friköpt tomt.",
  },
  {
    id: "garage",
    name: "Nytt garage",
    status: "Nybyggnad",
    desc: "Nytt garage vid gårdsplanen i nordost. Hörn 1 m vinkelrätt från respektive sida åt NV och NO på friköpt tomt.",
  },
  {
    id: "terrass",
    name: "Terrass",
    status: "Nyanläggning",
    desc: "Ny terrassering med trappor och stödmurar i natursten; återbruk av sten från befintliga trappor. Bakre kant (åt NO) huggs ut ur berget. Plattor natursten.",
  },
  {
    id: "gardsplan",
    name: "Gårdsplan",
    status: "Mark",
    desc: "Grusad gårdsplan (singel/grus, lutning ca 2 %) mellan huset och garaget. Övergång singel–naturmark tar upp nivåskillnad.",
  },
  {
    id: "forrad",
    name: "Förråd",
    status: "Flytt",
    desc: "Flytt av befintlig förrådsbyggnad (tidigare kolonilottstugbyggnad) till läge öster om terrassen.",
  },
];

export const zoneById = (id) => ZONES.find((z) => z.id === id);

// Clickable polygons over assets/cluster.png — px coordinates, image 1320 × 1193.
export const HOTSPOTS = {
  tillbyggnad: [
    [290, 400], [360, 400], [360, 505], [440, 505], [440, 550], [360, 550],
    [360, 630], [290, 630], [290, 550], [250, 550], [250, 505], [290, 505],
  ],
  befintlig: [
    [360, 488], [497, 488], [497, 528], [592, 528], [592, 655], [500, 678], [360, 678],
  ],
  garage: [
    [648, 252], [728, 193], [812, 315], [703, 375],
  ],
  gardsplan: [
    [358, 398], [642, 252], [660, 252], [703, 375], [812, 318], [958, 330],
    [830, 425], [700, 472], [560, 498], [505, 488], [430, 470], [360, 452],
  ],
  terrass: [
    [650, 580], [810, 710], [700, 772], [628, 782], [560, 762], [560, 680],
    [595, 655], [610, 610],
  ],
  forrad: [
    [920, 695], [1000, 670], [1040, 700], [1020, 760], [935, 765],
  ],
};

// Label anchor per zone (same px space)
export const LABELS = {
  tillbyggnad: [345, 415],
  befintlig: [430, 668],
  garage: [730, 285],
  gardsplan: [560, 430],
  terrass: [680, 700],
  forrad: [980, 720],
};
