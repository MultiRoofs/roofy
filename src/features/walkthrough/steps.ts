/** Stable step ids keep UI targets separate from tutorial state. */
export const DELFT_SAMPLE_URL =
  "https://storage.googleapis.com/cityjson/delft.city.jsonl";
export const WALKTHROUGH_STEPS = [
  {
    id: "load",
    chapter: 1,
    title: "Start with Delft",
    body: "Load the example city model and PDOK land-use polygons for Delft. Explore buildings, roofs and land-use attributes together.",
    action: "Load Delft sample",
  },
  {
    id: "pick",
    chapter: 2,
    title: "Pick a building",
    body: "Click a building on the map. Its attributes and roof measurements appear in the right panel.",
    action: "Click a building on the map",
  },
  {
    id: "inspect",
    chapter: 2,
    title: "Read its attributes",
    body: "Explore the building’s Summary and Attributes on the right. These values describe the feature you selected.",
    action: "Inspect the right panel, then continue",
  },
  {
    id: "style",
    chapter: 3,
    title: "Find roofs with a rule",
    body: "Set Color by to Rules, then choose Solar suitable. The matching roof surfaces change colour. This preset illustrates a geometry rule; it is not a solar-yield assessment.",
    action: "Choose Rules and apply a preset",
  },
  {
    id: "filter",
    chapter: 4,
    title: "Narrow the table",
    body: "Add a condition on an attribute, choose its operator and value, then Apply. For example, filter b3_h_dak_max to greater than 15 to explore taller buildings.",
    action: "Apply a table filter",
  },
  {
    id: "stats",
    chapter: 4,
    title: "Understand the matching buildings",
    body: "Click a statistics icon beside a column name in the table. Inspect the values for your filtered buildings.",
    action: "Open a column’s statistics",
  },
  {
    id: "volume",
    chapter: 5,
    title: "Calculate building volume",
    body: "In Tools → Measure solids, keep Volume (m³) checked. Choose All or Matching for the scope, then Run. When it finishes, inspect the result and any invalid-solid notes; the volume is written to attributes.",
    action: "Run Measure solids with Volume selected",
  },
  {
    id: "join",
    chapter: 6,
    title: "Connect buildings to areas",
    body: "Keep the Delft city model as the target. Choose Delft land use (PDOK) as the source layer, select landCoverObservationClass, then Run to copy the matching land-use class onto buildings. The land-use layer is also available to other overlay tools.",
    action: "Run Join attributes by location using Delft land use",
  },
  {
    id: "sun",
    chapter: 7,
    title: "Explore sun and shade",
    body: "Open Sun & shade above the map. Enable shadows, change the date or time, and compare how neighbouring buildings shade the roofs.",
    action: "Change the date or time with shadows enabled",
  },
  {
    id: "share",
    chapter: 8,
    title: "Take your work with you",
    body: "Use Export to save an image of the view, or Share to create a project link. Review the share dialog’s notes about what the link includes before sending it to someone.",
    action: "Open Export or Share",
  },
] as const;
export type WalkthroughStepId = (typeof WALKTHROUGH_STEPS)[number]["id"];
