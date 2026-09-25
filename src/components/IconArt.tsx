/**
 * The app icon, drawn in JSX for `next/og`: a gold radar sweep on the ink
 * ground, with a red cell caught in it.
 */
export function IconArt({ size }: { size: number }) {
  const ring = (d: number, w: number, o: number) => ({
    position: "absolute" as const,
    left: (size - d) / 2,
    top: (size - d) / 2,
    width: d,
    height: d,
    borderRadius: d,
    border: `${w}px solid rgba(255, 194, 71, ${o})`,
  });
  return (
    <div
      style={{
        width: size,
        height: size,
        background: "#08080b",
        display: "flex",
        position: "relative",
      }}
    >
      <div style={ring(size * 0.72, size * 0.035, 0.35)} />
      <div style={ring(size * 0.48, size * 0.035, 0.6)} />
      <div style={ring(size * 0.24, size * 0.04, 1)} />
      <div
        style={{
          position: "absolute",
          left: size * 0.6,
          top: size * 0.26,
          width: size * 0.13,
          height: size * 0.13,
          borderRadius: size,
          background: "#ff3b30",
        }}
      />
    </div>
  );
}
