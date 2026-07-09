export const JSON_TREE_INDENT_PX = 14;
export const JSON_TREE_TOGGLE_GUTTER_PX = 14;

export function getJsonTreeLeafPadding(depth: number): number {
  if (depth === 0) {
    return 0;
  }

  return depth * JSON_TREE_INDENT_PX + JSON_TREE_TOGGLE_GUTTER_PX;
}

export function getJsonTreeContainerPadding(depth: number): number {
  return depth * JSON_TREE_INDENT_PX;
}

export function getJsonTreeClosingPadding(depth: number): number {
  return depth * JSON_TREE_INDENT_PX + JSON_TREE_TOGGLE_GUTTER_PX;
}
