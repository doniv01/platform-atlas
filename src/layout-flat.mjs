/** A stable reading layout. No jitter, overlapping cards, or changes to source data. */
export function flatLayout(nodes, groupKey = 'district') {
  const groups = [...new Set(nodes.map((node) => node[groupKey]))];
  const columns = Math.min(3, groups.length || 1);
  const positions = new Map();
  let top = 0;
  for (let row = 0; row < Math.ceil(groups.length / columns); row++) {
    const rowGroups = groups.slice(row * columns, (row + 1) * columns);
    let rowHeight = 0;
    rowGroups.forEach((group, column) => {
      const members = nodes.filter((node) => node[groupKey] === group);
      rowHeight = Math.max(rowHeight, Math.ceil(members.length / 2) * 48 + 100);
      members.forEach((node, index) => {
        positions.set(node.id, { x: column * 400 + (index % 2) * 180, y: top + Math.floor(index / 2) * 48 });
      });
    });
    top += rowHeight;
  }
  const values = [...positions.values()];
  const width = Math.max(1, ...values.map((p) => p.x)) + 240;
  const height = Math.max(1, ...values.map((p) => p.y)) + 140;
  const fit = Math.min(1, 1020 / width, 550 / height);
  const cx = (Math.min(...values.map((p) => p.x), 0) + Math.max(...values.map((p) => p.x), 0)) / 2;
  const cy = Math.max(...values.map((p) => p.y), 0) / 2;
  for (const [id, p] of positions) {
    positions.set(id, { x: (560 + p.x - cx - 70) / 9.65, y: (635 - (355 + p.y - cy)) / 5.55, z: 0 });
  }
  return { positions, fit };
}

export function flatFlowLayout(nodeIds) {
  const columns = Math.min(5, nodeIds.length || 1);
  const rows = Math.ceil(nodeIds.length / columns);
  const positions = new Map(nodeIds.map((id, index) => {
    const row = Math.floor(index / columns);
    const column = row % 2 ? columns - 1 - index % columns : index % columns;
    return [id, { x: (560 + (column - (columns - 1) / 2) * 190 - 70) / 9.65, y: (635 - (350 + (row - (rows - 1) / 2) * 110)) / 5.55, z: 0 }];
  }));
  return { positions, fit: Math.min(1, 520 / Math.max(110, rows * 110)) };
}
