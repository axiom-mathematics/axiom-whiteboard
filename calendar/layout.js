/** Column packing for overlapping timed events, Google Calendar style. */

export function layoutOverlaps(items) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const clusters = [];
  let cluster = [];
  let clusterEnd = -1;
  for (const item of sorted) {
    if (!cluster.length || item.startMin < clusterEnd) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMin);
    } else {
      clusters.push(cluster);
      cluster = [item];
      clusterEnd = item.endMin;
    }
  }
  if (cluster.length) clusters.push(cluster);

  const placed = [];
  for (const group of clusters) {
    const colEnds = [];
    for (const item of group) {
      let col = colEnds.findIndex((end) => end <= item.startMin + 0.01);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(item.endMin);
      } else {
        colEnds[col] = item.endMin;
      }
      item.col = col;
    }
    const cols = colEnds.length;
    for (const item of group) placed.push({ ...item, col: item.col, cols });
  }
  return placed;
}
