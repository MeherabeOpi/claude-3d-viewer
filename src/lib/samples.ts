const KHRONOS =
  "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models";

/** Public, CORS-enabled models so a first-time visitor sees something instantly. */
export const SAMPLES = [
  {
    label: "Chinese New Year gate",
    url: "/models/chinese-new-year-gate.glb",
  },
  {
    label: "Damaged helmet",
    url: `${KHRONOS}/DamagedHelmet/glTF-Binary/DamagedHelmet.glb`,
  },
  {
    label: "Fox (animated)",
    url: `${KHRONOS}/Fox/glTF-Binary/Fox.glb`,
  },
  {
    label: "Boom box",
    url: `${KHRONOS}/BoomBox/glTF-Binary/BoomBox.glb`,
  },
  {
    label: "Avocado",
    url: `${KHRONOS}/Avocado/glTF-Binary/Avocado.glb`,
  },
] as const;
