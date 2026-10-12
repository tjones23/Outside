/**
 * Who manages the land: the Bureau of Land Management's national Surface
 * Management Agency map — federal, state, local and tribal land, colored by
 * agency. Private land is left transparent, so the basemap shows through.
 *
 * BLM publishes it as a pre-rendered tile cache in Web Mercator, so it's an
 * ordinary tile layer drawn straight from BLM; nothing passes through this
 * server. Tiles exist through zoom 14 and are stretched beyond.
 */

export const LAND_TILE_URL =
  "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/tile/{z}/{y}/{x}";

export const LAND_MAX_NATIVE_ZOOM = 14;

export const LAND_OPACITY = 0.5;

export const LAND_ATTRIBUTION = "Land ownership: Bureau of Land Management";
export const LAND_ATTRIBUTION_HTML =
  'Land ownership: <a href="https://gbp-blm-egis.hub.arcgis.com/">Bureau of Land Management</a>';

/** The service's own legend colors, most widespread first. */
export const LAND_AGENCIES: { label: string; color: string }[] = [
  { label: "Bureau of Land Management", color: "#FEE679" },
  { label: "Forest Service", color: "#CCEBC5" },
  { label: "National Park Service", color: "#CABDDC" },
  { label: "Fish and Wildlife Service", color: "#7FCCA7" },
  { label: "Defense", color: "#FBB4CE" },
  { label: "Bureau of Reclamation", color: "#FFFFB3" },
  { label: "Tribal (BIA)", color: "#FDB46C" },
  { label: "Other federal", color: "#E4C49F" },
  { label: "State", color: "#B3E3EE" },
  { label: "Local", color: "#8FB5BE" },
];
